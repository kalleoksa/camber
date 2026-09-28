import { copyQuat, quat, type Quat } from './quat.ts';
import { copy, vec3, type Vec3 } from './vec3.ts';

export type RiderMode = 'grounded' | 'airborne' | 'railed' | 'walled' | 'bailed';

/** How the last contact from AIRBORNE was judged (§6). Render and audio read it. */
export type LandingRead = 'none' | 'clean' | 'sketchy' | 'bail';

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
  headingTarget: number; // rad, where a landing wants heading — converged, not teleported
  edge: number; // -1..1, negative = heel
  stance: number; // -1..1, negative = tail
  compress: number; // 0..1, pop charge
  charge: number; // s RT has been held — drives compress, bleeds past full

  /**
   * Board orientation. Grounded it is rebuilt from heading and the contact normal each
   * tick; airborne it integrates angular velocity. The tweak composes on top of this for
   * what gets drawn and for the landing test — never welded into it (§7.4).
   */
  spinFrame: Quat;
  spinAxis: Vec3; // board-local, set at takeoff
  spinRate: number; // rad/s about spinAxis
  airYaw: number; // rad of board yaw accumulated this air

  // The active grab (§7.3). Coordinate and hand persist after release so a tweak still
  // springing back keeps its pivot.
  grabEdge: number; // -1 heel .. +1 toe
  grabT: number; // 0 tail .. 1 nose
  grabFront: boolean; // which hand — picked from t at the moment of reaching, then held
  grip: number; // 0 = hand at rest, 1 = locked to the board
  tweak: number; // 0..1 of grab.tweakDepthMax, about the grab point
  shifty: number; // rad, board yaw about its own up, independent of the body

  groundNormal: Vec3; // smoothed, what the board is slaved to
  scrub: number; // m/s² the edge is removing from lateral velocity — drives spray and edge bite
  clearance: number; // m above the contact point
  airTime: number; // s since leaving the ground
  popWindow: number; // s left in which the stick still counts as takeoff

  landing: LandingRead; // result of the most recent touchdown
  impact: number; // m/s of normal velocity absorbed at that touchdown
  absorb: number; // s remaining of the landing absorb
  bailTime: number; // s spent down

  resetLatch: boolean; // debounces the reset button
  popLatch: boolean; // true while RT is held past pop.trigger
  spawn: Spawn;
};

export function createRiderState(spawn: Spawn): RiderState {
  return {
    tick: 0,
    mode: 'airborne',
    position: copy(spawn.position),
    velocity: vec3(),
    heading: spawn.heading,
    headingTarget: spawn.heading,
    edge: 0,
    stance: 0,
    compress: 0,
    charge: 0,
    spinFrame: yawFrame(quat(), spawn.heading),
    spinAxis: vec3(0, 1, 0),
    spinRate: 0,
    airYaw: 0,
    grabEdge: 0,
    grabT: 0.5,
    grabFront: true,
    grip: 0,
    tweak: 0,
    shifty: 0,
    groundNormal: vec3(0, 1, 0),
    scrub: 0,
    clearance: 0,
    airTime: 0,
    popWindow: 0,
    landing: 'none',
    impact: 0,
    absorb: 0,
    bailTime: 0,
    resetLatch: false,
    popLatch: false,
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
  yawFrame(state.spinFrame, spawn.heading);
  setXYZ(state.spinAxis, 0, 1, 0);
  state.spinRate = 0;
  state.airYaw = 0;
  state.grabEdge = 0;
  state.grabT = 0.5;
  state.grabFront = true;
  state.grip = 0;
  state.tweak = 0;
  state.shifty = 0;
  state.scrub = 0;
  state.heading = spawn.heading;
  state.headingTarget = spawn.heading;
  state.edge = 0;
  state.stance = 0;
  state.compress = 0;
  state.charge = 0;
  state.clearance = 0;
  state.airTime = 0;
  state.popWindow = 0;
  state.landing = 'none';
  state.impact = 0;
  state.absorb = 0;
  state.bailTime = 0;
  state.popLatch = false;
}

/** Copy without allocating — the render loop keeps one previous-state buffer. */
export function copyRiderState(dst: RiderState, src: RiderState): void {
  dst.tick = src.tick;
  dst.mode = src.mode;
  copyInto(dst.position, src.position);
  copyInto(dst.velocity, src.velocity);
  copyInto(dst.groundNormal, src.groundNormal);
  copyQuat(dst.spinFrame, src.spinFrame);
  copyInto(dst.spinAxis, src.spinAxis);
  dst.spinRate = src.spinRate;
  dst.airYaw = src.airYaw;
  dst.grabEdge = src.grabEdge;
  dst.grabT = src.grabT;
  dst.grabFront = src.grabFront;
  dst.grip = src.grip;
  dst.tweak = src.tweak;
  dst.shifty = src.shifty;
  dst.heading = src.heading;
  dst.headingTarget = src.headingTarget;
  dst.edge = src.edge;
  dst.stance = src.stance;
  dst.compress = src.compress;
  dst.charge = src.charge;
  dst.scrub = src.scrub;
  dst.clearance = src.clearance;
  dst.airTime = src.airTime;
  dst.popWindow = src.popWindow;
  dst.landing = src.landing;
  dst.impact = src.impact;
  dst.absorb = src.absorb;
  dst.bailTime = src.bailTime;
  dst.resetLatch = src.resetLatch;
  dst.popLatch = src.popLatch;
}

/**
 * Level board facing `heading`: a yaw about world up, written directly so reset stays
 * allocation-free. It must agree with `heading`, because landing reads heading back
 * out of the frame.
 */
function yawFrame(out: Quat, heading: number): Quat {
  out.x = 0;
  out.y = Math.sin(heading / 2);
  out.z = 0;
  out.w = Math.cos(heading / 2);
  return out;
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
    spinFrame: copyQuat(quat(), state.spinFrame),
    spinAxis: copy(state.spinAxis),
    spawn: { position: copy(state.spawn.position), heading: state.spawn.heading },
  };
}
