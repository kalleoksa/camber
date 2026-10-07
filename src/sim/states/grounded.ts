import type { InputSnapshot } from '../../input/snapshot.ts';
import type { Params } from '../params.ts';
import { axisY, setFromBasis } from '../quat.ts';
import type { RiderState } from '../state.ts';
import { tryCapture } from './railed.ts';
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
  planeHeading,
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
const wallUp = vec3(); // up the face, in the contact plane
const faceNormal = vec3(); // the surface under the board at the start of the tick

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

  landingWindow(state, input, params, n);
  // The skid: the board keeps turning on the snow and the edge takes it out. While it turns,
  // the landing correction waits; when it stops, the carve rides out whatever angle is left.
  if (state.skid !== 0) {
    state.heading = wrapAngle(state.heading + state.skid * dt);
    const slow = params.land.skidDecel * dt;
    state.skid = Math.abs(state.skid) <= slow ? 0 : state.skid - (state.skid > 0 ? slow : -slow);
    if (state.skid === 0) aimAtTravel(state, params, n);
  } else if (state.absorb > 0) {
    // Finish off a landing correction, if one is pending, before the carve reads heading.
    const delta = wrapAngle(state.headingTarget - state.heading);
    state.heading = wrapAngle(state.heading + delta * (1 - dm.exp(-params.land.headingSnap * dt)));
  }

  // Wallride (§9): a face steeper than `wall.minAngle`, taken fast enough, is ridden with
  // gravity scaled down. Same ground model otherwise — the board is slaved to the wall, so a
  // wallride is a very steep carve. Too slow, or back onto gentler snow, and it lets go.
  // Entry only as the face comes up under the board — the smoothed normal still says gentle
  // snow. Once a wall has let go, sliding back down it at full gravity would otherwise pick
  // speed back up and re-enter every other tick.
  // Walls only: a quarter pipe is ridden at full gravity.
  const minNy = dm.cos(params.wall.minAngle);
  const steep = n.y < minNy && contact.surface === 'wall';
  // Hysteresis: it takes `minSpeed` to get on, and lets go below `exitFraction` of that.
  // One threshold for both made a wall taken right at the speed flick on and off in a few
  // ticks — the first tick of wall drag dropped you under it.
  const wallSpeed = length(v);
  const moving = wallSpeed >= params.wall.minSpeed;
  const holding = wallSpeed >= params.wall.minSpeed * params.wall.exitFraction;
  const arriving = state.groundNormal.y >= minNy;
  if (state.mode === 'grounded' && steep && moving && arriving) state.mode = 'walled';
  else if (state.mode === 'walled' && !(steep && holding)) state.mode = 'grounded';
  const walled = state.mode === 'walled';
  const fromQuarter = contact.surface === 'quarter';
  set(faceNormal, n.x, n.y, n.z);
  // Remember the way back into the pipe while on its steep face; forget it on its deck or
  // off it, so riding along a deck and dropping off the back isn't pulled anywhere.
  if (params.wall.vertExit > 0) {
    if (fromQuarter && n.y < params.wall.vertFace && (contact.faceX !== 0 || contact.faceZ !== 0)) {
      state.faceX = contact.faceX;
      state.faceZ = contact.faceZ;
    } else if (!fromQuarter || n.y > 0.95) {
      state.faceX = 0;
      state.faceZ = 0;
    }
  }

  // Tangential component of gravity on the contact plane: g*(down − n*(down·n)).
  const gravity = params.world.gravity * (walled ? params.wall.gravityScale : 1);
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
  if (params.ground.switchEdges > 0) {
    const was = state.switchRide;
    if (vf < -params.ground.switchSpeed) state.switchRide = true;
    else if (vf > params.ground.switchSpeed) state.switchRide = false;
    // The sticks are read through the latch (rider.ts), so when it flips a held stick's
    // smoothed edge and press flip with it — not sweep through zero, which dropped a
    // butter halfway round with the board across.
    if (state.switchRide !== was && params.ground.switchCarry > 0) {
      state.edge = -state.edge;
      state.stance = -state.stance;
    }
  }

  const edgeMag = Math.min(Math.abs(state.edge), 1);
  const stanceMag = Math.min(Math.abs(state.stance), 1);

  // The one curve carving lives on: flat base skids, a set edge locks.
  const speedBefore = Math.sqrt(vf * vf + vl * vl);
  // Butter: a hard press at low speed goes up on the nose or tail. Grip lets go and the
  // board pivots on the pressed end, so a ground 180 or 360 is there to be had.
  const butter = walled ? 0 : butterAmount(state.stance, speedBefore, params);
  // Up on one end the edge isn't in the snow: the edge stick steers the pivot, and only
  // `butter.edgeGrip` of its grip stays — otherwise a board swung across scrubs to a stop.
  const edgeGrip = 1 - butter * (1 - params.butter.edgeGrip);
  let grip = g.gripFlat + (g.gripEdge - g.gripFlat) * dm.pow(edgeMag, g.gripCurve) * edgeGrip;
  grip *= 1 - stanceMag * g.stanceGripLoss;
  // The speed check: LT, or two sticks the right stick's skid (signed; the sim needs only how much).
  const brake = Math.abs(state.brake);
  grip *= 1 - brake * g.brakeGripLoss;
  grip *= 1 + (params.butter.gripScale - 1) * butter;
  // A landing skid pivots the board under the rider like a butter: the edge doesn't hold
  // and the travel keeps its line rather than following the turning board.
  const skidding = state.skid !== 0 ? 1 : 0;
  grip *= 1 + (params.land.skidGrip - 1) * skidding;
  const vlAfter = vl * dm.exp(-Math.max(grip, 0) * dt);
  const scrubbed = Math.abs(vl) - Math.abs(vlAfter);

  // Invariant 2: the edge *rotates* the velocity vector toward the board. Holding the
  // speed constant while the lateral component shrinks is exactly that rotation.
  // `carveHold` blends between it and the friction-cone version that just eats the
  // lateral component — at 1.0 a carve is free, at 0.0 it is a skid.
  const vfRotated = Math.sign(vf) * Math.sqrt(Math.max(0, speedBefore * speedBefore - vlAfter * vlAfter));
  // A butter is a pivot, not a carve: scrub is not handed back, so the board can come round
  // while the rider keeps travelling the way they were going.
  vf += (vfRotated - vf) * g.carveHold * (1 - butter) * (1 - skidding);
  vl = vlAfter;
  state.scrub = scrubbed / dt;

  let speed = Math.sqrt(vf * vf + vl * vl);
  if (speed > 0) {
    // Snow friction on the normal load, then air drag, brake and wall drag.
    const friction = g.friction * params.world.gravity * n.y;
    // Posture (two sticks): a tuck cuts the air drag, standing tall adds to it. 1 on one stick.
    const post = state.posture;
    const airDrag = post > 0 ? 1 + post * (g.tuckDrag - 1) : 1 - post * (g.tallDrag - 1);
    const drag = (g.drag * speed * speed * airDrag + brake * g.brakeDecel + (walled ? params.wall.drag : 0) + friction) * dt;
    const carveCost = g.edgeDrag * edgeMag * edgeGrip * scrubbed;
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
  // Tucked the turn opens up, stood tall it tightens.
  const post = state.posture;
  const postureYaw = post > 0 ? 1 + post * (g.tuckCarve - 1) : 1 - post * (g.tallCarve - 1);
  let yaw = state.edge * g.carveYaw * speedFactor(speed, g.speedFactorKnee) * (1 + stanceMag * g.stanceYawGain) * postureYaw;
  if (speed < g.pivotSpeed) {
    // Low-authority skid pivot so a stopped rider isn't stuck facing the wrong way.
    yaw += state.edge * g.pivotYaw * (1 - speed / g.pivotSpeed);
  }
  // The butter pivot is not speed-scaled: on one end of the board you can turn on the spot.
  yaw += state.edge * params.butter.yawRate * butter;
  // Tail first, an edge bends the travel toward its side the other way round: the nose
  // swings the opposite way for the same edge.
  if (params.ground.switchEdges > 0 && state.switchRide) yaw = -yaw;
  // Increasing `heading` swings the nose toward `n × forward`, which is the heel side.
  // A toe-edge carve goes the other way, so positive edge subtracts.
  state.heading = wrapAngle(state.heading - yaw * dt);

  if (state.absorb > 0) state.absorb = Math.max(0, state.absorb - dt);

  if (chargePop(state, input, params, dt)) {
    const bias = popBias(state.stance, params);
    const impulse = (params.pop.base + params.pop.charged * state.compress) * bias;
    state.charge = 0;
    // Popping on a wall's transition on the way in, heading up or along it, drives you up
    // the face and keeps you on it — that is how you get onto a wall. Once walled, a pop is
    // an air off the face like any other. Keyed on the wall surface, not on steepness
    // alone, so a kicker lip still launches.
    set(wallUp, -n.x * n.y, 1 - n.y * n.y, -n.z * n.y);
    // A quarter pipe the same, all the way up: popping on the face while climbing adds to
    // the climb, so the air off the top goes higher.
    const lift = (!walled && contact.surface === 'wall') || contact.surface === 'quarter';
    const onFace = lift && n.y < dm.cos(params.wall.popAngle) && dot(v, wallUp) >= 0;
    if (onFace) {
      normalize(wallUp);
      addScaled(v, wallUp, impulse * params.wall.popScale);
    } else {
      // Along the contact normal, not world up — ramp geometry then needs no special case.
      addScaled(v, n, impulse);
      popTakeoff(state, input, params);
      // Two sticks: popped out of a butter, the board is already turning — that pivot goes
      // into the spin. Heading and spin rate share a sign (see rideOff).
      if (params.input.scheme > 0 && butter > 0) {
        let pivot = state.edge * params.butter.yawRate * butter;
        if (params.ground.switchEdges > 0 && state.switchRide) pivot = -pivot;
        addSpin(state, -pivot * params.butter.popCarry, params);
      }
      addScaled(p, v, dt);
      return;
    }
  }

  addScaled(p, v, dt);
  if (tryCapture(state, params, terrain, true)) return;

  terrain.sample(p.x, p.z, contact);
  state.clearance = p.y - contact.height;
  // Two ways to leave the snow without popping: the ground dropped away (clearance), or
  // it turned away under a board still travelling along the old surface — a lip, a
  // rollover. Without the second, a kicker's deck would catch the rider every tick and
  // re-project the launch flat, because per tick the rise is only centimetres.
  // Riding from a pipe's steep face onto its deck — over the coping, which is vertical on a
  // real pipe — is leaving the pipe, not riding on: it can only be done in the air.
  const overCoping =
    params.wall.vertExit > 0 && contact.surface === 'quarter' && (state.faceX !== 0 || state.faceZ !== 0) && contact.normal.y > 0.9;
  if (overCoping || state.clearance > params.air.detachClearance || dot(v, contact.normal) > params.air.detachSpeed) {
    // Off the top of a quarter pipe: its real top is vertical, so the horizontal speed that
    // the heightfield's not-quite-vertical face leaves pointing over the deck is dropped and
    // the air comes straight up and back into the pipe, drifting in at `wall.vertReturn` so
    // it lands on the face. Speed along the coping stays.
    // With `wall.vertExit` the way in is the face last climbed, and it counts on any exit
    // going up off the pipe — the common one is a few cm past the coping, already on the
    // deck's curve, which the older rule (steep face only) missed and sent onto the deck.
    const climbed = params.wall.vertExit > 0 && fromQuarter && (state.faceX !== 0 || state.faceZ !== 0);
    const vert = climbed || (fromQuarter && faceNormal.y < minNy);
    if (vert) {
      let fx = faceNormal.x;
      let fz = faceNormal.z;
      if (climbed) {
        fx = state.faceX;
        fz = state.faceZ;
      }
      const hl = Math.sqrt(fx * fx + fz * fz);
      const into = -(v.x * fx + v.z * fz) / hl + params.wall.vertReturn;
      if (into > 0) {
        v.x += (fx / hl) * into;
        v.z += (fz / hl) * into;
      }
    }
    // Leaving the top is the takeoff on a quarter pipe: the pop went into the climb, so the
    // stick at the lip sets the spin as it would at a pop — a turn in the wall's plane,
    // nose up to nose down for a 180.
    if (vert && params.wall.lipTakeoff > 0) popTakeoff(state, input, params);
    else rideOff(state, input, params, -yaw);
    return;
  }

  p.y = contact.height;
  state.clearance = 0;
  projectOntoPlane(v, contact.normal);
}

/**
 * 0..1 of butter: how far |stance| is past `butter.press`, faded out toward `butter.maxSpeed`.
 * Exported so render can tip the board onto the pressed end by the same amount.
 */
export function butterAmount(stance: number, speed: number, params: Params): number {
  const b = params.butter;
  const s = Math.abs(stance);
  if (s <= b.press || speed >= b.maxSpeed) return 0;
  const press = Math.min(1, (s - b.press) / (1 - b.press));
  const fade = b.speedFade > 0 ? Math.min(1, (b.maxSpeed - speed) / b.speedFade) : 1;
  return press * fade;
}

/**
 * Pop charge: RT held ramps `compress`, bleeding once full; the tick it's let go is the
 * pop, and this returns true. The caller fires the impulse from `compress` and zeroes
 * `charge`. Shared by snow and rail, so a pop off a rail charges exactly like one off snow.
 */
export function chargePop(state: RiderState, input: InputSnapshot, params: Params, dt: number): boolean {
  if (input.rt > params.pop.trigger) {
    state.popLatch = true;
    state.charge += dt;
    state.compress =
      state.charge <= params.pop.chargeTime
        ? state.charge / params.pop.chargeTime
        : Math.max(params.pop.decayFloor, 1 - (state.charge - params.pop.chargeTime) * params.pop.decay);
    return false;
  }
  if (state.popLatch) {
    state.popLatch = false;
    return true;
  }
  state.charge = 0;
  state.compress = dampScalar(state.compress, 0, params.pop.compressResponse, dt);
  return false;
}

/**
 * Pop strength from the press at release (§5). One stick: symmetric about flat, so a nollie
 * came out weaker than no press at all. Two sticks: off the tail is the ollie, the
 * strongest; off the nose the nollie, between that and a flat pop. Analog in between.
 */
export function popBias(stance: number, params: Params): number {
  const pop = params.pop;
  if (params.input.scheme <= 0) return 1 - stance * pop.stanceBias;
  return stance < 0 ? 1 - stance * (pop.ollieGain - 1) : 1 + stance * (pop.nollieGain - 1);
}

function enterAir(state: RiderState): void {
  state.mode = 'airborne';
  state.airTime = 0;
  state.popStance = 0;
  state.tuck = 1;
  state.airYaw = 0;
  state.landing = 'none';
  // The surface the rider left, as the reference in-air levelling carries to the landing.
  axisY(state.airUp, state.spinFrame);
}

/**
 * A pop is where rotation is set (§5). The axis is board-local and lerped by stick Y, so
 * cork, rodeo and misty all fall out of one number instead of being special-cased.
 */
export function popTakeoff(state: RiderState, input: InputSnapshot, params: Params): void {
  enterAir(state);
  // Read by render (the ollie's nose-up, the nollie's tail-up) and the trick names. Not a
  // sim input: nothing in the sim reads it back.
  state.popStance = state.stance;
  state.popWindow = params.air.spinModel > 0 ? Math.max(params.air.takeoffWindow, params.air.flickWindow) : params.air.takeoffWindow;
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
  if (params.air.spinModel > 0) {
    // Counter-rotation, as on snow: the wind-up is the upper body loaded against the spin,
    // and pointing the stick the way of the spin at the pop sends it — as far as it points,
    // that much of the wind-up (and `air.flickWindow` after the pop still counts). Held
    // against through the pop, nothing is let go: a straight air. No wind-up: a flick
    // (stick travel over the last ~0.2 s) still turns a little.
    const a = params.air;
    const w = state.windUp;
    let amount: number;
    let way: number;
    if (a.windAdds > 0) {
      // The wind-up adds to the flick rather than replacing it: a send with no wind-up is the
      // flick's share of the spin, each bit of wind-up adds the rest on top, up to the full
      // rate. Replacing it made a short wind-up spin *less* than none — flick 0.5, then 0.15
      // the moment the wind-up passed `flickMin`.
      const travel = input.lx - state.spinRef;
      const flick = Math.min(1, Math.abs(travel) * 0.5) * a.flickGain;
      const send = Math.min(1, Math.max(0, (w > 0 ? -input.lx : input.lx) / Math.max(a.fullStick, 1e-3)));
      const wound = w !== 0 && send > 0;
      amount = flick + Math.abs(w) * send * (1 - a.flickGain);
      way = wound ? -w : travel;
    } else if (Math.abs(w) > a.flickMin) {
      amount = Math.abs(w) * Math.min(1, Math.max(0, (w > 0 ? -input.lx : input.lx) / Math.max(a.fullStick, 1e-3)));
      way = -w;
    } else {
      const travel = input.lx - state.spinRef;
      amount = Math.min(1, Math.abs(travel) * 0.5) * a.flickGain;
      way = travel;
    }
    amount = Math.min(1, amount);
    // Negative for the same reason as below: + about board up swings the nose to the heel.
    const rate = -(way < 0 ? -1 : way > 0 ? 1 : 0) * amount * a.spinTakeoff;
    return Math.min(a.spinMax, Math.max(-a.spinMax, rate));
  }
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

function corkStick1(ly: number, params: Params): number {
  const a = params.air;
  const y = Math.abs(ly);
  if (y <= a.corkDeadzone1) return 0;
  const t = Math.min(1, (y - a.corkDeadzone1) / Math.max(a.fullStick - a.corkDeadzone1, 1e-3));
  return ly < 0 ? -t : t;
}

/**
 * The rotation the stick asks for, board-local rad/s: X spins about board up, Y flips
 * about the board's lateral (toe–heel) axis — across the direction of travel, so the nose
 * comes up and over toward the tail. Stick back, the tail press, is a backflip: negative
 * about +X tips board up toward the tail. (Not about the board's length — that is a barrel
 * roll.) A diagonal mixes the two, its tilt falling out of the ratio. One vector, so spin,
 * flip and everything off-axis between are one rule, not four.
 */
export function stickRotation(out: Vec3, yawRate: number, ly: number, state: RiderState, params: Params): Vec3 {
  // Riding switch the tail leads, so the same flip about +X is the other way over relative
  // to travel: mirror it, as the stance stick is mirrored on the ground.
  const dir = params.air.switchFlips > 0 && state.switchRide ? -1 : 1;
  // Model 1: full at `fullStick`, past a lower deadzone, so a diagonal at the pop is a full cork.
  const flip = params.air.spinModel > 0 ? corkStick1(ly, params) : corkStick(ly, params);
  return set(out, flip * params.air.flipRate * dir, yawRate, 0);
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

/**
 * Stick Y as a flip reads it at the pop. One stick: its position. Two sticks: a flick — the
 * travel since `flipRef` — because the same stick held forward is the tuck into the lip.
 * Never more than where the stick actually points, so letting a tuck go to centre at the
 * pop is not a backflip: the flick has to end up back.
 */
export function popFlipStick(state: RiderState, input: InputSnapshot, params: Params): number {
  if (params.input.scheme <= 0) return input.ly;
  const d = input.ly - state.flipRef;
  if (d * input.ly <= 0) return 0;
  const m = Math.min(Math.abs(d), Math.abs(input.ly), 1);
  return d < 0 ? -m : m;
}

/** Adds a yaw rate about board up to the rotation already set, keeping one axis and rate. */
export function addSpin(state: RiderState, yawRate: number, params: Params): void {
  const r = state.spinRate;
  set(rotation, state.spinAxis.x * r, state.spinAxis.y * r + yawRate, state.spinAxis.z * r);
  setRotation(state, rotation, params);
}

/**
 * Pre-rotation (two sticks): wound up and still held the same way through the pop, with
 * only RT let go. The shoulders were already turned the way of the spin and the board
 * follows them round — slow and even, where reversing the stick at the pop (counter-
 * rotation) snaps. One stored wind-up, read two ways by what the stick does at release.
 * The held stick sets the axis: sideways a flat spin, diagonal a cork, the flip part as slow
 * as the spin. Y alone is the tuck, so it doesn't pre-rotate a flip on its own.
 * Writes `out` and returns true when it applies.
 */
function preRotation(out: Vec3, state: RiderState, input: InputSnapshot, params: Params): boolean {
  const a = params.air;
  const w = state.windUp;
  if (params.input.scheme <= 0 || a.preRotateGain <= 0 || a.spinModel <= 0) return false;
  if (Math.abs(w) <= a.flickMin || input.lx * w <= 0) return false;
  const held = Math.min(1, Math.abs(input.lx) / Math.max(a.fullStick, 1e-3));
  const amount = Math.abs(w) * held * a.preRotateGain;
  const dir = a.switchFlips > 0 && state.switchRide ? -1 : 1;
  // Turning toward +X (the stick's way) is − about board up, as in takeoffSpinRate.
  // A cork's flip part takes the pop's pitch too, as a fast flip does (pop.flipAssist):
  // an ollie tips a slow cork back, a nollie forward. A flat slow spin stays flat.
  const cork = corkStick1(input.ly, params) * dir;
  const pitch = cork !== 0 ? state.stance * params.pop.flipAssist : 0;
  set(out, (cork + pitch) * a.flipRate * amount, -(w > 0 ? 1 : -1) * amount * a.spinTakeoff, 0);
  return true;
}

export function setTakeoffSpin(state: RiderState, input: InputSnapshot, params: Params): void {
  if (params.air.flipRate > 0) {
    if (preRotation(rotation, state, input, params)) {
      setRotation(state, rotation, params);
      return;
    }
    stickRotation(rotation, takeoffSpinRate(state, input, params), popFlipStick(state, input, params), state, params);
    // Two sticks: the pop's pitch goes into a flip — off the tail the nose comes up, so a
    // backflip comes round faster; off the nose, a frontflip. Board frame, so no switch mirror.
    if (params.input.scheme > 0 && rotation.x !== 0) rotation.x += state.stance * params.pop.flipAssist * params.air.flipRate;
    setRotation(state, rotation, params);
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
export function rideOff(state: RiderState, input: InputSnapshot, params: Params, headingRate: number): void {
  enterAir(state);
  state.popWindow = 0;
  state.spinArmed = Math.abs(input.lx) < params.air.spinArmBand;
  state.spinAxis.x = 0;
  state.spinAxis.y = 1;
  state.spinAxis.z = 0;
  state.spinRate = headingRate;
  // Pre-rotation (two sticks) needs no pop: wound up and still holding as the board leaves
  // the lip, the takeoff releases it — a slow spin set off the edge. Also what makes RT let
  // go a moment after the lip, rather than on it, still spin.
  if (preRotation(rotation, state, input, params)) setRotation(state, rotation, params);
}

const travel = vec3();

/** Heading target onto the direction of travel, regular or switch, whichever is nearer. */
function aimAtTravel(state: RiderState, params: Params, n: Vec3): void {
  travel.x = state.velocity.x;
  travel.y = state.velocity.y;
  travel.z = state.velocity.z;
  projectOntoPlane(travel, n);
  if (length(travel) <= params.ground.pivotSpeed) {
    state.headingTarget = state.heading;
    return;
  }
  const course = planeHeading(travel, n);
  const delta = wrapAngle(course - state.heading);
  state.headingTarget = wrapAngle(Math.abs(delta) > Math.PI / 2 ? course + Math.PI : course);
}

/**
 * The landing window (`land.absorbTime` after touchdown): the right stick, unused on snow,
 * flicked the way the board is turning is a revert — a skid fast enough to take it
 * `land.revertAngle` further; pushed the way that lines a sketchy-for-rotation landing up,
 * it is saved to clean and the speed it cost comes back. Stick right turns the board as a
 * toe edge does (heading down), mirrored riding switch like the edges.
 */
function landingWindow(state: RiderState, input: InputSnapshot, params: Params, n: Vec3): void {
  const l = params.land;
  if (state.absorb <= 0) {
    state.saveable = false;
    return;
  }
  // A flick, not a stick still held from a grab: it counts once it has been near centre.
  if (Math.abs(input.rx) < l.revertStick * 0.5) state.stickArmed = true;
  if (!state.stickArmed) return;
  const dir = params.ground.switchEdges > 0 && state.switchRide ? -1 : 1;
  const turn = -input.rx * dir; // + raises heading
  if (state.saveable && Math.abs(input.rx) > l.saveStick) {
    const off = wrapAngle(state.headingTarget - state.heading);
    if (off * turn > 0) {
      state.landing = 'clean';
      state.saveable = false;
      state.skid = 0;
      const keep = 1 - l.sketchySpeedLoss;
      if (keep > 1e-3) {
        state.velocity.x /= keep;
        state.velocity.y /= keep;
        state.velocity.z /= keep;
      }
      aimAtTravel(state, params, n);
      state.stickArmed = false; // the same push isn't also a revert
      return;
    }
  }
  if (l.revertAngle > 0 && !state.reverted && Math.abs(input.rx) > l.revertStick && state.skid * turn >= 0) {
    // Far enough, the flick's way round, to stop lined up on the other stance; revertAngle
    // when there's no line to aim at. Then the rate that skids exactly that far to a stop
    // at skidDecel: ω² = 2·a·θ.
    aimAtTravel(state, params, n);
    let need = wrapAngle(state.headingTarget + Math.PI - state.heading);
    if (turn > 0 && need < 0) need += 2 * Math.PI;
    if (turn < 0 && need > 0) need -= 2 * Math.PI;
    const angle = Math.abs(need) > Math.PI / 2 && Math.abs(need) < (3 * Math.PI) / 2 ? Math.abs(need) : l.revertAngle;
    state.skid = (turn > 0 ? 1 : -1) * Math.sqrt(2 * l.skidDecel * angle);
    state.reverted = true;
    state.saveable = false;
  }
}
