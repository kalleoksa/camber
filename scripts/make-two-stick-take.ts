import { writeFileSync } from 'node:fs';
import { TICK_DT } from '../src/core/loop.ts';
import { buildTake } from '../src/input/recorder.ts';
import { neutralInput, type InputSnapshot } from '../src/input/snapshot.ts';
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
