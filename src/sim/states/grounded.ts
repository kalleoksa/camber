import type { InputSnapshot } from '../../input/snapshot.ts';
import type { Params } from '../params.ts';
import { setFromBasis } from '../quat.ts';
import type { RiderState } from '../state.ts';
import { createContact, type Terrain } from '../terrain.ts';
import {
  addScaled,
  clampLength,
  cross,
  damp,
  dampScalar,
  dot,
  normalize,
  projectOntoPlane,
  set,
  vec3,
  wrapAngle,
} from '../vec3.ts';
import * as dm from '../dmath.ts';

const contact = createContact();
const forward = vec3();
const toeSide = vec3();
const heelSide = vec3();

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
  if (state.clearance > params.air.detachClearance) {
    rideOff(state, -yaw);
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
}

/**
 * A pop is where rotation is set (§5). The axis is board-local and lerped by stick Y, so
 * cork, rodeo and misty all fall out of one number instead of being special-cased.
 */
function popTakeoff(state: RiderState, input: InputSnapshot, params: Params): void {
  enterAir(state);
  state.popWindow = params.air.takeoffWindow;
  setTakeoffSpin(state, input, params);
}

/**
 * Stick → spin axis and rate, as at takeoff. Also used for `air.takeoffWindow` after the
 * pop, so a stick that arrives a frame after the trigger still counts as the wind-up.
 */
export function setTakeoffSpin(state: RiderState, input: InputSnapshot, params: Params): void {
  const tilt = Math.min(1, Math.max(-1, input.ly)) * params.air.axisTiltMax;
  state.spinAxis.x = 0;
  state.spinAxis.y = dm.cos(tilt);
  state.spinAxis.z = dm.sin(tilt);

  // Negative because a positive rotation about board up swings the nose to the heel side.
  const rate = -input.lx * params.air.spinTakeoff;
  state.spinRate = Math.min(params.air.spinMax, Math.max(-params.air.spinMax, rate));
}

/**
 * Leaving the snow without popping — a rollover, a lip ridden straight off. No wind-up
 * happened, so the stick doesn't set a spin; the board just carries the yaw rate the
 * carve had. `spinRate` and heading rate share a sign: both positive toward the heel.
 */
function rideOff(state: RiderState, headingRate: number): void {
  enterAir(state);
  state.popWindow = 0;
  state.spinAxis.x = 0;
  state.spinAxis.y = 1;
  state.spinAxis.z = 0;
  state.spinRate = headingRate;
}
