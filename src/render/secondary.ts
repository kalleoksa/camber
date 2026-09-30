import { createHasher, type Hasher } from '../sim/hash.ts';
import type { Params } from '../sim/params.ts';
import { quat, rotate } from '../sim/quat.ts';
import type { RiderState } from '../sim/state.ts';
import { vec3 } from '../sim/vec3.ts';

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
 * check can step it too. Cloth bones (9c) live here too,
 * for the same reason — never in a per-frame update.
 */

export type Secondary = {
  hipY: number; // m along the board normal, − is crouch. Feeds RigDrivers.hipY
  hipVel: number; // m/s
  twist: number; // rad of spine twist from wind-up and shoulder lead (§7.7). Adds to spineTwist
  twistVel: number;
  head: number; // rad of head yaw leading the spin. Adds to headYaw
  headVel: number;
  // Cloth (9c). Skirt about the waist, hood about the back of the neck, each on two axes
  // in the rider's frame: X swings it along the board, Z toe-to-heel.
  skirtX: number;
  skirtXVel: number;
  skirtZ: number;
  skirtZVel: number;
  hoodX: number;
  hoodXVel: number;
  hoodZ: number;
  hoodZVel: number;
  // Loose body: smoothed board-frame acceleration, and the arm and hip springs it drives.
  accX: number;
  accY: number;
  accZ: number;
  lastVx: number;
  lastVy: number;
  lastVz: number;
  lastHeading: number;
  armX: number; // rad, arms swung toward the heel (+) or toe
  armXVel: number;
  armZ: number; // rad, arms out along the board toward the nose (+)
  armZVel: number;
  swayX: number; // m of hip travel toward the heel
  swayXVel: number;
  swayZ: number; // m toward the nose
  swayZVel: number;
};

const CLOTH_KEYS = [
  'skirtX',
  'skirtXVel',
  'skirtZ',
  'skirtZVel',
  'hoodX',
  'hoodXVel',
  'hoodZ',
  'hoodZVel',
  'accX',
  'accY',
  'accZ',
  'lastVx',
  'lastVy',
  'lastVz',
  'lastHeading',
  'armX',
  'armXVel',
  'armZ',
  'armZVel',
  'swayX',
  'swayXVel',
  'swayZ',
  'swayZVel',
] as const;
type ClothKey = (typeof CLOTH_KEYS)[number];

export function createSecondary(): Secondary {
  return {
    hipY: 0,
    hipVel: 0,
    twist: 0,
    twistVel: 0,
    head: 0,
    headVel: 0,
    skirtX: 0,
    skirtXVel: 0,
    skirtZ: 0,
    skirtZVel: 0,
    hoodX: 0,
    hoodXVel: 0,
    hoodZ: 0,
    hoodZVel: 0,
    accX: 0,
    accY: 0,
    accZ: 0,
    lastVx: 0,
    lastVy: 0,
    lastVz: 0,
    lastHeading: 0,
    armX: 0,
    armXVel: 0,
    armZ: 0,
    armZVel: 0,
    swayX: 0,
    swayXVel: 0,
    swayZ: 0,
    swayZVel: 0,
  };
}

/** Reachable from the reset button, so it writes in place (invariant 7). */
export function resetSecondary(sec: Secondary): void {
  sec.hipY = 0;
  sec.hipVel = 0;
  sec.twist = 0;
  sec.twistVel = 0;
  sec.head = 0;
  sec.headVel = 0;
  for (let i = 0; i < CLOTH_KEYS.length; i++) sec[CLOTH_KEYS[i] as ClothKey] = 0;
}

export function copySecondary(dst: Secondary, src: Secondary): void {
  dst.hipY = src.hipY;
  dst.hipVel = src.hipVel;
  dst.twist = src.twist;
  dst.twistVel = src.twistVel;
  dst.head = src.head;
  dst.headVel = src.headVel;
  for (let i = 0; i < CLOTH_KEYS.length; i++) {
    const k = CLOTH_KEYS[i] as ClothKey;
    dst[k] = src[k];
  }
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
  const r = params.rig;
  const absorb = state.absorb > 0 ? state.impact * r.absorbPerImpact : 0;
  // `rig.crouchDepth`, not a local constant: the param exists and is on a slider, so a
  // hardcoded depth here would leave that slider doing nothing in play. Same value, so the
  // hashes are unchanged.
  const target = -state.compress * params.rig.crouchDepth - absorb;
  const k = params.rig.hipStiffness;
  const acc = k * (target - sec.hipY) - 2 * params.rig.hipDamping * Math.sqrt(k) * sec.hipVel;
  sec.hipVel += acc * dt;
  sec.hipY += sec.hipVel * dt;

  // §7.7. Charging with the stick pushed winds the shoulders against the spin that's coming
  // (the spin will be −edge, so the wind-up is +edge); the pop releases it and the same
  // spring carries it through into a lead in the direction of the spin. The head looks
  // where the board will be `headLead` seconds on.
  const grounded = state.mode === 'grounded' || state.mode === 'walled';
  const airborne = state.mode === 'airborne';
  const spinFraction = Math.max(-1, Math.min(1, state.spinRate / params.air.spinTakeoff));
  // Shoulders lead a carve: the heading's rate, from the last tick's heading.
  const hasHistory = sec.lastVx !== 0 || sec.lastVy !== 0 || sec.lastVz !== 0;
  const turn = hasHistory ? wrapPi(state.heading - sec.lastHeading) / dt : 0;
  const twistTarget = grounded
    ? state.edge * state.compress * r.counterRotation + clamp(turn * r.carveLead, r.carveLeadMax)
    : airborne
      ? spinFraction * r.shoulderLead
      : 0;
  const headTarget = airborne ? Math.max(-r.headTurnMax, Math.min(r.headTurnMax, state.spinRate * r.headLead)) : 0;
  const ks = r.spineStiffness;
  const cs = 2 * r.spineDamping * Math.sqrt(ks);
  sec.twistVel += (ks * (twistTarget - sec.twist) - cs * sec.twistVel) * dt;
  sec.twist += sec.twistVel * dt;
  sec.headVel += (ks * (headTarget - sec.head) - cs * sec.headVel) * dt;
  sec.head += sec.headVel * dt;

  stepCloth(sec, state, params, dt);
  stepLoose(sec, state, params, dt);
}

function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const accel = vec3();

/**
 * Loose body. The board's acceleration, into the board frame and smoothed, pushes the
 * arms and hips the other way — they trail the board like a body not bolted to it. A
 * new run or a reset starts with no history, so the first tick sees no acceleration.
 */
function stepLoose(sec: Secondary, state: RiderState, params: Params, dt: number): void {
  const r = params.rig;
  const v = state.velocity;
  const fresh = sec.lastVx === 0 && sec.lastVy === 0 && sec.lastVz === 0;
  if (!fresh) {
    accel.x = (v.x - sec.lastVx) / dt;
    accel.y = (v.y - sec.lastVy) / dt;
    accel.z = (v.z - sec.lastVz) / dt;
    rotate(local, inverseOf(state.spinFrame), accel);
    const k = 1 - Math.exp(-r.accelSmoothing * dt);
    sec.accX += (local.x - sec.accX) * k;
    sec.accY += (local.y - sec.accY) * k;
    sec.accZ += (local.z - sec.accZ) * k;
  }
  sec.lastVx = v.x;
  sec.lastVy = v.y;
  sec.lastVz = v.z;
  sec.lastHeading = state.heading;

  // Arms trail: accelerating toward the nose swings them back toward the tail, and so on.
  const ka = r.armStiffness;
  const ca = 2 * r.armDamping * Math.sqrt(ka);
  const armXTarget = clamp(-sec.accX * r.armLag, r.armMax);
  const armZTarget = clamp(-sec.accZ * r.armLag, r.armMax);
  sec.armXVel += (ka * (armXTarget - sec.armX) - ca * sec.armXVel) * dt;
  sec.armX += sec.armXVel * dt;
  sec.armZVel += (ka * (armZTarget - sec.armZ) - ca * sec.armZVel) * dt;
  sec.armZ += sec.armZVel * dt;

  const ks = r.hipSwayStiffness;
  const cs = 2 * r.hipSwayDamping * Math.sqrt(ks);
  const swayXTarget = clamp(-sec.accX * r.hipSway, r.hipSwayMax);
  const swayZTarget = clamp(-sec.accZ * r.hipSway, r.hipSwayMax);
  sec.swayXVel += (ks * (swayXTarget - sec.swayX) - cs * sec.swayXVel) * dt;
  sec.swayX += sec.swayXVel * dt;
  sec.swayZVel += (ks * (swayZTarget - sec.swayZ) - cs * sec.swayZVel) * dt;
  sec.swayZ += sec.swayZVel * dt;
}

const inverseQ = quat();
function inverseOf(q: { x: number; y: number; z: number; w: number }): typeof inverseQ {
  inverseQ.x = -q.x;
  inverseQ.y = -q.y;
  inverseQ.z = -q.z;
  inverseQ.w = q.w;
  return inverseQ;
}

function clamp(x: number, m: number): number {
  return x > m ? m : x < -m ? -m : x;
}

const inverse = quat();
const local = vec3();

/**
 * Cloth (9c). The skirt is blown back by the rider's own travel: velocity in the board
 * frame, along the board (Z) swinging it about X, toe-to-heel (X) about Z. The hood trails
 * the spin. A landing kicks both — the tick `land()` ran is the one where `absorb` is
 * exactly `land.absorbTime`.
 */
function stepCloth(sec: Secondary, state: RiderState, params: Params, dt: number): void {
  const c = params.cloth;
  const q = state.spinFrame;
  inverse.x = -q.x;
  inverse.y = -q.y;
  inverse.z = -q.z;
  inverse.w = q.w;
  rotate(local, inverse, state.velocity);
  const skirtXTarget = clamp(c.skirtWind * local.z, c.skirtMax);
  const skirtZTarget = clamp(-c.skirtWind * local.x, c.skirtMax);
  const hoodXTarget = state.mode === 'airborne' ? clamp(-c.hoodLag * state.spinRate, c.hoodMax) : 0;
  const hoodZTarget = clamp(0.5 * c.skirtWind * local.z, c.hoodMax);

  if (state.absorb === params.land.absorbTime && state.mode !== 'airborne') {
    sec.skirtZVel += c.skirtImpact * state.impact;
    sec.hoodZVel -= c.hoodImpact * state.impact;
  }

  const ks = c.skirtStiffness;
  const cs = 2 * c.skirtDamping * Math.sqrt(ks);
  sec.skirtXVel += (ks * (skirtXTarget - sec.skirtX) - cs * sec.skirtXVel) * dt;
  sec.skirtX += sec.skirtXVel * dt;
  sec.skirtZVel += (ks * (skirtZTarget - sec.skirtZ) - cs * sec.skirtZVel) * dt;
  sec.skirtZ += sec.skirtZVel * dt;
  const kh = c.hoodStiffness;
  const ch = 2 * c.hoodDamping * Math.sqrt(kh);
  sec.hoodXVel += (kh * (hoodXTarget - sec.hoodX) - ch * sec.hoodXVel) * dt;
  sec.hoodX += sec.hoodXVel * dt;
  sec.hoodZVel += (kh * (hoodZTarget - sec.hoodZ) - ch * sec.hoodZVel) * dt;
  sec.hoodZ += sec.hoodZVel * dt;
}

/**
 * What the render frame draws: between the last two tick states, exactly as
 * `interpolateRider` does for sim state. Velocities carry the current value — nothing
 * downstream draws them.
 */
export function sampleSecondary(out: Secondary, prev: Secondary, cur: Secondary, alpha: number): void {
  out.hipY = prev.hipY + (cur.hipY - prev.hipY) * alpha;
  out.hipVel = cur.hipVel;
  out.twist = prev.twist + (cur.twist - prev.twist) * alpha;
  out.twistVel = cur.twistVel;
  out.head = prev.head + (cur.head - prev.head) * alpha;
  out.headVel = cur.headVel;
  for (let i = 0; i < CLOTH_KEYS.length; i++) {
    const k = CLOTH_KEYS[i] as ClothKey;
    out[k] = prev[k] + (cur[k] - prev[k]) * alpha;
  }
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
  into.push(sec.twist);
  into.push(sec.twistVel);
  into.push(sec.head);
  into.push(sec.headVel);
  for (let i = 0; i < CLOTH_KEYS.length; i++) into.push(sec[CLOTH_KEYS[i] as ClothKey]);
  return into.digest();
}
