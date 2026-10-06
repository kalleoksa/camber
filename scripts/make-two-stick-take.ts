import { writeFileSync } from 'node:fs';
import { TICK_DT } from '../src/core/loop.ts';
import { buildTake } from '../src/input/recorder.ts';
import { neutralInput, quantizeInput, type InputSnapshot } from '../src/input/snapshot.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState } from '../src/sim/state.ts';
import { cloneParams, params } from '../src/sim/params.ts';
import { createRng, next } from '../src/sim/rng.ts';
import { createContact, createSlope, type SlopeConfig } from '../src/sim/terrain.ts';
import { dampScalar } from '../src/sim/vec3.ts';

/**
 * A synthetic take on the two-stick mapping (input.scheme 1), so the determinism check covers
 * its paths: posture, skid, press and butter lock, ollie/nollie, flip flicks, right-stick
 * shifty and bumper grabs. Separate from make-take.ts so regenerating this one doesn't
 * re-record the one-stick takes. `node scripts/make-two-stick-take.ts`.
 */
const SEED = 2;
const SECONDS = 14;
const slopeConfig: SlopeConfig = {
  length: 400,
  width: 120,
  pitch: 0.28,
  kicker: { z: -16, x: 0, width: 10, lipHeight: 6, lipAngle: 0.5, deckLength: 5, sideTaper: 3, landingAngle: 0.3, knuckleRadius: 5, runoutRadius: 18 },
};

const rng = createRng(SEED);
const frames: InputSnapshot[] = [];
const s = { lx: 0, ly: 0, rx: 0, ry: 0, rt: 0 };
const target = { lx: 0, ly: 0, rx: 0, ry: 0, rt: 0 };
let hand = 0; // -1 LB, 0, +1 RB

for (let i = 0; i < SECONDS / TICK_DT; i++) {
  if (i % 40 === 0) {
    target.lx = next(rng) * 2 - 1;
    // Posture held, or a flick (a fast move over one interval) for a flip.
    target.ly = next(rng) * 2 - 1;
    target.rt = next(rng) < 0.35 ? 1 : 0;
    const roll = next(rng);
    hand = roll < 0.2 ? -1 : roll < 0.4 ? 1 : 0;
    // Right stick: a grab with a hand, otherwise a press, a skid or a shifty.
    target.rx = next(rng) * 2 - 1;
    target.ry = next(rng) * 2 - 1;
  }
  s.lx = dampScalar(s.lx, target.lx, 6, TICK_DT);
  s.ly = dampScalar(s.ly, target.ly, 14, TICK_DT);
  s.rt = dampScalar(s.rt, target.rt, 12, TICK_DT);
  s.rx = dampScalar(s.rx, target.rx, 10, TICK_DT);
  s.ry = dampScalar(s.ry, target.ry, 10, TICK_DT);

  const frame = neutralInput();
  frame.lx = s.lx;
  frame.ly = s.ly;
  frame.rt = s.rt;
  frame.rx = s.rx;
  frame.ry = s.ry;
  frame.lb = hand < 0;
  frame.rb = hand > 0;
  frames.push(frame);
}

const take = buildTake({
  seed: SEED,
  dt: TICK_DT,
  spawn: {
    position: { x: 0, y: createSlope(slopeConfig).sample(0, 0, createContact()).height + 1.5, z: 0 },
    heading: Math.PI,
  },
  terrain: slopeConfig,
  params: { ...cloneParams(params), input: { scheme: 1 } },
  frames,
});

const path = new URL('../takes/two-stick.json', import.meta.url);
writeFileSync(path, JSON.stringify(take));
console.log(`wrote ${take.frames.length} ticks -> takes/two-stick.json`);

// A scripted rail run on two sticks: ollie on, balance on the left stick (with wobble), a
// slide via the bumpers, a nose press on the right stick, and a wound-up nollie spin off —
// so the gate covers the rail's split sticks and the off-balance spin scale.
{
  const two = { ...cloneParams(params), input: { scheme: 1 } };
  const railConfig: SlopeConfig = { length: 400, width: 120, pitch: 0.28, rails: [{ points: [[0, 0.6, -14], [0, 0.6, -40]] }] };
  const railTerrain = createSlope(railConfig);
  const spawn = { position: { x: 0, y: railTerrain.sample(0, 0, createContact()).height + 0.2, z: 0 }, heading: Math.PI };
  const state = createRiderState(spawn);
  const railFrames: InputSnapshot[] = [];
  const wobble = createRng(9);
  let onRail = 0;
  let maxContact = 0;
  let spinOff = 0;
  for (let i = 0; i < 7 / TICK_DT; i++) {
    const frame = neutralInput();
    if (state.mode === 'grounded' && state.position.z < -9 && state.position.z > -12.5) frame.rt = 1;
    if (state.mode === 'railed') {
      onRail += TICK_DT;
      const noise = (next(wobble) - 0.5) * 0.6;
      // Trick model: + lean is heel, and the left stick toward the heel side (−X in a 50-50) adds to it.
      frame.lx = Math.max(-1, Math.min(1, 1.2 * state.balance + 0.5 * state.balanceVel + noise));
      frame.rb = onRail > 0.1 && onRail < 0.3;
      frame.lb = onRail > 0.35 && onRail < 0.55;
      frame.ry = onRail > 0.6 && onRail < 1.1 ? 0.8 : 0; // nose press
      frame.rt = onRail > 0.7 && onRail < 1.1 ? 1 : 0; // charge on the press, pop off it
      // The left stick is the balance here too, so the wind-up is short.
      if (onRail > 0.9 && onRail < 1.05) frame.lx = 1; // wind up
      if (onRail >= 1.05) frame.lx = -1; // send
      maxContact = Math.max(maxContact, state.railContact);
    }
    const wasRailed = state.mode === 'railed';
    const q = quantizeInput(frame);
    tick(state, q, two, railTerrain, TICK_DT);
    if (wasRailed && state.mode === 'airborne') spinOff = state.spinRate;
    railFrames.push(q);
  }
  const railTake = buildTake({ seed: SEED, dt: TICK_DT, spawn, terrain: railConfig, params: two, frames: railFrames });
  writeFileSync(new URL('../takes/two-stick-rail.json', import.meta.url), JSON.stringify(railTake));
  console.log(`wrote ${railTake.frames.length} ticks -> takes/two-stick-rail.json (${onRail.toFixed(2)} s on the rail, contact up to ${maxContact.toFixed(2)}, spin off ${spinOff.toFixed(2)} rad/s, popped off the ${state.popStance > 0 ? 'nose' : state.popStance < 0 ? 'tail' : '—'})`);
}
