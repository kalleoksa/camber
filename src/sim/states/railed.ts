import type { InputSnapshot } from '../../input/snapshot.ts';
import type { Params } from '../params.ts';
import { axisX, axisZ, setFromBasis } from '../quat.ts';
import { nearestOnRail, railAt } from '../rails.ts';
import type { RiderState } from '../state.ts';
import type { Terrain } from '../terrain.ts';
import { cross, damp, dot, normalize, set, vec3, wrapAngle } from '../vec3.ts';
import * as dm from '../dmath.ts';
import { chargePop, popBias, popTakeoff, rideOff } from './grounded.ts';

const railPos = vec3();
const tan = vec3();
const T = vec3(); // travel direction along the rail
const U = vec3(); // rail up: world up with the tangent taken out
const S = vec3(); // T × U, the rail's side
const F = vec3(); // board forward
const heel = vec3();

/** Rail frame at arc length `s` for travel direction `dir`: fills railPos, T, U, S. */
function frame(state: RiderState, terrain: Terrain, s: number, dir: number): boolean {
  const rail = terrain.rails[state.railIndex];
  if (!rail) return false;
  railAt(rail, s, railPos, tan);
  set(T, tan.x * dir, tan.y * dir, tan.z * dir);
  set(U, -T.x * T.y, 1 - T.y * T.y, -T.z * T.y);
  normalize(U);
  cross(S, T, U);
  return true;
}

/**
 * On a rail (§8). Position is held to the rail and velocity keeps only its component along
 * it; gravity along the rail minus friction sets the speed, and a board turned across the
 * rail scrapes harder. The slide angle is the player's: it starts from how the board met
 * the rail and LB/RB turn it — 0 is a 50-50, ±π/2 a boardslide, a stance press on a 50-50
 * is a nose or tail slide. Balance is an unstable lean seeded by the entry and countered
 * with the left stick — winnable, never free.
 */
export function stepRailed(state: RiderState, input: InputSnapshot, params: Params, terrain: Terrain, dt: number): void {
  const r = params.rail;
  if (!frame(state, terrain, state.railS, state.railDir)) {
    rideOff(state, input, params, 0);
    return;
  }
  const v = state.velocity;
  const sinSlide = Math.abs(dm.sin(state.slide));

  // Speed along the rail: gravity's share of the tangent, less friction and air drag.
  const along = -params.world.gravity * T.y;
  const friction = r.friction * (1 + r.slideFriction * sinSlide);
  state.railSpeed += (along - friction - params.ground.drag * state.railSpeed * state.railSpeed) * dt;

  // Slide angle, turned by LB/RB — and on two sticks by the right stick sideways too, the
  // lower body turning the board under you, analog. Same way round as the air shifty the
  // same push gives, so a shifty onto the rail and the stick on it agree.
  const turn = (input.rb ? 1 : 0) - (input.lb ? 1 : 0) - (params.input.scheme > 0 ? input.rx : 0);
  state.slide = wrapAngle(state.slide + Math.max(-1, Math.min(1, turn)) * r.slideRate * dt);

  const rail = terrain.rails[state.railIndex];
  const box = rail !== undefined && rail.width > 0 ? r.boxStability : 1;
  const trick = r.trickModel >= 0.5;
  if (trick) stepTrick(state, input, params, box, dt);
  else {
    // Balance: b'' = λ·b − c·b' + gain·lx. λ grows with a board across the rail and with a press.
    const lambda = r.instability * box * (1 + r.slideDrift * sinSlide + r.pressDrift * Math.abs(state.stance));
    const acc =
      lambda * state.balance - 2 * r.balanceDamping * Math.sqrt(lambda) * state.balanceVel + r.correctionGain * input.lx;
    state.balanceVel += acc * dt;
    state.balance += state.balanceVel * dt;
  }

  state.railS += state.railDir * state.railSpeed * dt;
  state.scrub = 0;
  state.clearance = 0;
  damp(state.groundNormal, U, params.ground.normalSmoothing, dt);

  const offEnd = !rail || state.railS < 0 || state.railS > rail.length;
  if (!offEnd) frame(state, terrain, state.railS, state.railDir);

  // Board frame on the rail: forward turned by the slide angle about rail up.
  const c = dm.cos(state.slide);
  const s = dm.sin(state.slide);
  set(F, T.x * c + S.x * s, T.y * c + S.y * s, T.z * c + S.z * s);
  cross(heel, U, F);
  setFromBasis(state.spinFrame, heel, U, F);
  state.heading = dm.atan2(F.x, F.z);

  // Trick model: the board sits with its contact point over the rail, not its middle.
  const p = state.position;
  const back = trick ? state.railContact * r.boardHalf : 0;
  set(p, railPos.x - F.x * back + U.x * r.rideHeight, railPos.y - F.y * back + U.y * r.rideHeight, railPos.z - F.z * back + U.z * r.rideHeight);
  set(v, T.x * state.railSpeed, T.y * state.railSpeed, T.z * state.railSpeed);
  // The side you fall to: the rail's side in the old model, over an edge in the trick model.
  const fall = trick ? heel : S;

  if (trick && Math.abs(state.railContact) >= 1) {
    // Rail past a tip: the board slips off that end and you go down on the other side.
    const end = state.railContact > 0 ? 1 : -1;
    v.x -= F.x * end * r.fallSpeed;
    v.z -= F.z * end * r.fallSpeed;
    leaveRail(state);
    state.mode = 'bailed';
    state.landing = 'bail';
    state.bailTime = 0;
    return;
  }

  if (Math.abs(state.balance) > r.balanceMax) {
    // Lean lost: off the side and down.
    const side = state.balance > 0 ? 1 : -1;
    v.x += fall.x * side * r.fallSpeed;
    v.z += fall.z * side * r.fallSpeed;
    leaveRail(state);
    state.mode = 'bailed';
    state.landing = 'bail';
    state.bailTime = 0;
    return;
  }

  if (chargePop(state, input, params, dt)) {
    // Pop off along rail up, charged like a pop off snow — and spins off a rail work too.
    const bias = popBias(state.stance, params);
    const impulse = (params.pop.base + params.pop.charged * state.compress) * bias;
    v.x += U.x * impulse;
    v.y += U.y * impulse;
    v.z += U.z * impulse;
    state.charge = 0;
    // Off balance or out on a press you can't throw the upper body properly: the wind-up
    // the pop can release is scaled down — a smaller spin out, not none.
    const off = Math.min(1, Math.max(Math.abs(state.balance) / Math.max(r.balanceMax, 1e-3), trick ? Math.abs(state.railContact) : 0));
    state.windUp *= 1 - r.offBalanceSpin * off;
    leaveRail(state);
    popTakeoff(state, input, params);
    return;
  }

  if (offEnd || state.railSpeed < r.stallSpeed) {
    // Off the end keeps the speed; a stall drops you off the side you lean to.
    if (!offEnd) {
      const side = state.balance > 0 ? 1 : -1;
      v.x += fall.x * side * r.stallPush;
      v.z += fall.z * side * r.stallPush;
    }
    leaveRail(state);
    rideOff(state, input, params, 0);
  }
}

/**
 * Trick model. The stick is where you put your weight, in screen space — X toward the
 * rail's side S, Y toward travel T — split onto the board by the slide angle, so a
 * 50-50, a boardslide and switch all read the same way:
 * - across the board (toward heel) it fights the lean over the edges, the old balance;
 * - along the board it moves the contact point: a nose or tail press is a shift, and past
 *   `pressTip` the end outweighs you and runs away.
 * A board across the rail is grabbed by it while the body keeps going, so a slide pitches
 * you toward travel and holding it takes a steady push back.
 */
function stepTrick(state: RiderState, input: InputSnapshot, params: Params, box: number, dt: number): void {
  const r = params.rail;
  const c = dm.cos(state.slide);
  const s = dm.sin(state.slide);
  // w = lx·S + ly·T against F = c·T + s·S and heel = U × F = s·T − c·S.
  // Two sticks: the left stick is only the lean (still screen space), and the press along
  // the board is the right stick's, as on the snow — up the leading end — so a press no
  // longer has to come out of the balance fight.
  const two = params.input.scheme > 0;
  const dir = params.ground.switchEdges > 0 && state.switchRide ? -1 : 1;
  const wAlong = two ? input.ry * dir : input.lx * s + input.ly * c;
  const wHeel = input.ly * s - input.lx * c;
  const contact = state.railContact;

  const lambda = r.instability * box * (1 + r.slideDrift * Math.abs(s) + r.pressDrift * Math.abs(contact));
  const acc =
    lambda * state.balance -
    2 * r.balanceDamping * Math.sqrt(lambda) * state.balanceVel +
    r.correctionGain * wHeel +
    r.slidePull * s;
  state.balanceVel += acc * dt;
  state.balance += state.balanceVel * dt;

  const k = r.pressStiffness;
  let cAcc = k * (r.pressMax * wAlong - contact) - 2 * r.pressDamping * Math.sqrt(k) * state.railContactVel;
  const over = Math.abs(contact) - r.pressTip;
  if (over > 0) cAcc += r.tipInstability * over * (contact > 0 ? 1 : -1);
  state.railContactVel += cAcc * dt;
  state.railContact += state.railContactVel * dt;
}

function leaveRail(state: RiderState): void {
  state.railIndex = -1;
  state.balance = 0;
  state.balanceVel = 0;
  state.railContact = 0;
  state.railContactVel = 0;
}

/**
 * Catch a rail: board within `rail.captureRadius` of the rail top, travelling within
 * `rail.captureAngle` of its line either way, and not climbing away from it. Called from
 * the air and from snow. The entry seeds the balance — a sideways miss leans you, sideways
 * speed starts the lean moving — and a perfect entry still starts `rail.minImbalance` off.
 */
export function tryCapture(state: RiderState, params: Params, terrain: Terrain, fromSnow: boolean): boolean {
  const r = params.rail;
  const p = state.position;
  const v = state.velocity;
  for (let i = 0; i < terrain.rails.length; i++) {
    const rail = terrain.rails[i];
    if (!rail) continue;
    const hit = nearestOnRail(rail, p.x, p.y - r.rideHeight, p.z);
    // Not at an end: a rider who just rode off the end would otherwise catch it again.
    if (hit.s <= 0 || hit.s >= rail.length) continue;
    const reach = r.captureRadius + rail.width * 0.5; // a box catches across its whole top
    if (hit.dist2 > reach * reach) continue;
    railAt(rail, hit.s, railPos, tan);
    // Riding along the snow, only a ride-on step catches you; anything taller takes a pop.
    if (fromSnow && railPos.y - p.y > r.rideOn) continue;
    const speed = Math.sqrt(dot(v, v));
    if (speed < r.stallSpeed) continue;
    const along = dot(v, tan);
    if (Math.abs(along) < speed * dm.cos(r.captureAngle)) continue;
    const dir = along >= 0 ? 1 : -1;
    state.railIndex = i;
    frame(state, terrain, hit.s, dir);
    if (dot(v, U) > speed * r.captureRise) {
      state.railIndex = -1;
      continue; // climbing away — a pop off this rail, not a landing on it
    }

    axisZ(F, state.spinFrame);
    if (params.input.scheme > 0 && state.shifty !== 0) {
      // Two sticks: the board as drawn, with the shifty — a shifty onto a rail is a
      // boardslide. It yaws the board about its own up: nose toward board +X for +shifty.
      axisX(heel, state.spinFrame);
      const cs = dm.cos(state.shifty);
      const sn = dm.sin(state.shifty);
      set(F, F.x * cs + heel.x * sn, F.y * cs + heel.y * sn, F.z * cs + heel.z * sn);
    }
    state.slide = dm.atan2(dot(F, S), dot(F, T));
    const along_ = along >= 0 ? along : -along;
    if (r.trickModel >= 0.5) {
      // The board as it meets the rail, flattened onto it: the miss along the board is the
      // contact point, the miss across it the lean; sideways speed starts both moving.
      const c = dm.cos(state.slide);
      const sn = dm.sin(state.slide);
      set(F, T.x * c + S.x * sn, T.y * c + S.y * sn, T.z * c + S.z * sn);
      cross(heel, U, F);
      const dx = p.x - railPos.x;
      const dy = p.y - railPos.y;
      const dz = p.z - railPos.z;
      const dAlong = dx * F.x + dy * F.y + dz * F.z;
      const dHeel = dx * heel.x + dy * heel.y + dz * heel.z;
      // Velocity off the rail's line, on the board's axes.
      const vHeel = dot(v, heel) - along * sn * dir;
      const vAlong = dot(v, F) - along * c * dir;
      let b = (r.entryOffsetGain * dHeel) / reach;
      if (Math.abs(b) < r.minImbalance) b = (vHeel >= 0 ? 1 : -1) * r.minImbalance;
      state.balance = b;
      state.balanceVel = (r.entryVelGain * vHeel) / along_;
      state.railContact = Math.max(-0.95, Math.min(0.95, -dAlong / r.boardHalf));
      state.railContactVel = (-r.entryVelGain * vAlong) / r.boardHalf;
    } else {
      const offset = (p.x - railPos.x) * S.x + (p.y - railPos.y) * S.y + (p.z - railPos.z) * S.z;
      const lateral = dot(v, S);
      let b = (r.entryOffsetGain * offset) / reach;
      if (Math.abs(b) < r.minImbalance) b = (lateral >= 0 ? 1 : -1) * r.minImbalance;
      state.balance = b;
      state.balanceVel = (r.entryVelGain * lateral) / along_;
    }

    state.mode = 'railed';
    state.railS = hit.s;
    state.railDir = dir;
    state.railSpeed = Math.abs(along);
    state.impact = Math.abs(dot(v, U));
    state.landing = 'none';
    state.spinRate = 0;
    state.airTime = 0;
    state.popWindow = 0;
    state.grip = 0;
    state.grabHeld = false;
    state.tweak = 0;
    state.shifty = 0;
    state.airPitch = 0;
    return true;
  }
  return false;
}
