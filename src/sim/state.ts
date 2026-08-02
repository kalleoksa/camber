import { copy, vec3, type Vec3 } from './vec3.ts';

export type RiderMode = 'grounded' | 'airborne' | 'railed' | 'walled' | 'bailed';

export type Spawn = {
  position: Vec3;
  heading: number;
};

/** The single source of truth. Everything render, audio and the panel read comes from here. */
export type RiderState = {
  tick: number;
  mode: RiderMode;

  position: Vec3;
  velocity: Vec3;

  heading: number; // rad, board yaw about the terrain normal
  edge: number; // -1..1, negative = heel
  stance: number; // -1..1, negative = tail
  compress: number; // 0..1, knee bend

  groundNormal: Vec3; // smoothed, what the board is slaved to
  scrub: number; // m/s² the edge is removing from lateral velocity — drives spray and edge bite
  clearance: number; // m above the contact point
  airTime: number; // s since leaving the ground

  resetLatch: boolean; // debounces the reset button
  spawn: Spawn;
};

export function createRiderState(spawn: Spawn): RiderState {
  return {
    tick: 0,
    mode: 'airborne',
    position: copy(spawn.position),
    velocity: vec3(),
    heading: spawn.heading,
    edge: 0,
    stance: 0,
    compress: 0,
    groundNormal: vec3(0, 1, 0),
    scrub: 0,
    clearance: 0,
    airTime: 0,
    resetLatch: false,
    spawn: { position: copy(spawn.position), heading: spawn.heading },
  };
}

/** Reachable from `tick()` via the reset button, so it writes in place (invariant 7). */
export function resetRiderState(state: RiderState): void {
  const spawn = state.spawn;
  state.tick = 0;
  state.mode = 'airborne';
  copyInto(state.position, spawn.position);
  setXYZ(state.velocity, 0, 0, 0);
  setXYZ(state.groundNormal, 0, 1, 0);
  state.scrub = 0;
  state.heading = spawn.heading;
  state.edge = 0;
  state.stance = 0;
  state.compress = 0;
  state.clearance = 0;
  state.airTime = 0;
}

/** Copy without allocating — the render loop keeps one previous-state buffer. */
export function copyRiderState(dst: RiderState, src: RiderState): void {
  dst.tick = src.tick;
  dst.mode = src.mode;
  copyInto(dst.position, src.position);
  copyInto(dst.velocity, src.velocity);
  copyInto(dst.groundNormal, src.groundNormal);
  dst.heading = src.heading;
  dst.edge = src.edge;
  dst.stance = src.stance;
  dst.compress = src.compress;
  dst.scrub = src.scrub;
  dst.clearance = src.clearance;
  dst.airTime = src.airTime;
  dst.resetLatch = src.resetLatch;
}

function copyInto(dst: Vec3, src: Vec3): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}

function setXYZ(dst: Vec3, x: number, y: number, z: number): void {
  dst.x = x;
  dst.y = y;
  dst.z = z;
}

export function cloneRiderState(state: RiderState): RiderState {
  return {
    ...state,
    position: copy(state.position),
    velocity: copy(state.velocity),
    groundNormal: copy(state.groundNormal),
    spawn: { position: copy(state.spawn.position), heading: state.spawn.heading },
  };
}
