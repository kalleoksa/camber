import { writeFileSync } from 'node:fs';
import { TICK_DT } from '../src/core/loop.ts';
import { buildTake } from '../src/input/recorder.ts';
import { neutralInput, type InputSnapshot } from '../src/input/snapshot.ts';
import { params } from '../src/sim/params.ts';
import { createRng, next } from '../src/sim/rng.ts';
import { createContact, createSlope, type SlopeConfig } from '../src/sim/terrain.ts';
import { dampScalar } from '../src/sim/vec3.ts';

/**
 * Synthesises a take that exercises every input — grabs, tweaks, shifty — so the
 * determinism check covers paths a real ride may not. takes/hill-run.json is the real one.
 */
const SEED = 1;
const SECONDS = 12;
const slopeConfig: SlopeConfig = { length: 400, width: 120, pitch: 0.28 };

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
