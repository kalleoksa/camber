import type { InputSnapshot } from '../../input/snapshot.ts';
import type { Params } from '../params.ts';
import { axisY, setFromBasis } from '../quat.ts';
import type { RiderState } from '../state.ts';
import { createContact, type Terrain } from '../terrain.ts';
import {
  addScaled,
  clampLength,
  cross,
  damp,
  dampScalar,
  dot,
  length,
  normalize,
  projectOntoPlane,
  set,
  vec3,
  wrapAngle,
  type Vec3,
} from '../vec3.ts';
import * as dm from '../dmath.ts';

const contact = createContact();
const forward = vec3();
const toeSide = vec3();
const heelSide = vec3();
const rotation = vec3();

/**
 * ln 5, so `speedFactor` reaches 0.8 exactly at `ground.speedFactorKnee` — that is what
 * the parameter means, not a tunable of its own.
 */
const KNEE_AT_80 = dm.log(5);

/** Rises fast, then plateaus, and is 0 at a standstill: you cannot turn without speed. */
function speedFactor(speed: number, knee: number): number {
  if (knee <= 0) return 1;
  return 1 - dm.exp((-KNEE_AT_80 * speed) / knee);
}

export function stepGrounded(
  state: RiderState,
  input: InputSnapshot,
  params: Params,
  terrain: Terrain,
  dt: number,
): void {
  const p = state.position;
  const v = state.velocity;
  const g = params.ground;

  terrain.sample(p.x, p.z, contact);
  damp(state.groundNormal, contact.normal, g.normalSmoothing, dt);
  const n = contact.normal;

  // Finish off a landing correction, if one is pending, before the carve reads heading.
  if (state.absorb > 0) {
    const delta = wrapAngle(state.headingTarget - state.heading);
    state.heading = wrapAngle(state.heading + delta * (1 - dm.exp(-params.land.headingSnap * dt)));
  }

  // Tangential component of gravity on the contact plane: g*(down − n*(down·n)).
  const gravity = params.world.gravity;
  v.x += gravity * (n.x * n.y) * dt;
  v.y += gravity * (n.y * n.y - 1) * dt;
  v.z += gravity * (n.z * n.y) * dt;
  projectOntoPlane(v, n);

  // Board basis in the contact plane. For a regular rider travelling nose-first the toe
  // side is to the right of travel, which is `forward × n`, not `n × forward`.
  set(forward, dm.sin(state.heading), 0, dm.cos(state.heading));
  projectOntoPlane(forward, n);
  normalize(forward);
  cross(toeSide, forward, n);

  // Grounded, the board is slaved to the terrain, so the spin frame is rebuilt rather
  // than integrated. Local X is the heel side (design §1), Y is up, Z is the nose.
  heelSide.x = -toeSide.x;
  heelSide.y = -toeSide.y;
  heelSide.z = -toeSide.z;
  setFromBasis(state.spinFrame, heelSide, n, forward);

  let vf = dot(v, forward);
  let vl = dot(v, toeSide);

  const edgeMag = Math.min(Math.abs(state.edge), 1);
  const stanceMag = Math.min(Math.abs(state.stance), 1);

  // The one curve carving lives on: flat base skids, a set edge locks.
  let grip = g.gripFlat + (g.gripEdge - g.gripFlat) * dm.pow(edgeMag, g.gripCurve);
  grip *= 1 - stanceMag * g.stanceGripLoss;
  grip *= 1 - input.lt * g.brakeGripLoss;

  const speedBefore = Math.sqrt(vf * vf + vl * vl);
  const vlAfter = vl * dm.exp(-Math.max(grip, 0) * dt);
  const scrubbed = Math.abs(vl) - Math.abs(vlAfter);

  // Invariant 2: the edge *rotates* the velocity vector toward the board. Holding the
  // speed constant while the lateral component shrinks is exactly that rotation.
  // `carveHold` blends between it and the friction-cone version that just eats the
  // lateral component — at 1.0 a carve is free, at 0.0 it is a skid.
  const vfRotated = Math.sign(vf) * Math.sqrt(Math.max(0, speedBefore * speedBefore - vlAfter * vlAfter));
  vf += (vfRotated - vf) * g.carveHold;
  vl = vlAfter;
  state.scrub = scrubbed / dt;

  let speed = Math.sqrt(vf * vf + vl * vl);
  if (speed > 0) {
    const drag = (g.drag * speed * speed + input.lt * g.brakeDecel) * dt;
    const carveCost = g.edgeDrag * edgeMag * scrubbed;
    const keep = Math.max(0, speed - drag - carveCost) / speed;
    vf *= keep;
    vl *= keep;
    speed *= keep;
  }

  v.x = forward.x * vf + toeSide.x * vl;
  v.y = forward.y * vf + toeSide.y * vl;
  v.z = forward.z * vf + toeSide.z * vl;
  clampLength(v, params.world.terminalSpeed);

  // Carve rotation. Nose or tail press moves the effective pivot along the board, which
  // reads as a tighter, twitchier turn.
  let yaw = state.edge * g.carveYaw * speedFactor(speed, g.speedFactorKnee) * (1 + stanceMag * g.stanceYawGain);
  if (speed < g.pivotSpeed) {
    // Low-authority skid pivot so a stopped rider isn't stuck facing the wrong way.
    yaw += state.edge * g.pivotYaw * (1 - speed / g.pivotSpeed);
  }
  // Increasing `heading` swings the nose toward `n × forward`, which is the heel side.
  // A toe-edge carve goes the other way, so positive edge subtracts.
  state.heading = wrapAngle(state.heading - yaw * dt);

  if (state.absorb > 0) state.absorb = Math.max(0, state.absorb - dt);

  // Pop: charge while RT is held, bleed once full, fire the impulse on release.
  const held = input.rt > params.pop.trigger;
  if (held) {
    state.popLatch = true;
    state.charge += dt;
    state.compress =
      state.charge <= params.pop.chargeTime
        ? state.charge / params.pop.chargeTime
        : Math.max(0, 1 - (state.charge - params.pop.chargeTime) * params.pop.decay);
  } else if (state.popLatch) {
    state.popLatch = false;
    // Along the contact normal, not world up — ramp geometry then needs no special case.
    const bias = 1 - state.stance * params.pop.stanceBias;
    addScaled(v, n, (params.pop.base + params.pop.charged * state.compress) * bias);
    state.charge = 0;
    popTakeoff(state, input, params);
    addScaled(p, v, dt);
    return;
  } else {
    state.charge = 0;
    state.compress = dampScalar(state.compress, 0, params.pop.compressResponse, dt);
  }

  addScaled(p, v, dt);

  terrain.sample(p.x, p.z, contact);
  state.clearance = p.y - contact.height;
  // Two ways to leave the snow without popping: the ground dropped away (clearance), or
  // it turned away under a board still travelling along the old surface — a lip, a
  // rollover. Without the second, a kicker's deck would catch the rider every tick and
  // re-project the launch flat, because per tick the rise is only centimetres.
  if (state.clearance > params.air.detachClearance || dot(v, contact.normal) > params.air.detachSpeed) {
    rideOff(state, input, params, -yaw);
    return;
  }

  p.y = contact.height;
  state.clearance = 0;
  projectOntoPlane(v, contact.normal);
}

function enterAir(state: RiderState): void {
  state.mode = 'airborne';
  state.airTime = 0;
  state.airYaw = 0;
  state.landing = 'none';
  // The surface the rider left, as the reference in-air levelling carries to the landing.
  axisY(state.airUp, state.spinFrame);
}

/**
 * A pop is where rotation is set (§5). The axis is board-local and lerped by stick Y, so
 * cork, rodeo and misty all fall out of one number instead of being special-cased.
 */
function popTakeoff(state: RiderState, input: InputSnapshot, params: Params): void {
  enterAir(state);
  state.popWindow = params.air.takeoffWindow;
  setTakeoffSpin(state, input, params);
  // Leaving the ground mid-carve, the thumb is still buried where the carve put it. Hold
  // in-air spin control until it comes back through centre, or the air controller drags
  // the rate up to the carve's value and undoes the whole point of the whip read.
  state.spinArmed = Math.abs(input.lx) < params.air.spinArmBand;
}

/**
 * Spin rate the stick asks for at takeoff. Left stick X is the edge stick grounded and the
 * spin stick airborne, and the pop is the seam between the two: read raw, a hard carve
 * *is* a request for a 360 whether or not the rider wanted one. So it is measured against
 * the carve already being held — `spinRef` lags the stick at `air.spinRefRate`, a
 * deliberate whip still reads as spin, a steady thumb reads as zero. At
 * `air.spinCarveReject` 0 this is the raw stick position.
 */
export function takeoffSpinRate(state: RiderState, input: InputSnapshot, params: Params): number {
  const whip = input.lx - state.spinRef * params.air.spinCarveReject;
  // Negative because a positive rotation about board up swings the nose to the heel side.
  const rate = -Math.min(1, Math.max(-1, whip)) * params.air.spinTakeoff;
  return Math.min(params.air.spinMax, Math.max(-params.air.spinMax, rate));
}

/**
 * Stick → spin axis and rate, as at takeoff. Also used for `air.takeoffWindow` after the
 * pop, so a stick that arrives a frame after the trigger still counts as the wind-up.
 */
/** Stick Y past `air.corkDeadzone`, rescaled to −1..1 — below it a tail press stays one. */
export function corkStick(ly: number, params: Params): number {
  const y = Math.min(1, Math.max(-1, ly));
  const dead = params.air.corkDeadzone;
  return Math.abs(y) <= dead ? 0 : (Math.sign(y) * (Math.abs(y) - dead)) / (1 - dead);
}

/**
 * The rotation the stick asks for, board-local rad/s: X spins about board up, Y flips
 * about the board's lateral (toe–heel) axis — across the direction of travel, so the nose
 * comes up and over toward the tail. Stick back, the tail press, is a backflip: negative
 * about +X tips board up toward the tail. (Not about the board's length — that is a barrel
 * roll.) A diagonal mixes the two, its tilt falling out of the ratio. One vector, so spin,
 * flip and everything off-axis between are one rule, not four.
 */
export function stickRotation(out: Vec3, yawRate: number, input: InputSnapshot, params: Params): Vec3 {
  return set(out, corkStick(input.ly, params) * params.air.flipRate, yawRate, 0);
}

/**
 * Axis and rate from a board-local rotation vector. The rate carries the sign and the axis
 * keeps y ≥ 0, so a flat spin reads exactly as it always has; clamped to `air.spinMax`.
 */
export function setRotation(state: RiderState, w: Vec3, params: Params): void {
  const m = length(w);
  if (m < 1e-12) {
    set(state.spinAxis, 0, 1, 0);
    state.spinRate = 0;
    return;
  }
  const sign = w.y < 0 ? -1 : 1;
  set(state.spinAxis, (sign * w.x) / m, (sign * w.y) / m, (sign * w.z) / m);
  state.spinRate = Math.min(params.air.spinMax, Math.max(-params.air.spinMax, sign * m));
}

export function setTakeoffSpin(state: RiderState, input: InputSnapshot, params: Params): void {
  if (params.air.flipRate > 0) {
    setRotation(state, stickRotation(rotation, takeoffSpinRate(state, input, params), input, params), params);
    return;
  }
  // Older rule, kept so takes recorded under it replay: X sets the rate, Y only tilts the
  // axis, capped at axisTiltMax — which is why a straight flip was unreachable.
  // Stick Y is also stance — a tail press is how you ollie — so a thumb pressing tail while
  // throwing a hard spin sideways is normal and must not be read as a cork. Only past
  // `air.corkDeadzone` does the axis tilt, rescaled so full stick is still a full cork.
  const ly = Math.min(1, Math.max(-1, input.ly));
  const dead = params.air.corkDeadzone;
  const cork = Math.abs(ly) <= dead ? 0 : (Math.sign(ly) * (Math.abs(ly) - dead)) / (1 - dead);
  const tilt = cork * params.air.axisTiltMax;
  state.spinAxis.x = 0;
  state.spinAxis.y = dm.cos(tilt);
  state.spinAxis.z = dm.sin(tilt);

  state.spinRate = takeoffSpinRate(state, input, params);
}

/**
 * Leaving the snow without popping — a rollover, a lip ridden straight off. No wind-up
 * happened, so the stick doesn't set a spin; the board just carries the yaw rate the
 * carve had. `spinRate` and heading rate share a sign: both positive toward the heel.
 */
function rideOff(state: RiderState, input: InputSnapshot, params: Params, headingRate: number): void {
  enterAir(state);
  state.popWindow = 0;
  state.spinArmed = Math.abs(input.lx) < params.air.spinArmBand;
  state.spinAxis.x = 0;
  state.spinAxis.y = 1;
  state.spinAxis.z = 0;
  state.spinRate = headingRate;
}
