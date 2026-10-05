import * as dm from '../sim/dmath.ts';
import type { ShapeConfig } from '../sim/features.ts';
import type { Params } from '../sim/params.ts';
import type { RailConfig } from '../sim/rails.ts';
import { hipTakeoff } from '../sim/hip.ts';
import { createSlope, type CornerConfig, type KickerConfig, type QuarterConfig } from '../sim/terrain.ts';
import { next, type Rng } from '../sim/rng.ts';
import type { FeatureSpec } from '../park/layout.ts';
import type { GenConfig } from './config.ts';
import { fly, launch, popRange, type Grade } from './flight.ts';
import { rideKicker } from './ride.ts';
import { RAD, range } from './ground.ts';

/**
 * The feature kit: parameters in, a feature (terrain config + metadata) out. Every feature
 * sits at (x, z) on the ground and faces `yaw` off the fall line. Kicker landings are solved
 * from the flight at the design speeds; the rest are sized from config ranges.
 */
export type Size = 'S' | 'M' | 'L' | 'XL';
export type Place = { x: number; z: number; yaw: number };

/** One designed air, for overlays and checks. */
export type ArcCheck = { speed: number; pop: number; grade: Grade; impact: number; past: number }; // past: m beyond the knuckle

export function designKicker(place: Place, size: Size, groundPitch: number, cfg: GenConfig, params: Params): FeatureSpec {
  const k = cfg.kicker;
  const preset = k.sizes[size];
  const H = preset.lip;
  const [vMin, vMax] = preset.speed as [number, number];
  const vMid = (vMin + vMax) / 2;
  const [popMin, popMax] = popRange(params);
  const popMid = (popMin + popMax) / 2;
  const theta = k.lipAngle * RAD;
  const phi = groundPitch;

  // The kicker on a plane at the local grade, at the origin, facing straight down it: the sim's
  // own height function, so the solve and the ride agree.
  const build = (deckLength: number, knuckleHeight: number, landingAngle: number): KickerConfig => {
    const [knuckleRadius, runoutRadius] = fitRadii(knuckleHeight, landingAngle, k.knuckleRadius, k.runoutRadius);
    return {
    x: 0,
    z: 0,
    width: k.width,
    lipHeight: H,
    lipAngle: theta,
    deckLength,
    knuckleHeight,
    sideTaper: k.sideTaper,
    deckWidth: k.width + k.landingExtra,
    deckTaper: k.deckTaper,
    landingAngle,
    knuckleRadius,
    runoutRadius,
    };
  };
  const radius = H / (1 - dm.cos(theta));
  const runIn = radius * dm.sin(theta);
  const air = (kc: KickerConfig, speed: number, pop: number): ReturnType<typeof fly> => {
    const t = createSlope({ length: 600, width: 600, pitch: phi, kickers: [kc] });
    const lipZ = -runIn + 0.02;
    const l = launch(t, 0, lipZ, 0, -1, speed, pop);
    return fly(t, params, 0, l.y, lipZ, l.vx, l.vy, l.vz, 6, false);
  };

  // Knuckle: where the slowest, unpopped air comes down to knuckle height — on a plane with
  // nothing on it past the lip, so the landing doesn't get in the way of finding it.
  let hk = H * k.knuckleFraction;
  let alphaAbs = ((k.landing[0] ?? 28) + (k.landing[1] ?? 35)) * 0.5 * RAD;
  let deck = 0;
  for (let it = 0; it < k.iterations; it++) {
    const probe = createSlope({ length: 600, width: 600, pitch: phi, kickers: [{ ...build(0.01, H, 0.5), deckWidth: k.width, knuckleHeight: undefined, landingAngle: undefined, deckLength: 0, landingLength: 0 }] });
    const lipZ = -runIn + 0.02;
    const l = launch(probe, 0, lipZ, 0, -1, vMin, popMin);
    // Step the flight until it is at knuckle height above the plane, coming down.
    let py = l.y;
    let pz = lipZ;
    let vy = l.vy;
    const dt = 1 / 240;
    for (let t = 0; t < 6; t += dt) {
      vy -= params.world.gravity * dt;
      py += vy * dt;
      pz += l.vz * dt;
      const ground = pz * dm.tan(phi); // plane height under the point
      if (vy < 0 && py - ground <= hk) break;
    }
    deck = Math.max(2, -pz - runIn - k.knuckleClear);

    // Landing angle from the sweet-spot air, then lengthen (raise the knuckle) until the
    // fastest air lands on the straight with margin.
    const alphaRel = Math.max(0.05, alphaAbs - phi);
    const kc = build(deck, hk, alphaRel);
    const mid = air(kc, vMid, popMid);
    // Arc angle at touchdown, from horizontal: back out the velocity from the drop over the last step.
    const fall = mid.descent;
    alphaAbs = Math.min((k.landing[1] ?? 35) * RAD, Math.max((k.landing[0] ?? 28) * RAD, fall - k.sweetOffset * RAD));
    const far = air(kc, vMax, popMid);
    const knuckleDrop = (kc.knuckleRadius ?? 0) * (1 - dm.cos(alphaRel));
    const runoutRise = (kc.runoutRadius ?? 0) * (1 - dm.cos(alphaRel));
    const straightEnd = deck + (kc.knuckleRadius ?? 0) * dm.sin(alphaRel) + Math.max(0, hk - knuckleDrop - runoutRise) / dm.tan(alphaRel);
    const reach = -far.z - runIn; // m past the lip
    if (straightEnd < deck + (1 + k.landingMargin) * (reach - deck) && hk < H * k.knuckleMax) hk = Math.min(H * k.knuckleMax, hk + H * 0.1);
  }

  // Against the sim: the real rider at vMin without a pop lands short of the closed-form
  // flight (what the lip does to it isn't in that model). Move the knuckle so it clears it.
  const alphaRel = Math.max(0.05, alphaAbs - phi);
  const slow = rideKicker(createSlope({ length: 600, width: 600, pitch: phi, kickers: [build(deck, hk, alphaRel)] }), params, 0, runIn, deck, vMin, false);
  if (slow.landing && slow.past < k.knuckleClear * 0.5) deck = Math.max(2, deck + slow.past - k.knuckleClear * 0.5);
  const local = build(deck, hk, alphaRel);
  const checks: ArcCheck[] = [];
  for (const [speed, pop] of [
    [vMin, popMin],
    [vMid, popMid],
    [vMax, popMid],
    [vMax, popMax],
    [vMin, popMax],
  ] as [number, number][]) {
    const f = air(local, speed, pop);
    checks.push({ speed, pop, grade: f.grade, impact: f.impact, past: -f.z - runIn - deck });
  }
  const placed: KickerConfig = { ...local, x: place.x, z: place.z, yaw: place.yaw };
  return { kind: 'kicker', cfg: placed, meta: { type: 'kicker', size, speed: [vMin, vMax], lip: runIn, checks } };
}

/**
 * Step-up: a kicker whose landing is a table higher than its lip. The slowest air with a
 * medium pop comes down onto the top `landingOnTop` m past its edge; the top runs on past the
 * fastest air with a full pop, then drops away as a landing. Too much rise for the speed and
 * the air never reaches the top: the rise comes down until it does.
 */
export function designStepUp(place: Place, rng: Rng, groundPitch: number, cfg: GenConfig, params: Params): FeatureSpec {
  const k = cfg.kicker;
  const st = cfg.stepUp;
  const size = st.size as Size;
  const H = k.sizes[size].lip;
  const [vMin, vMax] = k.sizes[size].speed as [number, number];
  const [popMin, popMax] = popRange(params);
  const popMid = (popMin + popMax) / 2;
  const theta = k.lipAngle * RAD;
  const radius = H / (1 - dm.cos(theta));
  const runIn = radius * dm.sin(theta);
  const probe = createSlope({ length: 600, width: 600, pitch: groundPitch, kickers: [{ x: 0, z: 0, width: k.width, lipHeight: H, lipAngle: theta, deckLength: 0, sideTaper: k.sideTaper, landingLength: 0 }] });
  // Where an air comes back down to `h` above the ground plane, m past the lip; −1 if it never gets that high.
  const downTo = (speed: number, pop: number, h: number): number => {
    const lipZ = -runIn + 0.02;
    const l = launch(probe, 0, lipZ, 0, -1, speed, pop);
    let py = l.y;
    let pz = lipZ;
    let vy = l.vy;
    let high = false;
    const dt = 1 / 240;
    for (let t = 0; t < 6; t += dt) {
      vy -= params.world.gravity * dt;
      py += vy * dt;
      pz += l.vz * dt;
      const above = py - pz * dm.tan(groundPitch);
      if (above > h) high = true;
      if (vy < 0 && above <= h) return high ? -pz - runIn : -1;
    }
    return -1;
  };
  let rise = range(rng, st.rise);
  let near = downTo(vMin, popMid, H + rise);
  while (near < 0 && rise > 0.3) {
    rise -= 0.3;
    near = downTo(vMin, popMid, H + rise);
  }
  const deck = Math.max(st.face, near - st.landingOnTop);
  const far = downTo(vMax, popMax, H + rise);
  const top = Math.max(4, far - deck + st.topMargin);
  const c: KickerConfig = {
    x: place.x,
    z: place.z,
    yaw: place.yaw,
    width: k.width,
    lipHeight: H,
    lipAngle: theta,
    deckLength: deck,
    knuckleHeight: H + rise,
    topLength: top,
    sideTaper: k.sideTaper,
    deckWidth: k.width + k.landingExtra,
    deckTaper: k.deckTaper,
    landingAngle: Math.max(0.05, ((k.landing[0] ?? 28) + (k.landing[1] ?? 35)) * 0.5 * RAD - groundPitch),
  };
  [c.knuckleRadius, c.runoutRadius] = fitRadii(H + rise, c.landingAngle ?? 0.5, k.knuckleRadius, k.runoutRadius);
  return { kind: 'kicker', cfg: c, meta: { type: 'stepUp', size, speed: [vMin, vMax], lip: runIn } };
}

/**
 * A landing turns through its angle twice — over the knuckle and into the run-out — and each
 * arc costs height. When the two radii need more height than the landing has, the profile
 * has no straight left and steps up where the run-out begins; shrink both so they fit with
 * a fifth of the height left for the straight.
 */
function fitRadii(height: number, angle: number, knuckle: number, runout: number): [number, number] {
  const need = (knuckle + runout) * (1 - dm.cos(angle));
  const room = height * 0.8;
  if (need <= room) return [knuckle, runout];
  const f = room / need;
  return [knuckle * f, runout * f];
}

export function designHip(place: Place, size: 'S' | 'M' | 'L', rng: Rng, cfg: GenConfig): FeatureSpec {
  const h = cfg.hip;
  const s = h.scale[size];
  const side: -1 | 0 | 1 = next(rng) < h.single ? (next(rng) < 0.5 ? -1 : 1) : 0;
  const c: CornerConfig = {
    x: place.x,
    z: place.z,
    yaw: place.yaw,
    width: h.deckWidth * s,
    lipHeight: h.lip * s,
    lipAngle: h.lipAngle * RAD,
    deckLength: h.deckLength * s,
    deckWidth: h.deckWidth * s,
    sideTaper: 0.5,
    deckTaper: 0.5,
    landingAngle: h.landingEnd * RAD, // unused by a hip; the hip shape below sets the landing
    knuckleRadius: h.knuckleRadius * s,
    runoutRadius: h.bottomRadius * s,
    hip: {
      side,
      straightLip: h.straightLip * s,
      landingStart: h.landingStart * RAD,
      landingEnd: h.landingEnd * RAD,
      knuckleRadius: h.knuckleRadius * s,
      bottomRadius: h.bottomRadius * s,
    },
  };
  const hip = c.hip;
  const lip = hip ? hipTakeoff(c, hip).runIn : 0;
  const type = side === 0 ? 'double hip' : side < 0 ? 'hip left' : 'hip right';
  return { kind: 'corner', cfg: c, meta: { type, size, lip } };
}

export function designQuarter(place: Place, rng: Rng, cfg: GenConfig): FeatureSpec {
  const q = cfg.quarter;
  const c: QuarterConfig = {
    x: place.x,
    z: place.z,
    yaw: place.yaw,
    width: range(rng, q.width),
    height: range(rng, q.height),
    angle: q.angle * RAD,
    radius: range(rng, q.radius),
    deck: q.deck,
    sideTaper: q.sideTaper,
  };
  return { kind: 'quarter', cfg: c, meta: { type: 'quarter' } };
}

export function designShape(kind: ShapeConfig['kind'], place: Place, rng: Rng, cfg: GenConfig): FeatureSpec {
  let shape: ShapeConfig;
  if (kind === 'spine') {
    const p = cfg.spine;
    const height = range(rng, p.height);
    const [knuckleRadius, footRadius] = fitRadii(height, p.angle * RAD, p.knuckleRadius, p.footRadius);
    shape = { kind, ...place, height, angle: p.angle * RAD, knuckleRadius, footRadius, width: range(rng, p.width), taper: p.taper };
  } else if (kind === 'roller') {
    const p = cfg.roller;
    shape = { kind, ...place, height: range(rng, p.height), length: range(rng, p.length), width: range(rng, p.width), taper: p.taper };
  } else {
    const p = cfg.sideHit;
    shape = { kind, ...place, height: range(rng, p.height), angle: p.angle * RAD, back: p.back, width: range(rng, p.width), taper: p.taper };
  }
  return { kind: 'shape', cfg: shape, meta: { type: kind } };
}

/**
 * A rail or box laid along `yaw` from (x, z): straight, or flat-down (a flat section, then
 * down with the slope). Heights are above the snow, as the sim's rails take them. Ridden
 * from either end: nothing here makes it one-way.
 */
export function designRail(place: Place, rng: Rng, cfg: GenConfig): FeatureSpec {
  const r = cfg.rail;
  const len = range(rng, r.length);
  const h = range(rng, r.height);
  const box = next(rng) < 0.4;
  const flatDown = next(rng) < 0.4;
  const dx = dm.sin(place.yaw);
  const dz = -dm.cos(place.yaw);
  const at = (along: number, height: number): [number, number, number] => [place.x + dx * along, height, place.z + dz * along];
  const points = flatDown ? [at(0, h), at(len * 0.45, h + r.kink), at(len, h)] : [at(0, h), at(len, h)];
  const rail: RailConfig = box ? { points, width: r.boxWidth } : { points };
  return { kind: 'rail', cfg: rail, meta: { type: box ? 'box' : 'rail' } };
}
