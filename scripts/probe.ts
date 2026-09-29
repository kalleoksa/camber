import { TICK_DT } from '../src/core/loop.ts';
import { neutralInput, type InputSnapshot } from '../src/input/snapshot.ts';
import { params } from '../src/sim/params.ts';
import { axisZ } from '../src/sim/quat.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState, type RiderState } from '../src/sim/state.ts';
import { createContact, createSlope, type Terrain } from '../src/sim/terrain.ts';
import { length, vec3 } from '../src/sim/vec3.ts';
import { SLOPESTYLE } from '../src/park/slopestyle.ts';

/**
 * Headless readout of the canonical moves. Prints numbers, asserts nothing — whether they
 * feel right is for a person with a pad. What it catches is a move that reads wrong:
 * a 180 that lands riding forward, a spin nobody asked for.
 */
const slope = createSlope({ length: 400, width: 120, pitch: 0.28 });

// Same slope with a 1.5 m step down 40 m in — something to ride straight off.
const DROP_Z = -40;
const drop: Terrain = {
  rails: [],
  sample(x, z, out) {
    slope.sample(x, z, out);
    if (z < DROP_Z) out.height -= 1.5;
    return out;
  },
};

// The kicker the game places (main.ts), for airs off a lip.
const KICKER = { z: -16, x: 0, width: 10, lipHeight: 6, lipAngle: 0.5, deckLength: 5, sideTaper: 3, landingAngle: 0.3, knuckleRadius: 5, runoutRadius: 18 };
const kickerSlope = createSlope({ length: 400, width: 120, pitch: 0.28, kicker: KICKER });
// m from the kicker's start to the lip: the transition is an arc with H = R(1 − cos θ).
const KICKER_RUN_IN = (KICKER.lipHeight / (1 - Math.cos(KICKER.lipAngle))) * Math.sin(KICKER.lipAngle);

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
function report(
  name: string,
  state: RiderState,
  terrain: Terrain,
  input: InputSnapshot,
  letGoAt = Infinity,
  checkAt = Infinity,
  corkFor = Infinity,
): void {
  let rotated = 0;
  let tweak = 0;
  for (let i = 0; i < 6 / TICK_DT && state.mode === 'airborne'; i++) {
    if (state.airTime > checkAt) input.lx = 0;
    if (state.airTime > corkFor) input.ly = 0;
    if (state.airTime > letGoAt) {
      input.rx = 0;
      input.ry = 0;
      input.rb = false;
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

type Air = { lx?: number; ly?: number; rx?: number; ry?: number; letGoAt?: number; checkAt?: number; shifty?: boolean };

/**
 * Full pop. Left stick held into the air until `checkAt` s, then centred to check the
 * spin. Right stick held (`rx`/`ry` pick the spot, past tweakEnter shoves) and RB for
 * `shifty`, both released at `letGoAt`.
 */
function pop(name: string, { lx = 0, ly = 0, rx = 0, ry = 0, letGoAt = Infinity, checkAt = Infinity, shifty = false }: Air = {}): void {
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
  air.lx = lx;
  air.rx = rx;
  air.ry = ry;
  air.rb = shifty;
  report(name, state, slope, air, letGoAt, checkAt);
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

/** Straight at the kicker; optionally pop at the lip with a spin, checked at `checkAt`. */
function kicker(name: string, pop: boolean, lx = 0, checkAt = Infinity, ly = 0, corkFor = Infinity): void {
  const state = spawn(kickerSlope);
  const input = neutralInput();
  for (let i = 0; i < 20 / TICK_DT && state.mode !== 'airborne' || i < 120; i++) {
    const s = KICKER.z - state.position.z;
    input.rt = pop && s > KICKER_RUN_IN - 4 && s < KICKER_RUN_IN - 0.6 ? 1 : 0;
    input.lx = pop && s > KICKER_RUN_IN - 4 ? lx : 0;
    input.ly = pop && s > KICKER_RUN_IN - 4 ? ly : 0;
    tick(state, input, params, kickerSlope, TICK_DT);
  }
  const air = neutralInput();
  air.lx = lx;
  air.ly = ly;
  report(name, state, kickerSlope, air, Infinity, checkAt, corkFor);
}

const railSlope = createSlope({ length: 400, width: 120, pitch: 0.28, rails: [{ points: [[0, 0.6, -10], [0, 0.6, -35]] }] });

/**
 * Dropped onto a rail at 8 m/s. `balanced` stands in for a thumb: a proportional-derivative
 * correction on the lean, which is roughly what holding a rail feels like. `slide` holds RB
 * until the board is that far across the rail; `press` is stick Y.
 */
function rail(name: string, { balanced = false, slide = 0, press = 0, offset = 0 } = {}): void {
  const r = railSlope.rails[0];
  if (!r) return;
  const state = createRiderState({ position: { x: offset, y: (r.y[0] ?? 0) - 0.02 * 1 + 0.2, z: -11 }, heading: Math.PI });
  state.velocity.z = -8 * Math.cos(0.28);
  state.velocity.y = -8 * Math.sin(0.28) - 1;
  const input = neutralInput();
  let onFor = 0;
  let exit = 'missed';
  let exitSpeed = 0;
  let maxLean = 0;
  for (let i = 0; i < 12 / TICK_DT; i++) {
    const was = state.mode;
    input.ly = press;
    input.rb = slide > 0 && state.mode === 'railed' && Math.abs(state.slide) < slide;
    input.lx = balanced && state.mode === 'railed' ? Math.max(-1, Math.min(1, -(1.2 * state.balance + 0.5 * state.balanceVel))) : 0;
    tick(state, input, params, railSlope, TICK_DT);
    if (state.mode === 'railed') {
      onFor += TICK_DT;
      maxLean = Math.max(maxLean, Math.abs(state.balance));
    }
    if (was === 'railed' && state.mode !== 'railed') {
      exit = state.mode === 'bailed' ? 'fell off' : 'rode off the end';
      exitSpeed = length(state.velocity);
      break;
    }
  }
  console.log(`${name.padEnd(26)} ${exit.padEnd(16)} ${onFor.toFixed(2)} s on, lean max ${maxLean.toFixed(2)}, off at ${exitSpeed.toFixed(1)} m/s`);
}

console.log('move                   landing  rotated     riding  speed');

/**
 * Butter: roll off at low speed, then full press and full edge stick for `hold` s. Reports
 * how far the board came round and where it ends up against the direction of travel —
 * a butter 180 turns the board and not the rider's path, so that should read ~180°.
 */
function butter(name: string, ly: number, hold: number, rollFor = 1): void {
  const state = spawn(slope);
  const input = neutralInput();
  run(state, slope, input, rollFor);
  const before = length(state.velocity);
  let turned = 0;
  let prev = state.heading;
  input.ly = ly;
  input.lx = ly;
  for (let i = 0; i < hold / TICK_DT; i++) {
    tick(state, input, params, slope, TICK_DT);
    turned += Math.atan2(Math.sin(state.heading - prev), Math.cos(state.heading - prev));
    prev = state.heading;
  }
  const course = Math.atan2(state.velocity.x, state.velocity.z);
  const rel = Math.atan2(Math.sin(state.heading - course), Math.cos(state.heading - course));
  console.log(
    `${name.padEnd(26)} ${before.toFixed(1)} -> ${length(state.velocity).toFixed(1)} m/s, ` +
      `board turned ${deg(Math.abs(turned))}, ${deg(Math.abs(rel))} to travel`,
  );
}

/** The park's wall with nothing else in the way: carve over at `aim` rad and ride it. */
const wallSlope = createSlope({ ...SLOPESTYLE, kickers: [], rails: [] });
function wall(name: string, aim: number, along: number, pop: 'none' | 'transition' | 'flat' = 'none'): void {
  const state = spawn(wallSlope);
  const input = neutralInput();
  const c = createContact();
  let walled = 0;
  let top = 0;
  let speedOn = 0;
  for (let i = 0; i < 9 / TICK_DT && state.position.z > -85; i++) {
    const onIt = state.mode === 'walled' || (state.position.x > 10.5 && state.mode === 'grounded');
    const target = onIt ? Math.PI - along : state.position.z < -30 ? Math.PI - aim : Math.PI;
    const err = Math.atan2(Math.sin(target - state.heading), Math.cos(target - state.heading));
    input.lx = Math.max(-1, Math.min(1, -3 * err));
    // Charge on the way in, let go on the transition or just before it on flat snow.
    const ny = wallSlope.sample(state.position.x, state.position.z, c).normal.y;
    const x = state.position.x;
    input.rt = pop === 'transition' ? (x > 8 && ny > 0.6 ? 1 : 0) : pop === 'flat' ? (x > 7 && x < 9.2 ? 1 : 0) : 0;
    tick(state, input, params, wallSlope, TICK_DT);
    if (state.mode === 'walled') {
      if (walled === 0) speedOn = length(state.velocity);
      walled += TICK_DT;
      top = Math.max(top, state.position.y - wallSlope.sample(0, state.position.z, c).height);
    }
  }
  console.log(
    `${name.padEnd(26)} ${walled > 0 ? `walled ${walled.toFixed(2)} s, on at ${speedOn.toFixed(1)} m/s, up ${top.toFixed(1)} m` : 'never walled'}`,
  );
}


pop('straight air');
pop('180, check 0.55 s', { lx: 0.5, checkAt: 0.55 });
pop('180, never check', { lx: 0.5 });
pop('360, check 0.57 s', { lx: 1, checkAt: 0.57 });
pop('360, never check', { lx: 1 });
pop('cork 180', { lx: 0.5, ly: 1, checkAt: 0.55 });
pop('indy, no tweak', { rx: 0.5, ry: -0.1 });
pop('melon tweaked to contact', { rx: -1, ry: 0.05 });
pop('method held to contact', { rx: -0.75, ry: 0.66 });
pop('method, let go 0.3 s', { rx: -0.75, ry: 0.66, letGoAt: 0.3 });
pop('360 + indy, check 0.42', { lx: 1, rx: 0.5, ry: -0.1, checkAt: 0.42 });
pop('mute', { rx: 0.5, ry: 0.1 });
pop('shifty held to contact', { shifty: true });
pop('shifty, let go 0.3 s', { shifty: true, letGoAt: 0.3 });
rideOff('ride off, flat', 0);
rideOff('ride off, carving', 0.6);
kicker('kicker, straight', false);
kicker('kicker, popped', true);
kicker('kicker 360, check 0.55', true, 1, 0.55);
kicker('kicker 540, check 0.9', true, 1, 0.9);
kicker('kicker cork 360', true, 1, 0.55, 0.8, 0.4);
kicker('kicker cork 540 fakie', true, 1, 0.9, 0.9, 0.7);
kicker('cork held: double cork', true, 1, 0.9, 0.9);
kicker('kicker backflip', true, 0, Infinity, -1, 1.0);
kicker('kicker frontflip', true, 0, Infinity, 1, 1.0);
kicker('backflip let go early', true, 0, Infinity, -1, 0.4);
rail('50-50, hands off');
rail('50-50, balanced', { balanced: true });
rail('boardslide, hands off', { slide: 1.5 });
rail('boardslide, balanced', { balanced: true, slide: 1.5 });
rail('tailslide, balanced', { balanced: true, press: -1 });
carve('toe edge held', 1);
carve('heel edge held', -1);
butter('nose butter 180', 1, 1);
butter('tail butter 180', -1, 1);
butter('press at speed, no butter', 1, 0.6, 3.5);
wall('wall, steep approach', 0.6, 0.5);
wall('wall, along the face', 0.6, 0.3);
wall('wall, too shallow', 0.4, 0.3);
wall('wall, pop on transition', 0.6, 0.5, 'transition');
wall('wall, pop, along the face', 0.6, 0.2, 'transition');
wall('wall, ollie in from flat', 0.6, 0.5, 'flat');
