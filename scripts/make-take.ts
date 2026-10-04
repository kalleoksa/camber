import { writeFileSync } from 'node:fs';
import { TICK_DT } from '../src/core/loop.ts';
import { buildTake } from '../src/input/recorder.ts';
import { neutralInput, quantizeInput, type InputSnapshot } from '../src/input/snapshot.ts';
import { params } from '../src/sim/params.ts';
import { tick } from '../src/sim/rider.ts';
import { createRng, next } from '../src/sim/rng.ts';
import { createRiderState } from '../src/sim/state.ts';
import { SLOPESTYLE } from '../src/park/slopestyle.ts';
import { SOCHI } from '../src/park/sochi.ts';
import { createContact, createSlope, type KickerConfig, type SlopeConfig } from '../src/sim/terrain.ts';
import { dampScalar } from '../src/sim/vec3.ts';

/**
 * Synthesises a take that exercises every input — grabs, tweaks, shifty — so the
 * determinism check covers paths a real ride may not. takes/hill-run.json is the real one.
 */
const SEED = 1;
const SECONDS = 12;
// Same kicker as main.ts, so the determinism check covers the lip and landing paths too.
const slopeConfig: SlopeConfig = {
  length: 400,
  width: 120,
  pitch: 0.28,
  kicker: { z: -16, x: 0, width: 10, lipHeight: 6, lipAngle: 0.5, deckLength: 5, sideTaper: 3, landingAngle: 0.3, knuckleRadius: 5, runoutRadius: 18 },
};

const rng = createRng(SEED);
const frames: InputSnapshot[] = [];

let lx = 0;
let ly = 0;
let rt = 0;
let rx = 0;
let ry = 0;
let lxTarget = 0;
let lyTarget = 0;
let rtTarget = 0;
let rxTarget = 0;
let ryTarget = 0;
let shifty = 0; // -1 LB, 0, +1 RB

for (let i = 0; i < SECONDS / TICK_DT; i++) {
  if (i % 48 === 0) {
    lxTarget = next(rng) * 2 - 1;
    lyTarget = (next(rng) * 2 - 1) * 0.6;
    rtTarget = next(rng) < 0.3 ? next(rng) : 0;
    // Grabs, some deep enough to tweak, so the determinism check covers the grab path.
    const grab = next(rng) < 0.4;
    rxTarget = grab ? next(rng) * 2 - 1 : 0;
    ryTarget = grab ? next(rng) * 2 - 1 : 0;
    const roll = next(rng);
    shifty = roll < 0.15 ? -1 : roll < 0.3 ? 1 : 0;
  }
  lx = dampScalar(lx, lxTarget, 6, TICK_DT);
  ly = dampScalar(ly, lyTarget, 4, TICK_DT);
  rt = dampScalar(rt, rtTarget, 8, TICK_DT);
  rx = dampScalar(rx, rxTarget, 10, TICK_DT);
  ry = dampScalar(ry, ryTarget, 10, TICK_DT);

  const frame = neutralInput();
  frame.lx = lx;
  frame.ly = ly;
  frame.rt = rt;
  frame.rx = rx;
  frame.ry = ry;
  frame.lb = shifty < 0;
  frame.rb = shifty > 0;
  frames.push(frame);
}

const terrain = createSlope(slopeConfig);
const take = buildTake({
  seed: SEED,
  dt: TICK_DT,
  spawn: {
    position: { x: 0, y: terrain.sample(0, 0, createContact()).height + 1.5, z: 0 },
    heading: Math.PI,
  },
  terrain: slopeConfig,
  params,
  frames,
});

const path = new URL('../takes/synthetic.json', import.meta.url);
writeFileSync(path, JSON.stringify(take));
console.log(`wrote ${take.frames.length} ticks -> takes/synthetic.json`);

// A scripted rail run, so the determinism check covers the railed state: ride down, ollie
// onto the rail, balance with some wobble, turn into a boardslide and back, press, and pop
// off. Inputs are decided from a live sim as they're recorded — the take stores only them.
{
  const railConfig: SlopeConfig = { length: 400, width: 120, pitch: 0.28, rails: [{ points: [[0, 0.6, -14], [0, 0.6, -40]] }] };
  const railTerrain = createSlope(railConfig);
  const spawn = { position: { x: 0, y: railTerrain.sample(0, 0, createContact()).height + 0.2, z: 0 }, heading: Math.PI };
  const state = createRiderState(spawn);
  const railFrames: InputSnapshot[] = [];
  const wobble = createRng(7);
  let onRail = 0;
  for (let i = 0; i < 7 / TICK_DT; i++) {
    const frame = neutralInput();
    if (state.mode === 'grounded' && state.position.z < -9 && state.position.z > -12.5) frame.rt = 1;
    if (state.mode === 'railed') {
      onRail += TICK_DT;
      const noise = (next(wobble) - 0.5) * 0.6;
      frame.lx = Math.max(-1, Math.min(1, -(1.2 * state.balance + 0.5 * state.balanceVel) + noise));
      frame.rb = onRail > 0.1 && onRail < 0.4;
      frame.lb = onRail > 0.5 && onRail < 0.8;
      frame.ly = onRail > 0.8 && onRail < 1.0 ? -0.8 : 0;
      frame.rt = onRail > 0.95 && onRail < 1.15 ? 1 : 0;
    }
    const q = quantizeInput(frame);
    tick(state, q, params, railTerrain, TICK_DT);
    railFrames.push(q);
  }
  const railTake = buildTake({ seed: SEED, dt: TICK_DT, spawn, terrain: railConfig, params, frames: railFrames });
  writeFileSync(new URL('../takes/rail.json', import.meta.url), JSON.stringify(railTake));
  console.log(`wrote ${railTake.frames.length} ticks -> takes/rail.json (${onRail.toFixed(2)} s on the rail)`);
}

// A scripted run down the slopestyle park, so the determinism check covers butters, the
// walled state and grade changes: a nose butter 180 and a tail butter back, over to the
// wall and a pop onto it, back across, and an ollie on the deck.
{
  const parkTerrain = createSlope(SLOPESTYLE);
  const spawn = { position: { x: 0, y: parkTerrain.sample(0, 0, createContact()).height + 0.2, z: 0 }, heading: Math.PI };
  const state = createRiderState(spawn);
  const parkFrames: InputSnapshot[] = [];
  const seen = new Set<string>();
  let butteredBack = false;
  const steer = (target: number): number => {
    const err = Math.atan2(Math.sin(target - state.heading), Math.cos(target - state.heading));
    return Math.max(-1, Math.min(1, -3 * err));
  };
  for (let i = 0; i < 11 / TICK_DT; i++) {
    const t = i * TICK_DT;
    const frame = neutralInput();
    const { x, z } = state.position;
    if (t > 0.5 && t < 1.5) {
      frame.ly = 1;
      frame.lx = 1;
    } else if (t >= 1.5 && !butteredBack) {
      frame.ly = -1;
      frame.lx = steer(Math.PI);
      butteredBack = Math.abs(frame.lx) < 0.05;
    } else if (state.mode === 'walled' || (x > 10.5 && z > -60)) frame.lx = steer(Math.PI - 0.5);
    else if (z < -30 && z > -60) frame.lx = steer(Math.PI - 0.6);
    else frame.lx = steer(Math.PI + Math.max(-0.4, Math.min(0.4, 0.08 * x)));
    if (x > 8 && x < 10.4 && z > -75) frame.rt = 1; // charge in, pop on the wall's transition
    if (t > 9.3 && t < 9.6) frame.rt = 1; // an ollie on the deck after the wall
    const q = quantizeInput(frame);
    tick(state, q, params, parkTerrain, TICK_DT);
    parkFrames.push(q);
    seen.add(state.mode);
  }
  const parkTake = buildTake({ seed: SEED, dt: TICK_DT, spawn, terrain: SLOPESTYLE, params, frames: parkFrames });
  writeFileSync(new URL('../takes/park.json', import.meta.url), JSON.stringify(parkTake));
  console.log(`wrote ${parkTake.frames.length} ticks -> takes/park.json (modes: ${[...seen].join(', ')})`);
}

// The whole park straight down, rolling both kickers, then carved across into the corner
// and popped over its side landing, then back across into the quarter pipe with a pop on
// its face — covers the corner's takeoff, deck and landings and the quarter pipe's air.
{
  const parkTerrain = createSlope(SLOPESTYLE);
  const corner = SLOPESTYLE.corners?.[0];
  const spawn = { position: { x: 0, y: parkTerrain.sample(0, 0, createContact()).height + 0.2, z: 0 }, heading: Math.PI };
  const state = createRiderState(spawn);
  const cornerFrames: InputSnapshot[] = [];
  const lip = corner ? corner.z - (corner.lipHeight / (1 - Math.cos(corner.lipAngle))) * Math.sin(corner.lipAngle) : 0;
  let landed = 'none';
  let cornerDone = false;
  const quarter = SLOPESTYLE.quarters?.[0];
  for (let i = 0; i < 32 / TICK_DT; i++) {
    const frame = neutralInput();
    const { x, z } = state.position;
    let target = Math.PI;
    if (cornerDone) target = Math.PI + Math.max(-0.5, Math.min(0.5, 0.15 * x));
    else if (corner && z < corner.z + 30 && z > corner.z + 5) target = Math.PI + Math.max(-0.5, Math.min(0.5, 0.15 * (x + 2.5)));
    else if (corner && z <= corner.z + 5) target = Math.PI - 0.3;
    const inQuarter = quarter !== undefined && z < quarter.z + 1;
    if (state.mode === 'grounded' && !inQuarter) {
      const err = Math.atan2(Math.sin(target - state.heading), Math.cos(target - state.heading));
      frame.lx = Math.max(-1, Math.min(1, -3 * err));
      if (z < lip + 4 && z > lip + 0.6) frame.rt = 1;
    }
    // Charge rolling into the quarter pipe, pop halfway up the face.
    if (state.mode === 'grounded' && inQuarter) frame.rt = state.groundNormal.y > 0.5 ? 1 : 0;
    const q = quantizeInput(frame);
    const was = state.mode;
    tick(state, q, params, parkTerrain, TICK_DT);
    cornerFrames.push(q);
    if (was === 'airborne' && state.mode !== 'airborne' && z < lip && !cornerDone) {
      landed = state.landing;
      cornerDone = true;
    }
  }
  const cornerTake = buildTake({ seed: SEED, dt: TICK_DT, spawn, terrain: SLOPESTYLE, params, frames: cornerFrames });
  writeFileSync(new URL('../takes/corner.json', import.meta.url), JSON.stringify(cornerTake));
  console.log(`wrote ${cornerTake.frames.length} ticks -> takes/corner.json (corner landing: ${landed})`);
}

// Sochi straight down the right-hand (big) kicker lane: a light pop off the first jib table
// onto its flat rail, then every kicker popped — covers jib tables, wide kicker tables,
// snow friction and the switch latch.
{
  const terrain = createSlope(SOCHI);
  const lane = 4.5;
  const lipOf = (k: KickerConfig): number => k.z - (k.lipHeight / (1 - Math.cos(k.lipAngle))) * Math.sin(k.lipAngle);
  const lips = (SOCHI.kickers ?? []).filter((k) => Math.abs(k.x - lane) < 1).map(lipOf);
  // The jib tables span the course; a light tap off the first one pops onto its flat rail.
  const jibLip = lipOf((SOCHI.kickers ?? [])[0] ?? { z: 0, x: 0, width: 0, lipHeight: 1, lipAngle: 1, deckLength: 0, sideTaper: 1 });
  // Start in jib 1's flat-rail lane.
  const spawn = { position: { x: 3, y: terrain.sample(3, 0, createContact()).height + 0.2, z: 0 }, heading: Math.PI };
  const state = createRiderState(spawn);
  const sochiFrames: InputSnapshot[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 32 / TICK_DT; i++) {
    const frame = neutralInput();
    const { x, z } = state.position;
    // Jib 1's flat rail at x = 3, then into the kicker lane.
    const target = z > -60 ? 3 : lane;
    if (state.mode === 'grounded') {
      const err = Math.atan2(Math.sin(Math.PI - state.heading), Math.cos(Math.PI - state.heading));
      frame.lx = Math.max(-1, Math.min(1, -3 * err - 0.8 * (x - target)));
      if (lips.some((l) => z < l + 3.5 && z > l + 0.5)) frame.rt = 1;
      if (z < jibLip + 1 && z > jibLip + 0.4) frame.rt = 1;
    }
    if (state.mode === 'railed') frame.lx = Math.max(-1, Math.min(1, -(1.2 * state.balance + 0.5 * state.balanceVel)));
    const q = quantizeInput(frame);
    tick(state, q, params, terrain, TICK_DT);
    sochiFrames.push(q);
    seen.add(state.mode);
  }
  const sochiTake = buildTake({ seed: SEED, dt: TICK_DT, spawn, terrain: SOCHI, params, frames: sochiFrames });
  writeFileSync(new URL('../takes/sochi.json', import.meta.url), JSON.stringify(sochiTake));
  console.log(`wrote ${sochiTake.frames.length} ticks -> takes/sochi.json (modes: ${[...seen].join(', ')})`);
}

// Riding switch on a plain slope: carve right and left (the heel and toe edges swap), pop,
// and reach for a method — covers the switch latch, the edge mapping and the mirrored grab.
{
  const cfg: SlopeConfig = { length: 400, width: 120, pitch: 0.34 };
  const terrain = createSlope(cfg);
  const spawn = { position: { x: 0, y: terrain.sample(0, 0, createContact()).height + 0.2, z: 0 }, heading: 0 };
  const state = createRiderState(spawn);
  const switchFrames: InputSnapshot[] = [];
  let grabbedSwitch = false;
  for (let i = 0; i < 7 / TICK_DT; i++) {
    const t = i * TICK_DT;
    const frame = neutralInput();
    if (t > 1.5 && t < 2.3) frame.lx = 0.8;
    if (t > 2.5 && t < 3.3) frame.lx = -0.8;
    if (t > 3.6 && t < 3.9) frame.rt = 1;
    if (t > 4.0 && t < 4.6) {
      frame.rx = -0.75; // method: heel edge, leading end
      frame.ry = 0.66;
    }
    const q = quantizeInput(frame);
    tick(state, q, params, terrain, TICK_DT);
    switchFrames.push(q);
    grabbedSwitch ||= state.grabSwitch;
  }
  const switchTake = buildTake({ seed: SEED, dt: TICK_DT, spawn, terrain: cfg, params, frames: switchFrames });
  writeFileSync(new URL('../takes/switch.json', import.meta.url), JSON.stringify(switchTake));
  console.log(`wrote ${switchTake.frames.length} ticks -> takes/switch.json (switch grab: ${grabbedSwitch})`);
}

// Stick model 2: a bumper picks the hand, the stick the grab. One pop per grab on a plain
// slope — nosegrab then a shifty, seatbelt and stalefish tweaked, chicken salad, roast beef,
// and a mute pushed out to a japan.
{
  const cfg: SlopeConfig = { length: 400, width: 120, pitch: 0.34 };
  const terrain = createSlope(cfg);
  const spawn = { position: { x: 0, y: terrain.sample(0, 0, createContact()).height + 0.2, z: 0 }, heading: Math.PI };
  const state = createRiderState(spawn);
  const frames: InputSnapshot[] = [];
  // [LB, RB, stick X (toe), stick Y (nose), push]
  const plan: [boolean, boolean, number, number, number][] = [
    [true, false, 0, 1, 0.5],
    [true, false, 0, -1, 1],
    [false, true, -1, 0, 1],
    [true, false, -0.7, -0.7, 0.5],
    [false, true, -0.7, 0.7, 0.5],
    [true, false, 1, 0, 1],
  ];
  for (let i = 0; i < 16 / TICK_DT; i++) {
    const t = i * TICK_DT;
    const frame = neutralInput();
    const k = Math.floor((t - 1.5) / 2.2);
    const local = t - 1.5 - k * 2.2;
    const p = plan[k];
    if (p && local >= 0) {
      if (local < 0.3) frame.rt = 1;
      else if (local > 0.4 && local < 1.0) {
        frame.lb = p[0];
        frame.rb = p[1];
        const m = Math.hypot(p[2], p[3]);
        frame.rx = (p[2] / m) * p[4];
        frame.ry = (p[3] / m) * p[4];
      } else if (local > 1.0 && local < 1.2 && k === 0) frame.lb = true;
    }
    const q = quantizeInput(frame);
    tick(state, q, params, terrain, TICK_DT);
    frames.push(q);
  }
  const grabTake = buildTake({ seed: SEED, dt: TICK_DT, spawn, terrain: cfg, params, frames });
  writeFileSync(new URL('../takes/grabs-model2.json', import.meta.url), JSON.stringify(grabTake));
  console.log(`wrote ${grabTake.frames.length} ticks -> takes/grabs-model2.json`);
}
