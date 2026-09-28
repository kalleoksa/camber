import { TICK_DT } from '../src/core/loop.ts';
import { neutralInput, type InputSnapshot } from '../src/input/snapshot.ts';
import { params } from '../src/sim/params.ts';
import { axisZ } from '../src/sim/quat.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState, type RiderState } from '../src/sim/state.ts';
import { createContact, createSlope, type Terrain } from '../src/sim/terrain.ts';
import { length, vec3 } from '../src/sim/vec3.ts';

/**
 * Headless readout of the canonical moves. Prints numbers, asserts nothing — whether they
 * feel right is for a person with a pad. What it catches is a move that reads wrong:
 * a 180 that lands riding forward, a spin nobody asked for.
 */
const slope = createSlope({ length: 400, width: 120, pitch: 0.28 });

// Same slope with a 1.5 m step down 40 m in — something to ride straight off.
const DROP_Z = -40;
const drop: Terrain = {
  sample(x, z, out) {
    slope.sample(x, z, out);
    if (z < DROP_Z) out.height -= 1.5;
    return out;
  },
};

const deg = (r: number): string => `${Math.round((r * 180) / Math.PI)}°`;
const forward = vec3();

function spawn(terrain: Terrain): RiderState {
  const y = terrain.sample(0, 0, createContact()).height + 0.2;
  return createRiderState({ position: { x: 0, y, z: 0 }, heading: Math.PI });
}

function run(state: RiderState, terrain: Terrain, input: InputSnapshot, seconds: number): void {
  for (let i = 0; i < seconds / TICK_DT; i++) tick(state, input, params, terrain, TICK_DT);
}

/**
 * Rides until the first touchdown, then a second more, and reports how it came out.
 * `letGoAt` drops the right stick after that many seconds of air — a grab released early.
 */
function report(name: string, state: RiderState, terrain: Terrain, input: InputSnapshot, letGoAt = Infinity): void {
  let rotated = 0;
  let tweak = 0;
  for (let i = 0; i < 6 / TICK_DT && state.mode === 'airborne'; i++) {
    if (state.airTime > letGoAt) {
      input.rx = 0;
      input.ry = 0;
    }
    tweak = state.tweak;
    tick(state, input, params, terrain, TICK_DT);
    rotated = state.airYaw;
  }
  const landing = state.landing;
  run(state, terrain, neutralInput(), 1);
  axisZ(forward, state.spinFrame);
  const course = Math.atan2(state.velocity.x, state.velocity.z);
  const board = Math.atan2(forward.x, forward.z);
  const off = Math.abs(Math.atan2(Math.sin(board - course), Math.cos(board - course)));
  const riding = state.mode === 'bailed' ? 'down' : off > Math.PI / 2 ? 'switch' : 'regular';
  console.log(
    `${name.padEnd(22)} ${landing.padEnd(8)} rotated ${deg(rotated).padStart(5)}  ` +
      `${riding.padEnd(7)} ${length(state.velocity).toFixed(1).padStart(4)} m/s  tweak@contact ${tweak.toFixed(2)}`,
  );
}

/** Right stick held through the air: `rx`/`ry` pick the spot, magnitude past tweakEnter shoves. */
function pop(name: string, lx: number, ly: number, rx = 0, ry = 0, letGoAt = Infinity): void {
  const state = spawn(slope);
  const input = neutralInput();
  run(state, slope, input, 2);
  input.rt = 1;
  run(state, slope, input, 0.35);
  input.rt = 0;
  input.lx = lx;
  input.ly = ly;
  tick(state, input, params, slope, TICK_DT);
  const air = neutralInput();
  air.rx = rx;
  air.ry = ry;
  report(name, state, slope, air, letGoAt);
}

function carve(name: string, edge: number): void {
  const state = spawn(slope);
  const input = neutralInput();
  run(state, slope, input, 2);
  input.lx = edge;
  run(state, slope, input, 3);
  console.log(`${name.padEnd(22)} ${state.mode.padEnd(8)} ${length(state.velocity).toFixed(1)} m/s after 3 s`);
}

function rideOff(name: string, edge: number): void {
  const state = spawn(drop);
  const input = neutralInput();
  run(state, drop, input, 1); // settle from the spawn drop first
  // Straight at the lip, edge on for the last few metres — a carve held from the top
  // would turn across the hill and stall before it got there.
  for (let i = 0; i < 10 / TICK_DT && state.mode !== 'airborne'; i++) {
    if (state.position.z < DROP_Z + 6) input.lx = edge;
    tick(state, input, params, drop, TICK_DT);
  }
  report(name, state, drop, input);
}

console.log('move                   landing  rotated     riding  speed');
pop('straight air', 0, 0);
pop('180 (half stick)', 0.5, 0);
pop('360 (full stick)', 1, 0);
pop('cork 180', 0.5, 1);
pop('indy, no tweak', 0, 0, 0.5, -0.1);
pop('method held to contact', 0, 0, -1, 0.05);
pop('method, let go 0.3 s', 0, 0, -1, 0.05, 0.3);
pop('360 + indy (tuck)', 1, 0, 0.5, -0.1);
rideOff('ride off, flat', 0);
rideOff('ride off, carving', 0.6);
carve('toe edge held', 1);
carve('heel edge held', -1);
