import type { InputSnapshot } from '../../input/snapshot.ts';
import type { Params } from '../params.ts';
import { boardAttitude } from '../grabs.ts';
import { axisY, axisZ, multiply, normalizeQuat, quat, rotate, setFromAxisAngle, type Quat } from '../quat.ts';
import type { RiderState } from '../state.ts';
import { tryCapture } from './railed.ts';
import { corkStick, setRotation, setTakeoffSpin, stickRotation, takeoffSpinRate } from './grounded.ts';
import { createContact, type Terrain } from '../terrain.ts';
import {
  addScaled,
  clampLength,
  copyInto,
  cross,
  damp,
  dampScalar,
  dot,
  length,
  normalize,
  projectOntoPlane,
  scale,
  set,
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
const pitchQ = quat();
const rollQ = quat();
const shiftyQ = quat();
const UP = vec3(0, 1, 0);
const LATERAL = vec3(-1, 0, 0); // pitch axis: positive raises the nose, as the rig draws it
const LONG = vec3(0, 0, 1);
const levelAxis = vec3();
const stickW = vec3();
const spinW = vec3();
const levelQ = quat();
const composed = quat();
const grabForward = vec3();

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
  // Disarmed means the thumb is still where the carve left it at takeoff: the spin coasts,
  // neither steered nor checked. Coming back through centre arms it; from then on the law
  // above applies unchanged.
  if (!state.spinArmed && Math.abs(input.lx) < params.air.spinArmBand) state.spinArmed = true;
  const flips = params.air.flipRate > 0;
  if (state.popWindow > 0) {
    // Only a stronger stick counts: a late wind-up is forgiven, a flick already released
    // is not taken back. Read as a whip, same as the pop itself.
    state.popWindow = Math.max(0, state.popWindow - dt);
    const asked = flips
      ? length(stickRotation(stickW, takeoffSpinRate(state, input, params), state, input, params))
      : Math.abs(takeoffSpinRate(state, input, params));
    if (asked > Math.abs(state.spinRate)) setTakeoffSpin(state, input, params);
  } else if (!state.spinArmed) {
    // coast
  } else if (params.air.spinModel > 0) {
    // Spin model 1: the rotation is what the takeoff gave it. The stick, read against the
    // axis already turning, only tucks the body in (toward the spin) or opens it out
    // (against), which speeds the same rotation up or slows it — never starts or reverses it.
    stickRotation(stickW, -input.lx * params.air.spinTakeoff, state, input, params);
    const norm = Math.max(params.air.spinTakeoff, params.air.flipRate, 1e-6);
    const along = state.spinRate === 0 ? 0 : (dot(stickW, state.spinAxis) * (state.spinRate > 0 ? 1 : -1)) / norm;
    const s = along > 1 ? 1 : along < -1 ? -1 : along;
    const target = s >= 0 ? 1 + s * params.air.tuckGain : 1 + s * params.air.openGain;
    state.tuck += (target - state.tuck) * (1 - dm.exp(-params.air.tuckRate * dt));
  } else if (flips && (input.lx !== 0 || corkStick(input.ly, params) !== 0)) {
    // The stick read against the axis already turning: held, it holds the rotation — spin,
    // flip or the cork between — and eased, it slows it. It cannot swing the axis mid-air.
    stickRotation(stickW, -input.lx * params.air.spinTakeoff, state, input, params);
    const target = dot(stickW, state.spinAxis);
    state.spinRate += (target - state.spinRate) * (1 - dm.exp(-params.air.authority * dt));
  } else if (!flips && input.lx !== 0) {
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
  const tuck = params.air.spinModel > 0 ? state.tuck : 1;
  const rate = state.spinRate * (1 + (body - 1) * state.grip) * tuck;

  // Body-fixed axis, so this is a local-space rotation. Never snapped, never quantized.
  setFromAxisAngle(spin, state.spinAxis, rate * dt);
  multiply(state.spinFrame, state.spinFrame, spin);
  normalizeQuat(state.spinFrame);
  state.airYaw += Math.abs(rate) * dt;

  v.y -= params.world.gravity * dt;
  clampLength(v, params.world.terminalSpeed);
  addScaled(p, v, dt);
  state.airTime += dt;
  if (tryCapture(state, params, terrain, false)) return;

  terrain.sample(p.x, p.z, contact);
  state.clearance = p.y - contact.height;
  damp(state.groundNormal, contact.normal, params.ground.normalSmoothing, dt);
  levelBoard(state, params, dt);
  recoverCork(state, input, params, dt);

  if (state.clearance > 0) return;

  p.y = contact.height;
  state.clearance = 0;
  land(state, params, contact.normal, contact.surface === 'wall');
}

/**
 * The rider brings the board's pitch and roll round to the ground beneath — legs doing
 * what they do off a kicker, where the lip leaves the board nose-high and the landing is
 * steeper than the slope. Without it every straight air off a lip lands nose-high and
 * sketchy. The rotation is about a world axis perpendicular to board up, so the spin's
 * yaw is untouched; a cork is left alone, since its tilt is the trick — levelling fades
 * out as the spin axis tilts toward `air.levelTiltMax`.
 */
function levelBoard(state: RiderState, params: Params, dt: number): void {
  const rate = params.air.levelRate;
  if (rate <= 0) return;
  // An air off a pipe's face comes back down onto that face: the ground below is its deck
  // or coping, and levelling to that would land the board flat on a near-vertical wall.
  if (params.wall.vertExit > 0 && (state.faceX !== 0 || state.faceZ !== 0)) return;
  if (params.air.levelWhole > 0) {
    // Rotate the takeoff surface's up toward the ground below, and the board with it, as
    // one rigid rotation. A full spin about any axis brings the board back to its takeoff
    // attitude, so correcting that attitude rather than board up lands flat spins and
    // corks alike on the landing's angle, and never fights the spin itself.
    cross(levelAxis, state.airUp, state.groundNormal);
    const s = length(levelAxis);
    if (s < 1e-9) return;
    const angle = dm.atan2(s, dot(state.airUp, state.groundNormal));
    scale(levelAxis, 1 / s);
    setFromAxisAngle(levelQ, levelAxis, angle * (1 - dm.exp(-rate * dt)));
    multiply(state.spinFrame, levelQ, state.spinFrame);
    normalizeQuat(state.spinFrame);
    rotate(state.airUp, levelQ, state.airUp);
    normalize(state.airUp);
    return;
  }
  // Older rule, kept so takes recorded under it replay: level board up, faded out on corks.
  const tilt = Math.abs(state.spinAxis.z) / dm.sin(params.air.levelTiltMax);
  const weight = 1 - Math.min(1, tilt);
  if (weight <= 0) return;
  levelBoardUp(state, rate * weight, dt);
}

/**
 * Coming out of a cork. A spin about a fixed tilted axis only brings the board back
 * upright after whole turns — at a 540 it is tipped over by twice the tilt — so a cork
 * that lands fakie has to change axis in the air, which is what a rider does: go off
 * axis, then open up and come back flat for the landing. Holding stick Y keeps the cork,
 * as holding X keeps the spin; centring it swings the body-fixed spin axis back to board
 * up and rights the board toward the ground below, the spin itself untouched.
 */
function recoverCork(state: RiderState, input: InputSnapshot, params: Params, dt: number): void {
  const rate = params.air.corkRecover;
  const flips = params.air.flipRate > 0;
  // The off-axis part lives in X under the flip rule, in Z under the older one.
  if (rate <= 0 || state.popWindow > 0 || (flips ? state.spinAxis.x : state.spinAxis.z) === 0) return;
  if (Math.abs(input.ly) > params.air.corkDeadzone) return;
  const k = 1 - dm.exp(-rate * dt);
  if (flips) {
    // Only the flip part unwinds; the spin part is left exactly as it was, so letting go
    // mid-flip can't turn the flip's momentum into yaw nobody asked for.
    set(spinW, state.spinAxis.x * state.spinRate, state.spinAxis.y * state.spinRate, state.spinAxis.z * state.spinRate);
    spinW.x *= 1 - k;
    setRotation(state, spinW, params);
    // Opening up only rights a board that is already coming round: within
    // `air.corkRightMax` of the ground below. Past that the flip has to finish on its own
    // momentum — otherwise any flip, let go upside down, would land itself.
    axisY(boardUp, state.spinFrame);
    if (dot(boardUp, state.groundNormal) < dm.cos(params.air.corkRightMax)) return;
  } else {
    state.spinAxis.z *= 1 - k;
    state.spinAxis.y = Math.sqrt(Math.max(0, 1 - state.spinAxis.z * state.spinAxis.z));
  }
  levelBoardUp(state, rate, dt);
}

/** Board up toward the ground below, about a world axis perpendicular to it — spin untouched. */
function levelBoardUp(state: RiderState, rate: number, dt: number): void {
  axisY(boardUp, state.spinFrame);
  cross(levelAxis, boardUp, state.groundNormal);
  const s = length(levelAxis);
  if (s < 1e-9) return;
  const angle = dm.atan2(s, dot(boardUp, state.groundNormal));
  scale(levelAxis, 1 / s);
  setFromAxisAngle(levelQ, levelAxis, angle * (1 - dm.exp(-rate * dt)));
  // World-frame rotation, so it goes on the left.
  multiply(state.spinFrame, levelQ, state.spinFrame);
  normalizeQuat(state.spinFrame);
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
    if (state.grip === 0) {
      state.grabFront = state.grabT >= 0.5;
      // Travelling tail first as the hand goes: the switch version of the grab. The stick
      // is read against the direction of travel, so up is the leading end either way.
      axisZ(grabForward, state.spinFrame);
      const v = state.velocity;
      state.grabSwitch = params.grab.switchMirror > 0 && grabForward.x * v.x + grabForward.z * v.z < 0;
    }
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
 * Drawn board = spinFrame ∘ shifty ∘ pitch ∘ roll — what the landing test must read (§6,
 * §7.4), in exactly the order the rig draws it: the shifty yaws the board under the body,
 * then the grab's attitude pitches it about its lateral axis and rolls it about its length.
 * The pivot about the grab point only moves the board, so it doesn't enter the angles.
 */
function composeBoard(out: Quat, state: RiderState, params: Params): Quat {
  const a = boardAttitude(state.grabEdge, state.grabT, state.grip, state.tweak, params);
  setFromAxisAngle(shiftyQ, UP, state.shifty);
  // A switch grab is the mirror image nose-for-tail: pitch turns over, roll about the
  // board's length doesn't.
  setFromAxisAngle(pitchQ, LATERAL, state.grabSwitch ? -a.pitch : a.pitch);
  setFromAxisAngle(rollQ, LONG, a.roll * params.grab.tweakRollMax);
  multiply(out, state.spinFrame, shiftyQ);
  multiply(out, out, pitchQ);
  return multiply(out, out, rollQ);
}

/**
 * Design §6. The whole thing turns on two angles, and it is deliberately the only place
 * rotation is ever corrected. Resist adding a rotation-count check — the angle contains it.
 */
function land(state: RiderState, params: Params, n: Vec3, onWall: boolean): void {
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
  // Flying into a wall fast enough sticks: the board is slaved to the face, so only the
  // heading angle is judged — the roll test would bail every ollie onto a wall.
  const wall = onWall && n.y < dm.cos(params.wall.minAngle) && courseSpeed >= params.wall.minSpeed;
  const phi = wall ? 0 : dm.acos(Math.min(1, Math.max(-1, dot(boardUp, n))));

  // Impact: how hard you came down, judged apart from the angles. Absorbing (RT held,
  // `compress`) raises both limits. Flying onto a wall is an entry, not a landing.
  const give = 1 + params.land.absorbGain * state.compress;
  const hard = !wall && state.impact >= params.land.impactSketchy * give;
  const broken = !wall && state.impact >= params.land.impactBail * give;

  if (!broken && !hard && theta < params.land.clean && phi < params.land.rollClean) {
    state.landing = 'clean';
  } else if (!broken && theta < params.land.sketchy && phi < params.land.rollSketchy) {
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

  state.mode = wall ? 'walled' : 'grounded';
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
