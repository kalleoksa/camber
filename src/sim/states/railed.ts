import type { InputSnapshot } from '../../input/snapshot.ts';
import type { Params } from '../params.ts';
import { axisZ, setFromBasis } from '../quat.ts';
import { nearestOnRail, railAt } from '../rails.ts';
import type { RiderState } from '../state.ts';
import type { Terrain } from '../terrain.ts';
import { cross, damp, dot, normalize, set, vec3, wrapAngle } from '../vec3.ts';
import * as dm from '../dmath.ts';
import { chargePop, popTakeoff, rideOff } from './grounded.ts';

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

  // Slide angle, turned by LB/RB.
  state.slide = wrapAngle(state.slide + ((input.rb ? 1 : 0) - (input.lb ? 1 : 0)) * r.slideRate * dt);

  // Balance: b'' = λ·b − c·b' + gain·lx. λ grows with a board across the rail and with a press.
  const rail = terrain.rails[state.railIndex];
  const box = rail !== undefined && rail.width > 0 ? r.boxStability : 1;
  const lambda = r.instability * box * (1 + r.slideDrift * sinSlide + r.pressDrift * Math.abs(state.stance));
  const acc =
    lambda * state.balance - 2 * r.balanceDamping * Math.sqrt(lambda) * state.balanceVel + r.correctionGain * input.lx;
  state.balanceVel += acc * dt;
  state.balance += state.balanceVel * dt;

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

  const p = state.position;
  set(p, railPos.x + U.x * r.rideHeight, railPos.y + U.y * r.rideHeight, railPos.z + U.z * r.rideHeight);
  set(v, T.x * state.railSpeed, T.y * state.railSpeed, T.z * state.railSpeed);

  if (Math.abs(state.balance) > r.balanceMax) {
    // Lean lost: off the side and down.
    const side = state.balance > 0 ? 1 : -1;
    v.x += S.x * side * r.fallSpeed;
    v.z += S.z * side * r.fallSpeed;
    leaveRail(state);
    state.mode = 'bailed';
    state.landing = 'bail';
    state.bailTime = 0;
    return;
  }

  if (chargePop(state, input, params, dt)) {
    // Pop off along rail up, charged like a pop off snow — and spins off a rail work too.
    const bias = 1 - state.stance * params.pop.stanceBias;
    const impulse = (params.pop.base + params.pop.charged * state.compress) * bias;
    v.x += U.x * impulse;
    v.y += U.y * impulse;
    v.z += U.z * impulse;
    state.charge = 0;
    leaveRail(state);
    popTakeoff(state, input, params);
    return;
  }

  if (offEnd || state.railSpeed < r.stallSpeed) {
    // Off the end keeps the speed; a stall drops you off the side you lean to.
    if (!offEnd) {
      const side = state.balance > 0 ? 1 : -1;
      v.x += S.x * side * r.stallPush;
      v.z += S.z * side * r.stallPush;
    }
    leaveRail(state);
    rideOff(state, input, params, 0);
  }
}

function leaveRail(state: RiderState): void {
  state.railIndex = -1;
  state.balance = 0;
  state.balanceVel = 0;
}

/**
 * Catch a rail: board within `rail.captureRadius` of the rail top, travelling within
 * `rail.captureAngle` of its line either way, and not climbing away from it. Called from
 * the air and from snow. The entry seeds the balance — a sideways miss leans you, sideways
 * speed starts the lean moving — and a perfect entry still starts `rail.minImbalance` off.
 */
export function tryCapture(state: RiderState, params: Params, terrain: Terrain): boolean {
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
    state.slide = dm.atan2(dot(F, S), dot(F, T));
    const offset = (p.x - railPos.x) * S.x + (p.y - railPos.y) * S.y + (p.z - railPos.z) * S.z;
    const lateral = dot(v, S);
    let b = (r.entryOffsetGain * offset) / reach;
    if (Math.abs(b) < r.minImbalance) b = (lateral >= 0 ? 1 : -1) * r.minImbalance;
    state.balance = b;
    state.balanceVel = (r.entryVelGain * lateral) / Math.abs(along);

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
    state.tweak = 0;
    state.shifty = 0;
    return true;
  }
  return false;
}
