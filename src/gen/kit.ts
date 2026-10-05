import * as dm from '../sim/dmath.ts';
import { shapeLip, type ShapeConfig, type ShelfConfig, type SideHitConfig } from '../sim/features.ts';
import type { Params } from '../sim/params.ts';
import type { RailConfig } from '../sim/rails.ts';
import { hipTakeoff } from '../sim/hip.ts';
import { createContact, createSlope, type HipConfig, type KickerConfig, type QuarterConfig, type Terrain } from '../sim/terrain.ts';
import { normalize } from '../sim/vec3.ts';
import { next, type Rng } from '../sim/rng.ts';
import type { FeatureSpec } from '../park/layout.ts';
import type { GenConfig } from './config.ts';
import { fly, launch, popRange, type Grade } from './flight.ts';
import { rideArc, rideKicker } from './ride.ts';
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

/**
 * The real ground seen from a feature at `place`: local (0, 0) is the place, local −Z its axis
 * and +X across it — the frame every solve here works in. Heights are the ground's own; normals
 * turn with the frame. No rails: a solve flies and rides over snow.
 */
export function groundFrame(world: Terrain, place: Place): Terrain {
  const sn = dm.sin(place.yaw);
  const cs = dm.cos(place.yaw);
  return {
    rails: [],
    sample(x, z, out) {
      world.sample(place.x - z * sn + x * cs, place.z + z * cs + x * sn, out);
      const nx = out.normal.x;
      const nz = out.normal.z;
      out.normal.x = nx * cs + nz * sn;
      out.normal.z = -nx * sn + nz * cs;
      return out;
    },
  };
}

/** Features built on flat ground (pitch 0) set onto `ground`: heights add, and so do slopes. */
export function stack(ground: Terrain, features: Terrain): Terrain {
  const f = createContact();
  return {
    rails: [],
    sample(x, z, out) {
      features.sample(x, z, f);
      ground.sample(x, z, out);
      const dx = out.normal.x / out.normal.y + f.normal.x / f.normal.y;
      const dz = out.normal.z / out.normal.y + f.normal.z / f.normal.y;
      out.height += f.height;
      out.normal.x = dx;
      out.normal.y = 1;
      out.normal.z = dz;
      normalize(out.normal);
      if (f.height > 0) {
        out.surface = f.surface;
        out.faceX = f.faceX;
        out.faceZ = f.faceZ;
      }
      return out;
    },
  };
}

/** The ground a feature at `place` is solved on: the real one when given, else a plane at `pitch`. */
function baseFor(place: Place, pitch: number, ground?: Terrain): Terrain {
  return ground ? groundFrame(ground, place) : createSlope({ length: 600, width: 600, pitch });
}

const onBase = (base: Terrain, kickers: KickerConfig[]): Terrain => stack(base, createSlope({ length: 600, width: 600, pitch: 0, kickers }));

/**
 * A kicker solved for the speeds of its size. On `ground` (the real ground, features left out)
 * the flights and the ride run over it as it is — a landing that falls away steepens under
 * them — otherwise over a plane at `groundPitch`, the grade under the landing.
 */
export function designKicker(place: Place, size: Size, groundPitch: number, cfg: GenConfig, params: Params, ground?: Terrain, tilt = 0): FeatureSpec {
  const k = cfg.kicker;
  const preset = k.sizes[size];
  const H = preset.lip;
  const [vMin, vMax] = preset.speed as [number, number];
  const vMid = (vMin + vMax) / 2;
  const [popMin, popMax] = popRange(params);
  const popMid = (popMin + popMax) / 2;
  const theta = k.lipAngle * RAD;
  const phi = groundPitch;

  // The kicker at the origin facing straight down its axis, on the ground it will stand on: the
  // sim's own height function, so the solve and the ride agree.
  const base = baseFor(place, phi, ground);
  const under = createContact();
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
    ...(tilt !== 0 ? { tilt } : {}),
    };
  };
  const radius = H / (1 - dm.cos(theta));
  const runIn = radius * dm.sin(theta);
  const air = (kc: KickerConfig, speed: number, pop: number): ReturnType<typeof fly> => {
    const t = onBase(base, [kc]);
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
    const probe = onBase(base, [{ ...build(0.01, H, 0.5), deckWidth: k.width, knuckleHeight: undefined, landingAngle: undefined, deckLength: 0, landingLength: 0 }]);
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
      if (vy < 0 && py - base.sample(0, pz, under).height <= hk) break; // knuckle height above the ground under it
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
  const slow = rideKicker(onBase(base, [build(deck, hk, alphaRel)]), params, 0, runIn, deck, vMin, false);
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
  const c: HipConfig = {
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

export function designShape(kind: 'roller' | 'spine' | 'sideHit', place: Place, rng: Rng, cfg: GenConfig): FeatureSpec {
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

// Obstacles from docs/obstacles-plan.md. Each returns its parts — one, or a takeoff and its
// rail — or none when the spot or the speed can't make it work. The caller gives parts of one
// obstacle a shared `meta.group`.

/** A park side hit: the small painted kicker that fills between bigger features. */
export function designMini(place: Place, rng: Rng, cfg: GenConfig): FeatureSpec[] {
  const m = cfg.mini;
  const shape: SideHitConfig = { kind: 'sideHit', ...place, height: range(rng, m.height), angle: range(rng, m.angle) * RAD, back: m.back, width: range(rng, m.width), taper: m.taper, paint: true };
  return [{ kind: 'shape', cfg: shape, meta: { type: 'mini', speed: m.speed as [number, number], lip: shapeLip(shape) } }];
}

export function designKnoll(place: Place, rng: Rng, cfg: GenConfig): FeatureSpec[] {
  const k = cfg.knoll;
  const radius = range(rng, k.radius);
  return [{ kind: 'shape', cfg: { kind: 'knoll', ...place, height: range(rng, k.height), radius, back: radius * range(rng, k.back) }, meta: { type: 'knoll', lip: 0 } }];
}

/** A round rail lying along `yaw` on a low mound — ollie it or bonk it. */
export function designLog(place: Place, rng: Rng, cfg: GenConfig): FeatureSpec[] {
  const L = cfg.log;
  const len = range(rng, L.length);
  const h = range(rng, L.height);
  const ax = dm.sin(place.yaw);
  const az = -dm.cos(place.yaw);
  const rail: RailConfig = { points: [[place.x, h, place.z], [place.x + ax * len, h, place.z + az * len]] };
  // The mound is a roller turned across the log, its crest under the log's middle.
  const midX = place.x + (ax * len) / 2;
  const midZ = place.z + (az * len) / 2;
  const across = place.yaw + Math.PI / 2;
  const mound: ShapeConfig = {
    kind: 'roller',
    x: midX - (dm.sin(across) * L.moundLength) / 2,
    z: midZ + (dm.cos(across) * L.moundLength) / 2,
    yaw: across,
    height: L.mound,
    length: L.moundLength,
    width: len,
    taper: 1.5,
  };
  return [
    { kind: 'rail', cfg: rail, meta: { type: 'log' } },
    { kind: 'shape', cfg: mound, meta: { type: 'log' } },
  ];
}

/**
 * Two low quarter pipes facing across a flat bottom, running down the hill from `place` along
 * `yaw`: ridden wall to wall at park speed. Each wall turns about its own origin, so placing
 * the origins at the turned offsets turns the pipe as one. Only on the grade it was made for.
 */
export function designMiniPipe(place: Place, groundPitch: number, rng: Rng, cfg: GenConfig): FeatureSpec[] {
  const P = cfg.miniPipe;
  if (groundPitch < (P.grade[0] ?? 0) * RAD || groundPitch > (P.grade[1] ?? 90) * RAD) return [];
  const length = range(rng, P.length);
  const flat = range(rng, P.flat);
  const height = range(rng, P.height);
  const angle = range(rng, P.angle) * RAD;
  const radius = range(rng, P.radius);
  const ax = dm.sin(place.yaw);
  const az = -dm.cos(place.yaw);
  const cx = place.x + (ax * length) / 2;
  const cz = place.z + (az * length) / 2;
  const wall = (side: 1 | -1): FeatureSpec => {
    const off = (side * flat) / 2;
    const q: QuarterConfig = {
      x: cx + off * dm.cos(place.yaw),
      z: cz + off * dm.sin(place.yaw),
      yaw: place.yaw,
      side,
      width: length,
      height,
      angle,
      radius,
      deck: P.deck,
      backAngle: P.backAngle * RAD,
      sideTaper: P.sideTaper,
    };
    return { kind: 'quarter', cfg: q, meta: { type: 'miniPipe' } };
  };
  return [wall(-1), wall(1)];
}

/**
 * A flight off a takeoff at the origin facing down −Z on plane `t` (pitch `pitch`): metres
 * past the lip and height above the plane, every few ticks until it comes down.
 */
function arc(t: Terrain, runIn: number, speed: number, pop: number, pitch: number, params: Params): [number, number][] {
  const lipZ = -runIn + 0.02;
  const l = launch(t, 0, lipZ, 0, -1, speed, pop);
  const f = fly(t, params, 0, l.y, lipZ, l.vx, l.vy, l.vz, 6, true);
  const tanP = dm.tan(pitch);
  const out: [number, number][] = [];
  for (let i = 0; i + 2 < f.points.length; i += 3) {
    const y = f.points[i + 1] ?? 0;
    const z = f.points[i + 2] ?? 0;
    out.push([-z - runIn, y - z * tanP]);
  }
  return out;
}

/** Metres past the lip where an arc, coming down, passes `h` above the plane; −1 if it never does. */
function downThrough(a: [number, number][], h: number): number {
  let top = 0;
  for (let i = 1; i < a.length; i++) if ((a[i]?.[1] ?? 0) > (a[top]?.[1] ?? 0)) top = i;
  for (let i = top; i < a.length; i++) if ((a[i]?.[1] ?? 0) <= h) return a[i]?.[0] ?? -1;
  return -1;
}

/** Lowest point of an arc above the plane between `from` and `to` m past the lip. */
function lowestOver(a: [number, number][], from: number, to: number): number {
  let low = Infinity;
  for (const [past, above] of a) if (past >= from && past <= to) low = Math.min(low, above);
  return low;
}

/**
 * Euro gap: a tabletop (table at lip height) with a rail along the table to air over. The
 * landing comes from the kicker solve; the knuckle moves to where the slowest unpopped air
 * comes down to table height. The rail sits between the lip and the knuckle, low enough that
 * the slowest air with a medium pop clears its top by `clear` — a rider short of that lands on
 * it, which is a real jib.
 */
export function designEuroGap(place: Place, size: Size, groundPitch: number, rng: Rng, cfg: GenConfig, params: Params): FeatureSpec[] {
  const E = cfg.euroGap;
  const base = designKicker({ x: 0, z: 0, yaw: 0 }, size, groundPitch, cfg, params);
  const k = base.cfg as KickerConfig;
  const H = k.lipHeight;
  const runIn = (H / (1 - dm.cos(k.lipAngle))) * dm.sin(k.lipAngle);
  const [vMin, vMax] = base.meta?.speed ?? [0, 0];
  const [popMin, popMax] = popRange(params);
  const popMid = (popMin + popMax) / 2;
  const probe = createSlope({ length: 600, width: 600, pitch: groundPitch, kickers: [{ x: 0, z: 0, width: k.width, lipHeight: H, lipAngle: k.lipAngle, deckLength: 0, sideTaper: k.sideTaper, landingLength: 0 }] });
  const reach = downThrough(arc(probe, runIn, vMin, popMin, groundPitch, params), H);
  if (reach < 0) return [];
  const deck = Math.min(E.table[1] ?? 18, Math.max(E.table[0] ?? 8, reach - cfg.kicker.knuckleClear));
  const landingAngle = k.landingAngle ?? 0.5;
  const [knuckleRadius, runoutRadius] = fitRadii(H, landingAngle, cfg.kicker.knuckleRadius, cfg.kicker.runoutRadius);
  const table: KickerConfig = {
    x: place.x,
    z: place.z,
    yaw: place.yaw,
    width: k.width,
    lipHeight: H,
    lipAngle: k.lipAngle,
    deckLength: deck,
    sideTaper: k.sideTaper,
    deckWidth: k.deckWidth ?? k.width,
    deckTaper: k.deckTaper ?? k.sideTaper,
    landingAngle,
    knuckleRadius,
    runoutRadius,
  };
  const R = E.rail;
  const from = R.start;
  const to = deck - R.setBack;
  if (to - from < (R.length[0] ?? 4)) return [];
  const len = Math.min(range(rng, R.length), to - from);
  const r0 = from + (to - from - len) / 2;
  const over = lowestOver(arc(probe, runIn, vMin, popMid, groundPitch, params), r0, r0 + len) - H - R.clear;
  const railH = Math.min(R.height[1] ?? 1, over);
  if (railH < (R.height[0] ?? 0.3)) return [];
  const ax = dm.sin(place.yaw);
  const az = -dm.cos(place.yaw);
  const at = (along: number): [number, number, number] => [place.x + ax * along, railH, place.z + az * along];
  return [
    { kind: 'kicker', cfg: table, meta: { type: 'euroGap', size, speed: [vMin, vMax], lip: runIn } },
    { kind: 'rail', cfg: { points: [at(runIn + r0), at(runIn + r0 + len)] }, meta: { type: 'euroGap' } },
  ];
}

/**
 * Gap to rail: a small painted takeoff, a gap, then a down rail — high where the air reaches
 * it, falling to `rail.end` above the snow, steeper than the slope. Placed from the real rider
 * (a small lip launches lower than the flight model has it) with a half charge: the rail starts
 * where the air, coming down, is `over` above its top, and the air must meet it within
 * `rail.steep` of the capture angle — a rail dropped onto steeply doesn't catch. The design
 * speed is the one in range whose gap from the takeoff's back comes nearest the middle of
 * `gap`; none in range → nothing here.
 */
export function designGapToRail(place: Place, groundPitch: number, rng: Rng, cfg: GenConfig, params: Params): FeatureSpec[] {
  const G = cfg.gapToRail;
  const R = G.rail;
  const hit: SideHitConfig = { kind: 'sideHit', x: 0, z: 0, yaw: 0, height: range(rng, G.height), angle: G.angle * RAD, back: G.back, width: G.width, taper: G.taper, paint: true };
  const runIn = shapeLip(hit);
  const t = createSlope({ length: 600, width: 600, pitch: groundPitch, shapes: [hit] });
  const len = range(rng, R.length);
  const want = ((G.gap[0] ?? 1) + (G.gap[1] ?? 4)) / 2;
  let best: { v: number; start: number; height: number } | undefined;
  for (let v = G.speed[0] ?? 3; v <= (G.speed[1] ?? 8) + 1e-9; v += 0.5) {
    const air = rideArc(t, params, 0, runIn, v, 0.5);
    let top = 0;
    for (let i = 1; i < air.length; i++) if ((air[i]?.[1] ?? 0) > (air[top]?.[1] ?? 0)) top = i;
    // First point coming down that's low enough for the tallest start.
    let i = top;
    while (i < air.length && (air[i]?.[1] ?? 0) > (R.height[1] ?? 2) + R.over) i++;
    const p = air[i];
    if (!p) continue;
    const height = p[1] - R.over;
    if (height < (R.height[0] ?? 0.5)) continue;
    const railAngle = groundPitch + dm.atan((height - R.end) / len);
    const meetAngle = air[Math.min(air.length - 1, i + 6)]?.[2] ?? 0; // where it actually meets the rail, a few ticks on
    if (meetAngle - railAngle > params.rail.captureAngle * R.steep) continue;
    const gap = p[0] - G.back;
    if (gap < (G.gap[0] ?? 1) || gap > (G.gap[1] ?? 4)) continue;
    if (!best || Math.abs(gap - want) < Math.abs(best.start - G.back - want)) best = { v, start: p[0], height };
  }
  if (!best) return [];
  const ax = dm.sin(place.yaw);
  const az = -dm.cos(place.yaw);
  const at = (along: number, h: number): [number, number, number] => [place.x + ax * along, h, place.z + az * along];
  return [
    { kind: 'shape', cfg: { ...hit, ...place }, meta: { type: 'gapToRail', speed: [best.v - 1, best.v + 1], lip: runIn } },
    { kind: 'rail', cfg: { points: [at(runIn + best.start, best.height), at(runIn + best.start + len, R.end)] }, meta: { type: 'gapToRail' } },
  ];
}

/** A jib table — low lip, long flat deck, gentle landing — with a rail or box along the deck. */
export function designJibTable(place: Place, rng: Rng, cfg: GenConfig): FeatureSpec[] {
  const J = cfg.jibTable;
  const theta = J.lipAngle * RAD;
  const runIn = (J.lip / (1 - dm.cos(theta))) * dm.sin(theta);
  const deck = range(rng, J.deck);
  const landingAngle = J.landingAngle * RAD;
  const [knuckleRadius, runoutRadius] = fitRadii(J.lip, landingAngle, J.knuckleRadius, J.runoutRadius);
  const table: KickerConfig = {
    x: place.x,
    z: place.z,
    yaw: place.yaw,
    width: J.width,
    deckWidth: J.width,
    lipHeight: J.lip,
    lipAngle: theta,
    deckLength: deck,
    sideTaper: J.sideTaper,
    landingAngle,
    knuckleRadius,
    runoutRadius,
  };
  const R = J.rail;
  const len = Math.min(range(rng, R.length), deck - R.start - R.end);
  const h = range(rng, R.height);
  const box = next(rng) < 0.5;
  const ax = dm.sin(place.yaw);
  const az = -dm.cos(place.yaw);
  const at = (along: number): [number, number, number] => [place.x + ax * along, h, place.z + az * along];
  const points = [at(runIn + R.start), at(runIn + R.start + len)];
  return [
    { kind: 'kicker', cfg: table, meta: { type: 'jibTable', speed: cfg.lines.railSpeed as [number, number], lip: runIn } },
    { kind: 'rail', cfg: box ? { points, width: J.box } : { points }, meta: { type: box ? 'box' : 'rail' } },
  ];
}

// Build step 3: obstacles solved over the real ground. `ground` is the ground alone (no
// features), as the generator has it.

/** m the ground falls away below the run-in's grade, `probe` m along `place`'s axis. */
export function dropAhead(ground: Terrain, place: Place, probe: number): number {
  const base = groundFrame(ground, place);
  const c = createContact();
  const h0 = base.sample(0, 0, c).height;
  const grade = (h0 - base.sample(0, -8, c).height) / 8; // the run-in's fall per metre
  return h0 - grade * probe - base.sample(0, -probe, c).height;
}

/** Step-down: a kicker where the ground falls away below it, solved over that ground. */
export function designStepDown(place: Place, size: Size, groundPitch: number, ground: Terrain, cfg: GenConfig, params: Params): FeatureSpec[] {
  const drop = dropAhead(ground, place, cfg.stepDown.probe);
  if (drop < (cfg.stepDown.drop[0] ?? 1) || drop > (cfg.stepDown.drop[1] ?? 6)) return [];
  const f = designKicker(place, size, groundPitch, cfg, params, ground);
  f.meta = { ...(f.meta ?? { type: 'stepDown' }), type: 'stepDown' };
  return [f];
}

/**
 * Booter: a big natural kicker with nothing built after it — the ground below is the landing.
 * Only where, over a run of speeds `span` m/s wide, a medium air comes down clean on ground
 * that is `landing`° steep; then the real rider rides it once at the middle speed.
 */
export function designBooter(place: Place, ground: Terrain, rng: Rng, cfg: GenConfig, params: Params): FeatureSpec[] {
  const B = cfg.booter;
  const hit: SideHitConfig = { kind: 'sideHit', x: 0, z: 0, yaw: 0, height: range(rng, B.height), angle: range(rng, B.angle) * RAD, back: B.back, width: range(rng, B.width), taper: B.taper };
  const runIn = shapeLip(hit);
  const base = groundFrame(ground, place);
  const t = stack(base, createSlope({ length: 600, width: 600, pitch: 0, shapes: [hit] }));
  const [popMin, popMax] = popRange(params);
  const c = createContact();
  const good: number[] = [];
  for (let v = B.speed[0] ?? 10; v <= (B.speed[1] ?? 18) + 1e-9; v += 1) {
    const lipZ = -runIn + 0.02;
    const l = launch(t, 0, lipZ, 0, -1, v, (popMin + popMax) / 2);
    const f = fly(t, params, 0, l.y, lipZ, l.vx, l.vy, l.vz, 6, false);
    const steep = dm.acos(base.sample(f.x, f.z, c).normal.y) / RAD;
    if (f.grade === 'clean' && steep >= (B.landing[0] ?? 28) && steep <= (B.landing[1] ?? 38)) good.push(v);
    else if (good.length) break;
  }
  const lo = good[0];
  const hi = good[good.length - 1];
  if (lo === undefined || hi === undefined || hi - lo < B.span) return [];
  const mid = (lo + hi) / 2;
  if (rideKicker(t, params, 0, runIn, 0, mid, false).landing !== 'clean') return [];
  return [{ kind: 'shape', cfg: { ...hit, ...place }, meta: { type: 'booter', speed: [lo, hi], lip: runIn } }];
}

/**
 * Cliff drop, built as a shelf the ground rises onto (the ground can't be cut). The tallest
 * height in range whose edge, ridden off without a pop or with a medium one at the slowest,
 * middle and top speed, lands clean on the ground below; then the real rider rides it once.
 */
export function designDrop(place: Place, ground: Terrain, rng: Rng, cfg: GenConfig, params: Params): FeatureSpec[] {
  const D = cfg.drop;
  const base = groundFrame(ground, place);
  const [vMin = 6, vMax = 14] = D.speed;
  const [popMin, popMax] = popRange(params);
  const rise = range(rng, D.rise);
  const top = range(rng, D.top);
  const width = range(rng, D.width);
  const edge = rise + top;
  for (let height = D.height[1] ?? 6; height >= (D.height[0] ?? 2) - 1e-9; height -= 0.5) {
    const shelf: ShelfConfig = { kind: 'shelf', x: 0, z: 0, yaw: 0, height, rise, top, face: D.face * RAD, width, taper: D.taper };
    const t = stack(base, createSlope({ length: 600, width: 600, pitch: 0, shapes: [shelf] }));
    let ok = true;
    for (const v of [vMin, (vMin + vMax) / 2, vMax]) {
      for (const pop of [0, (popMin + popMax) / 2]) {
        const lipZ = -edge + 0.02;
        const l = launch(t, 0, lipZ, 0, -1, v, pop);
        if (fly(t, params, 0, l.y, lipZ, l.vx, l.vy, l.vz, 6, false).grade !== 'clean') ok = false;
      }
    }
    if (!ok) continue;
    if (rideKicker(t, params, 0, edge, 0, (vMin + vMax) / 2, false).landing !== 'clean') continue;
    return [{ kind: 'shape', cfg: { ...shelf, ...place }, meta: { type: 'drop', speed: [vMin, vMax], lip: edge } }];
  }
  return [];
}

/**
 * Corner: a kicker whose takeoff faces across the slope; the landing lines up with the flight
 * and the ground turns the rider back down the hill after it. Built level across (`tilt`),
 * solved over the real ground.
 */
export function designCorner(place: Place, size: Size, ground: Terrain, cfg: GenConfig, params: Params): FeatureSpec[] {
  const base = groundFrame(ground, place);
  const c = createContact();
  // The ground's fall across the axis and along it, a little way down the landing.
  const n = base.sample(0, -15, c).normal;
  const tilt = dm.atan(n.x / n.y);
  const h0 = base.sample(0, -8, c).height;
  const along = dm.atan(Math.max(0, (h0 - base.sample(0, -26, c).height) / 18));
  const f = designKicker(place, size, along, cfg, params, ground, tilt);
  f.meta = { ...(f.meta ?? { type: 'corner' }), type: 'corner' };
  return [f];
}
