import type { InputSnapshot } from '../../input/snapshot.ts';
import type { Params } from '../params.ts';
import { tweakAxis } from '../board.ts';
import { axisY, axisZ, multiply, normalizeQuat, quat, setFromAxisAngle, type Quat } from '../quat.ts';
import type { RiderState } from '../state.ts';
import { setTakeoffSpin } from './grounded.ts';
import { createContact, type Terrain } from '../terrain.ts';
import {
  addScaled,
  clampLength,
  copyInto,
  damp,
  dampScalar,
  dot,
  length,
  normalize,
  projectOntoPlane,
  scale,
  vec3,
  wrapAngle,
  type Vec3,
} from '../vec3.ts';
import * as dm from '../dmath.ts';

const contact = createContact();
const spin = quat();
const boardForward = vec3();
const boardUp = vec3();
const course = vec3();
const axis = vec3();
const tweakQ = quat();
const shiftyQ = quat();
const UP = vec3(0, 1, 0);
const composed = quat();

export function stepAirborne(
  state: RiderState,
  input: InputSnapshot,
  params: Params,
  terrain: Terrain,
  dt: number,
): void {
  const p = state.position;
  const v = state.velocity;

  state.scrub = 0;
  state.compress = dampScalar(state.compress, input.rt, params.pop.compressResponse, dt);

  // Stick position means the same thing in the air as it did at takeoff: spin speed.
  // Just after a pop it still *is* takeoff — the window forgives a stick that lands a
  // frame after the trigger. After that, `air.authority` is how fast the board answers a
  // stick change, so a short air can't fully retarget. Holding the stick holds the spin;
  // centring it checks the spin at `air.checkRate` — opening up to spot the landing.
  // Checking only ever removes rotation, so takeoff still decides how much you have.
  if (state.popWindow > 0) {
    // Only a stronger stick counts: a late wind-up is forgiven, a flick already released
    // is not taken back.
    state.popWindow = Math.max(0, state.popWindow - dt);
    if (Math.abs(input.lx * params.air.spinTakeoff) > Math.abs(state.spinRate)) setTakeoffSpin(state, input, params);
  } else if (input.lx !== 0) {
    const target = -input.lx * params.air.spinTakeoff;
    state.spinRate += (target - state.spinRate) * (1 - dm.exp(-params.air.authority * dt));
  } else {
    state.spinRate *= dm.exp(-params.air.checkRate * dt);
  }
  if (state.spinRate > params.air.spinMax) state.spinRate = params.air.spinMax;
  if (state.spinRate < -params.air.spinMax) state.spinRate = -params.air.spinMax;

  updateGrab(state, input, params, dt);

  // Shifty: board yawed under a still body. Buttons, so it's all or nothing in intent;
  // the spring is what makes it a motion rather than a snap.
  const shiftyTarget = ((input.rb ? 1 : 0) - (input.lb ? 1 : 0)) * params.air.shiftyMax;
  state.shifty = dampScalar(state.shifty, shiftyTarget, params.air.shiftyRate, dt);

  // A grab tucks the body in and spins faster; shoving the board out on a tweak extends
  // it and spins slower. Scales what the board does, not the rate the stick is steering.
  const body = params.air.tuckMultiplier + (params.air.extendMultiplier - params.air.tuckMultiplier) * state.tweak;
  const rate = state.spinRate * (1 + (body - 1) * state.grip);

  // Body-fixed axis, so this is a local-space rotation. Never snapped, never quantized.
  setFromAxisAngle(spin, state.spinAxis, rate * dt);
  multiply(state.spinFrame, state.spinFrame, spin);
  normalizeQuat(state.spinFrame);
  state.airYaw += Math.abs(rate) * dt;

  v.y -= params.world.gravity * dt;
  clampLength(v, params.world.terminalSpeed);
  addScaled(p, v, dt);
  state.airTime += dt;

  terrain.sample(p.x, p.z, contact);
  state.clearance = p.y - contact.height;
  damp(state.groundNormal, contact.normal, params.ground.normalSmoothing, dt);

  if (state.clearance > 0) return;

  p.y = contact.height;
  state.clearance = 0;
  land(state, params, contact.normal);
}

/**
 * Right stick is a point on the board (§7.3): direction picks where, magnitude past
 * `grab.commit` reaches for it, past `grab.tweakEnter` shoves the board out. The hand is
 * chosen from `t` when it starts reaching and kept until it lets go, so sliding along the
 * board mid-grab doesn't swap hands.
 */
function updateGrab(state: RiderState, input: InputSnapshot, params: Params, dt: number): void {
  const g = params.grab;
  const m = Math.min(1, Math.sqrt(input.rx * input.rx + input.ry * input.ry));
  let tweakTarget = 0;

  if (m > g.commit) {
    const edge = (input.rx / m) * g.edgeSharpness;
    state.grabEdge = edge > 1 ? 1 : edge < -1 ? -1 : edge;
    state.grabT = 0.5 + 0.5 * (input.ry / m);
    if (state.grip === 0) state.grabFront = state.grabT >= 0.5;
    state.grip = Math.min(1, state.grip + dt / g.reachTime);
    // Only a hand that has hold of the board can shove it.
    if (m > g.tweakEnter) tweakTarget = ((m - g.tweakEnter) / (1 - g.tweakEnter)) * state.grip;
  } else {
    state.grip = Math.max(0, state.grip - dt / g.releaseTime);
  }

  // Recovery is its own rate and does not wait for the hand: letting go always starts
  // pulling the board back, which is the wager in §6.
  const rate = tweakTarget > state.tweak ? g.tweakRate : g.tweakRecover;
  state.tweak = dampScalar(state.tweak, tweakTarget, rate, dt);
}

/**
 * Drawn board = spinFrame ∘ shifty ∘ tweakOffset. What the landing test must read (§6,
 * §7.4). The shifty yaws the board under the body; the tweak then pivots it about the
 * grab point in that yawed frame — the same order the rig draws it in.
 */
function composeBoard(out: Quat, state: RiderState, params: Params): Quat {
  setFromAxisAngle(shiftyQ, UP, state.shifty);
  tweakAxis(axis, state.grabEdge, state.grabT);
  setFromAxisAngle(tweakQ, axis, state.tweak * params.grab.tweakDepthMax);
  multiply(out, state.spinFrame, shiftyQ);
  return multiply(out, out, tweakQ);
}

/**
 * Design §6. The whole thing turns on two angles, and it is deliberately the only place
 * rotation is ever corrected. Resist adding a rotation-count check — the angle contains it.
 */
function land(state: RiderState, params: Params, n: Vec3): void {
  const v = state.velocity;

  state.impact = Math.abs(dot(v, n));

  // A method still hanging off axis at contact fails θ and φ both — hold it for style,
  // pull it back in time, or eat it.
  composeBoard(composed, state, params);
  axisZ(boardForward, composed);
  axisY(boardUp, composed);
  state.grip = 0;
  state.tweak = 0;
  state.shifty = 0;
  projectOntoPlane(boardForward, n);
  normalize(boardForward);

  copyInto(course, v);
  projectOntoPlane(course, n);
  const courseSpeed = length(course);

  // The board's heading is whatever the air left it at, not what it took off with —
  // otherwise a 180 lands, is judged, and is then silently rebuilt facing forward.
  if (boardForward.x !== 0 || boardForward.z !== 0) state.heading = planeHeading(boardForward, n);

  // Below walking pace the velocity direction is noise, so only the roll angle matters.
  let theta = 0;
  if (courseSpeed > params.ground.pivotSpeed) {
    normalize(course);
    const cos = Math.min(1, Math.max(-1, dot(boardForward, course)));
    theta = dm.acos(cos);
    if (theta > Math.PI / 2) theta = Math.PI - theta; // fold: switch landings are legal
  }
  const phi = dm.acos(Math.min(1, Math.max(-1, dot(boardUp, n))));

  if (theta < params.land.clean && phi < params.land.rollClean) {
    state.landing = 'clean';
  } else if (theta < params.land.sketchy && phi < params.land.rollSketchy) {
    state.landing = 'sketchy';
  } else {
    state.mode = 'bailed';
    state.landing = 'bail';
    state.bailTime = 0;
    state.spinRate = 0;
    state.headingTarget = state.heading;
    return;
  }

  // Aim heading at the direction of travel, keeping switch if that is the near side.
  // Converged over the absorb window rather than teleported — an instant snap of up to
  // land.sketchy reads as the game rounding your trick off for you.
  if (courseSpeed > params.ground.pivotSpeed) {
    const courseHeading = planeHeading(course, n);
    const delta = wrapAngle(courseHeading - state.heading);
    state.headingTarget = wrapAngle(Math.abs(delta) > Math.PI / 2 ? courseHeading + Math.PI : courseHeading);
  } else {
    state.headingTarget = state.heading;
  }

  projectOntoPlane(v, n);
  if (state.landing === 'sketchy') scale(v, 1 - params.land.sketchySpeedLoss);

  state.mode = 'grounded';
  state.airTime = 0;
  state.spinRate = 0;
  state.absorb = params.land.absorbTime;
}

/**
 * Inverse of how grounded builds `forward`: the heading whose horizontal (sin, 0, cos),
 * projected onto the plane of `n`, points along in-plane vector `b`. Lift `b` back to
 * horizontal along `n`, then read its yaw. A plain atan2 of `b` is off on a tilted plane.
 */
function planeHeading(b: Vec3, n: Vec3): number {
  const s = b.y / n.y;
  return dm.atan2(b.x - n.x * s, b.z - n.z * s);
}
