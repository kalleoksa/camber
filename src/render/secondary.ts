import { createHasher, type Hasher } from '../sim/hash.ts';
import type { Params } from '../sim/params.ts';
import type { RiderState } from '../sim/state.ts';

/**
 * Render-owned secondary motion: the springs that lag behind sim state (design §7.6).
 *
 * It lives on the render side of invariant 5 — the sim never reads it — but it is stepped
 * on the fixed sim tick rather than on the render frame, and that is the whole point.
 * Replay re-simulates from recorded input, so sim state is bit-identical on playback while
 * the frame loop is not: rAF delivers a different cadence every run. A spring integrated
 * per frame therefore diverges between a take and its replay with no clock read and no
 * randomness anywhere in it, which is the failure the naive reading of "don't use the wall
 * clock" misses. Stepping per tick makes this state a function of (tick, sim state, params)
 * and nothing else, so it reproduces for the same reason the sim does.
 *
 * Deliberately free of Three.js and of any float the sim owns, so the headless determinism
 * check can step it too. Cloth bones join this struct when milestone 9c lands; they must
 * arrive here and not in a per-frame update.
 */

/** Extra hip drop per m/s of landing impact. */
const ABSORB_PER_IMPACT = 0.022;

export type Secondary = {
  hipY: number; // m along the board normal, − is crouch. Feeds RigDrivers.hipY
  hipVel: number; // m/s
};

export function createSecondary(): Secondary {
  return { hipY: 0, hipVel: 0 };
}

/** Reachable from the reset button, so it writes in place (invariant 7). */
export function resetSecondary(sec: Secondary): void {
  sec.hipY = 0;
  sec.hipVel = 0;
}

export function copySecondary(dst: Secondary, src: Secondary): void {
  dst.hipY = src.hipY;
  dst.hipVel = src.hipVel;
}

/**
 * Adopt a hand-authored pose as the spring's current position. Pose mode writes the drivers
 * directly, so without this the first frame back in play snaps from the authored hip height
 * to wherever the spring was parked when pose mode started.
 */
export function seedSecondary(sec: Secondary, hipY: number): void {
  sec.hipY = hipY;
  sec.hipVel = 0;
}

/**
 * One fixed sim tick of spring integration. Semi-implicit, stable at 120 Hz (§7.6).
 * `hipStiffness` is ω², so ω is its square root — the param name predates the formula.
 */
export function stepSecondary(sec: Secondary, state: RiderState, params: Params, dt: number): void {
  const absorb = state.absorb > 0 ? state.impact * ABSORB_PER_IMPACT : 0;
  // `rig.crouchDepth`, not a local constant: the param exists and is on a slider, so a
  // hardcoded depth here would leave that slider doing nothing in play. Same value, so the
  // hashes are unchanged.
  const target = -state.compress * params.rig.crouchDepth - absorb;
  const k = params.rig.hipStiffness;
  const acc = k * (target - sec.hipY) - 2 * params.rig.hipDamping * Math.sqrt(k) * sec.hipVel;
  sec.hipVel += acc * dt;
  sec.hipY += sec.hipVel * dt;
}

/**
 * What the render frame draws: between the last two tick states, exactly as
 * `interpolateRider` does for sim state. Velocities carry the current value — nothing
 * downstream draws them.
 */
export function sampleSecondary(out: Secondary, prev: Secondary, cur: Secondary, alpha: number): void {
  out.hipY = prev.hipY + (cur.hipY - prev.hipY) * alpha;
  out.hipVel = cur.hipVel;
}

// Reused so hashing per tick doesn't allocate a closure (invariant 7).
const shared = createHasher();

/**
 * FNV-1a over the raw bits, same contract as `hashState`: exact, not rounded. This is what
 * turns "secondary motion must reproduce in replay" into something the determinism gate
 * catches rather than something a reviewer is expected to notice.
 */
export function hashSecondary(sec: Secondary, into: Hasher = shared): string {
  into.reset();
  into.push(sec.hipY);
  into.push(sec.hipVel);
  return into.digest();
}
