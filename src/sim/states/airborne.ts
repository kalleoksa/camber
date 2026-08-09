import type { InputSnapshot } from '../../input/snapshot.ts';
import type { Params } from '../params.ts';
import { axisY, axisZ, multiply, normalizeQuat, quat, setFromAxisAngle } from '../quat.ts';
import type { RiderState } from '../state.ts';
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

const contact = createContact();
const spin = quat();
const boardForward = vec3();
const boardUp = vec3();
const course = vec3();

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
  state.compress = dampScalar(state.compress, input.rt, params.ground.edgeResponse, dt);

  // Stick position means the same thing in the air as it did at takeoff: spin speed.
  // `air.authority` is how fast the board answers a stick change, so takeoff still sets
  // where you start and a short air can't fully retarget. Centred stick coasts — that is
  // how you hold a rotation you already have.
  // Disarmed means the thumb is still where the carve left it at takeoff. Coming back
  // through centre arms it; from then on the law above applies unchanged.
  if (!state.spinArmed && Math.abs(input.lx) < params.air.spinArmBand) state.spinArmed = true;
  if (state.spinArmed && input.lx !== 0) {
    const target = -input.lx * params.air.spinTakeoff;
    state.spinRate += (target - state.spinRate) * (1 - Math.exp(-params.air.authority * dt));
  }
  if (state.spinRate > params.air.spinMax) state.spinRate = params.air.spinMax;
  if (state.spinRate < -params.air.spinMax) state.spinRate = -params.air.spinMax;

  // Body-fixed axis, so this is a local-space rotation. Never snapped, never quantized.
  setFromAxisAngle(spin, state.spinAxis, state.spinRate * dt);
  multiply(state.spinFrame, state.spinFrame, spin);
  normalizeQuat(state.spinFrame);
  state.airYaw += Math.abs(state.spinRate) * dt;

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
 * Design §6. The whole thing turns on two angles, and it is deliberately the only place
 * rotation is ever corrected. Resist adding a rotation-count check — the angle contains it.
 */
function land(state: RiderState, params: Params, n: Vec3): void {
  const v = state.velocity;

  state.impact = Math.abs(dot(v, n));

  axisZ(boardForward, state.spinFrame);
  axisY(boardUp, state.spinFrame);
  projectOntoPlane(boardForward, n);
  normalize(boardForward);

  copyInto(course, v);
  projectOntoPlane(course, n);
  const courseSpeed = length(course);

  // Below walking pace the velocity direction is noise, so only the roll angle matters.
  let theta = 0;
  if (courseSpeed > params.ground.pivotSpeed) {
    normalize(course);
    const cos = Math.min(1, Math.max(-1, dot(boardForward, course)));
    theta = Math.acos(cos);
    if (theta > Math.PI / 2) theta = Math.PI - theta; // fold: switch landings are legal
  }
  const phi = Math.acos(Math.min(1, Math.max(-1, dot(boardUp, n))));

  if (theta < params.land.clean && phi < params.land.rollClean) {
    state.landing = 'clean';
  } else if (theta < params.land.sketchy) {
    state.landing = 'sketchy';
  } else {
    state.mode = 'bailed';
    state.landing = 'bail';
    state.bailTime = 0;
    state.spinRate = 0;
    return;
  }

  // Aim heading at the direction of travel, keeping switch if that is the near side.
  // Converged over the absorb window rather than teleported — an instant snap of up to
  // land.sketchy reads as the game rounding your trick off for you.
  if (courseSpeed > params.ground.pivotSpeed) {
    const courseHeading = Math.atan2(course.x, course.z);
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
