import * as dm from '../sim/dmath.ts';
import type { FieldConfig } from '../sim/heightfield.ts';
import type { Params } from '../sim/params.ts';
import { next, type Rng } from '../sim/rng.ts';
import { createContact, createSlope, type Terrain } from '../sim/terrain.ts';
import { toSlopeConfig, type Design, type FeatureSpec, type LineSpec } from '../park/layout.ts';
import type { GenConfig } from './config.ts';
import { fly, launch, popRange } from './flight.ts';
import { footprint, overlaps, type Footprint } from './footprint.ts';
import { RAD, range } from './ground.ts';
import { chance, pick as input, type Draw, designHipQuarter, designBerm, designBooter, designCorner, designFunBox, designStepDownHip, designWallRide, designWedge, dropAhead, designDrop, designEuroGap, designGapToRail, designHip, designJibTable, designKicker, designKnoll, designLog, designMini, designMiniPipe, designQuarter, designRail, designShape, designStepDown, designStepUp, type Place, type Size } from './kit.ts';

/**
 * Spine lines: a few lines traced from the top down the fall line, drifting off it, with
 * features placed along each so that the speed a line carries is what the next feature is
 * sized for: going straight it reaches the feature's slowest design speed, and the run-in is
 * long enough to check down (L2) to its fastest. Speed is followed step by step over the real
 * surface (features included) and over each jump with the designed flight at the speed the
 * rider takes it, so one feature's run-out feeds the next one's run-in.
 */
export type LinesResult = { features: FeatureSpec[]; lines: LineSpec[]; prints: Footprint[] };

export type Kind = 'quarter' | 'sideHit' | 'kicker' | 'stepUp' | 'hip' | 'rail' | 'roller' | 'spine' | 'mini' | 'euroGap' | 'gapToRail' | 'jibTable' | 'knoll' | 'log' | 'miniPipe' | 'stepDown' | 'booter' | 'drop' | 'corner' | 'wedge' | 'funBox' | 'berm' | 'wallRide' | 'stepDownHip' | 'hipQuarter';
const SIZES: Size[] = ['S', 'M', 'L', 'XL'];
const HIP_DECK = 3; // m a hip's deck typically stands above the ground once solved: for the speed it takes to climb onto

export function placeLines(rng: Rng, field: FieldConfig, cfg: GenConfig, params: Params): LinesResult {
  const L = cfg.lines;
  const g = params.world.gravity;
  const features: FeatureSpec[] = [];
  const prints: { line: number; print: Footprint }[] = [];
  const lines: LineSpec[] = [];
  const c = createContact();

  // The ground, and the same with the features placed so far on it.
  const ground: Terrain = createSlope({ length: field.length, width: field.width, pitch: field.pitch, field });
  let world: Terrain = ground;
  const rebuild = (): void => {
    world = createSlope(toSlopeConfig({ version: 1, name: '', ground: { length: field.length, width: field.width, pitch: field.pitch, field }, spawn: { x: 0, z: 0, heading: 0 }, features, lines: [], links: [] }));
  };

  /** Speed after riding `ds` along the surface from height h0 to h1. */
  const ride = (v: number, h0: number, h1: number, cosSlope: number, ds: number): number => {
    const v2 = v * v + 2 * g * (h0 - h1) - 2 * (params.ground.friction * g * cosSlope + params.ground.drag * v * v) * ds;
    return Math.sqrt(Math.min(params.world.terminalSpeed ** 2, Math.max(0, v2)));
  };
  /** Ride straight from (x, z) along yaw for `dist` m on `t`; speed at the end. */
  const rideAlong = (t: Terrain, x: number, z: number, yaw: number, dist: number, v: number): number => {
    const sx = dm.sin(yaw);
    const sz = -dm.cos(yaw);
    let h = t.sample(x, z, c).height;
    for (let d = L.step; d <= dist + 1e-6; d += L.step) {
      const p = t.sample(x + sx * d, z + sz * d, c);
      v = ride(v, h, p.height, p.normal.y, L.step);
      h = p.height;
    }
    return v;
  };

  for (let li = 0; li < L.starts.length; li++) {
    let x = (L.starts[li] ?? 0) + (next(rng) * 2 - 1) * L.jitter;
    let z = -5;
    let v = cfg.speedMap.startSpeed;
    let s = 0;
    let nextAt = L.lead;
    let lastEnd = 0; // m down the line where the last feature's run-out ended
    let steps = 0;
    let hero = false;
    const line: LineSpec = { name: `line ${li + 1}`, features: [], speed: [], path: [[Number(x.toFixed(2)), -5, v]] };
    // Drift off the fall line: values every wanderLength m, eased between.
    const drift: number[] = [];
    for (let i = 0; i < cfg.zone.length / L.wanderLength + 3; i++) drift.push((next(rng) * 2 - 1) * L.wander * RAD);
    const driftAt = (d: number): number => {
      const u = d / L.wanderLength;
      const i = Math.floor(u);
      const f = u - i;
      const e = f * f * (3 - 2 * f);
      return (drift[i] ?? 0) * (1 - e) + (drift[i + 1] ?? 0) * e;
    };
    const fallYaw = (px: number, pz: number): number => {
      const n = ground.sample(px, pz, c).normal;
      return dm.atan2(n.x, -n.z);
    };
    const bottom = -(cfg.zone.length - L.endMargin);
    const edge = cfg.zone.width / 2 - cfg.bank.width - 10;

    while (z > bottom) {
      // Down the fall line plus the drift, but always making way down the hill (a side-hill
      // fall line would otherwise walk a line across the zone), and back in off the banks.
      let yaw = fallYaw(x, z) + driftAt(s);
      // Keep clear of the lines already traced: near one, turn away from it.
      for (const other of lines) {
        for (const [ox, oz] of other.path ?? []) {
          if (Math.abs(oz - z) < 8 && Math.abs(ox - x) < L.minGap) yaw += Math.sign(x - ox || 1) * L.repel * RAD;
        }
      }
      yaw = Math.max(-L.maxTurn * RAD, Math.min(L.maxTurn * RAD, yaw));
      if (Math.abs(x) > edge) yaw = -Math.sign(x) * 0.4;
      if (++steps > 4 * cfg.zone.length / L.step) break;
      const nx = x + dm.sin(yaw) * L.step;
      const nz = z - dm.cos(yaw) * L.step;
      const a = world.sample(x, z, c).height;
      const p = world.sample(nx, nz, c);
      v = ride(v, a, p.height, p.normal.y, L.step);
      x = nx;
      z = nz;
      s += L.step;
      if (Math.round(s / L.step) % 3 === 0) line.path?.push([Number(x.toFixed(2)), Number(z.toFixed(2)), Number(v.toFixed(2))]);
      if (v < 1) v = 1; // a rider pushes along the flats rather than stopping dead
      if (s < nextAt) continue;

      // A feature here. What kind: the hero once, past `hero` of the way down; otherwise by odds.
      const progress = -z / cfg.zone.length;
      let kind: Kind = pick(rng, L.mix);
      let heroNow = false;
      if (!hero && progress > L.hero) {
        kind = next(rng) < 0.6 ? 'kicker' : 'hip';
        heroNow = true;
      }
      if (kind === 'spine' && v < L.spineSpeed) kind = 'roller';

      // Size it to the speed the line can reach going straight: the biggest whose slowest
      // design speed that is. Arriving faster is the rider's to check (L2), so the run-in has
      // to be long enough to brake down to its top speed — moved on down the line if not.
      const want = wantedSpeed(kind, heroNow, v, rng, cfg, params);
      const climb = 2 * g * want.lipHeight + 2 * params.ground.friction * g * want.runIn;
      const atLip = Math.sqrt(Math.max(0, v * v - climb));
      if (atLip < want.speed[0] * L.speedMargin) {
        nextAt = s + L.step * 5; // not enough speed yet: try a little further down
        continue;
      }
      const brake = (atLip * atLip - want.speed[1] * want.speed[1]) / (2 * params.ground.brakeDecel);
      if (brake > s - lastEnd - L.brakeMargin) {
        nextAt = s + L.step * 5;
        continue;
      }
      const place: Place = { x, z, yaw };
      const parts = build(kind, want, place, rng, ground, cfg, params);
      const spec = parts[0];
      if (!spec) {
        nextAt = s + range(rng, L.spacing);
        continue;
      }
      // Clear of the other lines' features (its own follow on by construction).
      const partPrints = parts.map((p) => footprint(p, cfg.clear.runIn, cfg.clear.margin));
      if (partPrints.some((print) => prints.some((p) => p.line !== li && overlaps(p.print, print)))) {
        nextAt = s + L.step * 5;
        continue;
      }
      for (const print of partPrints) prints.push({ line: li, print });
      if (heroNow) {
        spec.meta = { ...(spec.meta ?? { type: kind }), hero: true };
        hero = true;
      }
      group(parts, features.length);
      features.push(...parts);
      rebuild();
      line.features.push(features.length - parts.length);

      // Over it: to the lip on the surface, then the air, then on from where it lands.
      const out = across(spec, place, v, want.speed[1], world, ground, params, rideAlong);
      line.speed.push(Number(out.lipSpeed.toFixed(2)));
      x = out.x;
      z = out.z;
      v = out.v;
      line.path?.push([Number(x.toFixed(2)), Number(z.toFixed(2)), Number(v.toFixed(2))]);
      s += out.dist;
      lastEnd = s;
      nextAt = s + range(rng, L.spacing);
    }
    // Finish the line in a quarter pipe, or a hip quarter, if there is room below.
    if (z > -cfg.zone.length + 25) {
      const quarterWant: Want = { size: 'S', speed: [0, 1e9], lipHeight: 0, runIn: 0 };
      const end = build(next(rng) < cfg.hipQuarter.end ? 'hipQuarter' : 'quarter', quarterWant, { x, z: z - 6, yaw: 0 }, rng, ground, cfg, params);
      const ends = end.map((q) => footprint(q, cfg.clear.runIn, cfg.clear.margin));
      if (!ends.some((print) => prints.some((p) => p.line !== li && overlaps(p.print, print)))) {
        for (const print of ends) prints.push({ line: li, print });
        group(end, features.length);
        features.push(...end);
        line.features.push(features.length - end.length);
        line.speed.push(Number(v.toFixed(2)));
      }
    }
    lines.push(line);
  }
  return { features, lines, prints: prints.map((p) => p.print) };
}

export function pick(rng: Rng, odds: Partial<Record<Kind, number>>): Kind {
  let total = 0;
  for (const k of Object.keys(odds) as Kind[]) total += odds[k] ?? 0;
  let r = next(rng) * total;
  for (const k of Object.keys(odds) as Kind[]) {
    r -= odds[k] ?? 0;
    if (r <= 0) return k;
  }
  return 'kicker';
}

/** Parts of one obstacle share an id: the index the first of them gets in the layout. */
export function group(parts: FeatureSpec[], id: number): void {
  if (parts.length < 2) return;
  for (const p of parts) p.meta = { ...(p.meta ?? { type: p.kind }), group: id };
}

export type Want = { size: Size; speed: [number, number]; lipHeight: number; runIn: number };

/** Size and design speed for a feature, from the speed the line carries — the biggest that fits. */
export function wantedSpeed(kind: Kind, hero: boolean, v: number, rng: Rng, cfg: GenConfig, params: Params): Want {
  const g = params.world.gravity;
  const k = cfg.kicker;
  const theta = k.lipAngle * RAD;
  const runIn = (h: number): number => (h / (1 - dm.cos(theta))) * dm.sin(theta);
  const lipSpeed = (h: number): number => Math.sqrt(Math.max(0, v * v - 2 * g * h - 2 * params.ground.friction * g * runIn(h)));
  if (kind === 'kicker' || kind === 'stepUp' || kind === 'euroGap' || kind === 'stepDown' || kind === 'corner') {
    const sizes = hero ? (['L', 'XL'] as Size[]) : kind === 'stepUp' ? (['M'] as Size[]) : kind === 'euroGap' ? (cfg.euroGap.sizes as Size[]) : kind === 'corner' ? (cfg.corner.sizes as Size[]) : SIZES;
    // The largest size the speed reaches; a bench takes care of too much. Some randomness so
    // not every jump is the biggest that fits.
    let size = sizes[0] ?? 'M';
    for (const s of sizes) if (lipSpeed(k.sizes[s].lip) >= (k.sizes[s].speed[0] ?? 0) * cfg.lines.speedMargin) size = s;
    if (!hero && next(rng) < 0.3) size = sizes[Math.max(0, sizes.indexOf(size) - 1)] ?? size;
    const preset = k.sizes[size];
    return { size, speed: [preset.speed[0] ?? 0, preset.speed[1] ?? 0], lipHeight: preset.lip, runIn: runIn(preset.lip) };
  }
  if (kind === 'hip' || kind === 'stepDownHip') {
    // The biggest whose slowest speed the line reaches at its lip, with a typical deck under it.
    const sizes = hero ? (['L', 'XL'] as Size[]) : SIZES;
    const climb = (z: Size): number => cfg.hip.sizes[z].lip + HIP_DECK;
    const hipRunIn = (z: Size): number => {
      const a = cfg.hip.sizes[z].lipAngle * RAD;
      return (climb(z) / (1 - dm.cos(a))) * dm.sin(a);
    };
    const at = (z: Size): number => Math.sqrt(Math.max(0, v * v - 2 * g * climb(z) - 2 * params.ground.friction * g * hipRunIn(z)));
    let size = sizes[0] ?? 'M';
    for (const z of sizes) if (at(z) >= (cfg.hip.sizes[z].speed[0] ?? 0) * cfg.lines.speedMargin) size = z;
    const P = cfg.hip.sizes[size];
    return { size, speed: [P.speed[0] ?? 0, P.speed[1] ?? 0], lipHeight: climb(size), runIn: hipRunIn(size) };
  }
  if (kind === 'rail') return { size: 'S', speed: cfg.lines.railSpeed as [number, number], lipHeight: 0, runIn: 0 };
  if (kind === 'jibTable') {
    const a = cfg.jibTable.lipAngle * RAD;
    return { size: 'S', speed: cfg.lines.railSpeed as [number, number], lipHeight: cfg.jibTable.lip, runIn: (cfg.jibTable.lip / (1 - dm.cos(a))) * dm.sin(a) };
  }
  if (kind === 'gapToRail') return { size: 'S', speed: cfg.gapToRail.speed as [number, number], lipHeight: cfg.gapToRail.height[1] ?? 1, runIn: 3 };
  if (kind === 'wedge' || kind === 'funBox') return { size: 'S', speed: [6, 12], lipHeight: cfg.wedge.height[1] ?? 3, runIn: 6 };
  if (kind === 'berm' || kind === 'wallRide') return { size: 'S', speed: [8, 16], lipHeight: 0, runIn: 0 };
  if (kind === 'booter') return { size: 'L', speed: cfg.booter.speed as [number, number], lipHeight: cfg.booter.height[1] ?? 4, runIn: 8 };
  if (kind === 'drop') return { size: 'S', speed: cfg.drop.speed as [number, number], lipHeight: cfg.drop.height[1] ?? 6, runIn: 0 };
  if (kind === 'mini') return { size: 'S', speed: cfg.mini.speed as [number, number], lipHeight: cfg.mini.height[1] ?? 0.7, runIn: 2 };
  return { size: 'S', speed: [0, 1e9], lipHeight: 0, runIn: 0 };
}

/**
 * The parts of one obstacle, the first the one a line rides over; none when it can't go here.
 * The first part carries what it was designed from (`meta.design`), so `redesign` can build it
 * again.
 */
export function build(kind: Kind, want: Want, place: Place, rng: Rng, ground: Terrain, cfg: GenConfig, params: Params): FeatureSpec[] {
  const d: Draw = { rng, inputs: {} };
  const parts = designed(kind, want, place, d, ground, cfg, params);
  const first = parts[0];
  if (first) first.meta = { ...(first.meta ?? { type: first.kind }), design: { kind, place: { ...place }, size: want.size, speed: [want.speed[0], want.speed[1]], inputs: d.inputs } };
  return parts;
}

/** A designed feature built again from its design: `ground` is the ground alone, as the generator had it. */
export function redesign(design: Design, ground: Terrain, cfg: GenConfig, params: Params): FeatureSpec[] {
  const want: Want = { size: design.size as Size, speed: design.speed, lipHeight: 0, runIn: 0 };
  const d: Draw = { inputs: { ...design.inputs } };
  const parts = designed(design.kind as Kind, want, design.place, d, ground, cfg, params);
  const first = parts[0];
  if (first) first.meta = { ...(first.meta ?? { type: first.kind }), design: { ...design, inputs: d.inputs } };
  return parts;
}

function designed(kind: Kind, want: Want, place: Place, d: Draw, ground: Terrain, cfg: GenConfig, params: Params): FeatureSpec[] {
  const c = createContact();
  // Grade under the landing: a little way down from the takeoff.
  const span = 18;
  const h0 = ground.sample(place.x + dm.sin(place.yaw) * 8, place.z - dm.cos(place.yaw) * 8, c).height;
  const h1 = ground.sample(place.x + dm.sin(place.yaw) * (8 + span), place.z - dm.cos(place.yaw) * (8 + span), c).height;
  const landingPitch = dm.atan(Math.max(0, (h0 - h1) / span));
  if (kind === 'quarter') return [designQuarter(place, d, cfg)];
  if (kind === 'kicker') {
    const f = designKicker(place, want.size, landingPitch, cfg, params, ground);
    // Solved over the ground as it is, so where that falls away below it, it is a step-down.
    if (f.meta) f.meta.type = dropAhead(ground, place, cfg.stepDown.probe) >= (cfg.stepDown.drop[0] ?? 0.5) ? 'stepDown' : 'kicker';
    return [f];
  }
  if (kind === 'stepUp') return [designStepUp(place, d, landingPitch, cfg, params)];
  if (kind === 'hip') {
    return [designHip(place, want.size, d, cfg, params, landingPitch, ground)];
  }
  if (kind === 'rail') return [designRail(place, d, cfg)];
  if (kind === 'mini') return designMini(place, d, cfg);
  if (kind === 'knoll') return designKnoll(place, d, cfg);
  if (kind === 'log') return designLog(place, d, cfg);
  if (kind === 'jibTable') return designJibTable(place, d, cfg);
  if (kind === 'euroGap') return designEuroGap(place, want.size, landingPitch, d, cfg, params);
  if (kind === 'gapToRail') return designGapToRail(place, landingPitch, d, cfg, params);
  if (kind === 'hipQuarter') return designHipQuarter(place, d, cfg);
  if (kind === 'wedge') return designWedge(place, d, cfg);
  if (kind === 'funBox') return designFunBox(place, d, cfg);
  if (kind === 'berm') return designBerm(place, d, cfg);
  if (kind === 'wallRide') return designWallRide(place, d, cfg);
  if (kind === 'stepDownHip') {
    return designStepDownHip(place, want.size, d, cfg, params, landingPitch, ground);
  }
  if (kind === 'stepDown') return designStepDown(place, want.size, landingPitch, ground, cfg, params);
  if (kind === 'booter') return designBooter(place, ground, d, cfg, params);
  if (kind === 'drop') return designDrop(place, ground, d, cfg, params);
  if (kind === 'corner') {
    // Turned across the slope, either way.
    const n = ground.sample(place.x, place.z, c).normal;
    const off = input(d, 'turn', cfg.corner.yaw);
    const yaw = dm.atan2(n.x, -n.z) + (chance(d, 'left', 0.5) ? -1 : 1) * off * RAD;
    return designCorner({ ...place, yaw }, want.size, ground, cfg, params);
  }
  if (kind === 'miniPipe') {
    // Down the fall line, give or take a little: a pipe across the hill would be a traverse.
    const n = ground.sample(place.x, place.z, c).normal;
    const yaw = dm.atan2(n.x, -n.z) + Math.max(-cfg.miniPipe.yaw, Math.min(cfg.miniPipe.yaw, ((place.yaw - dm.atan2(n.x, -n.z)) / RAD))) * RAD;
    return designMiniPipe({ ...place, yaw }, dm.atan(Math.sqrt(n.x * n.x + n.z * n.z) / n.y), d, cfg);
  }
  return [designShape(kind, place, d, cfg)];
}

/**
 * Riding over a placed feature: on the surface to its lip (checked down to its top speed), the
 * designed air from there (medium pop) to touchdown, keeping the speed along the landing as the sim does. For a rail, along it.
 * Returns where the line carries on from and at what speed.
 */
function across(
  spec: FeatureSpec,
  place: Place,
  v: number,
  top: number, // m/s the rider checks down to before the lip
  world: Terrain,
  ground: Terrain,
  params: Params,
  rideAlong: (t: Terrain, x: number, z: number, yaw: number, dist: number, v: number) => number,
): { x: number; z: number; v: number; dist: number; lipSpeed: number } {
  const c = createContact();
  const sx = dm.sin(place.yaw);
  const sz = -dm.cos(place.yaw);
  if (spec.kind === 'rail') {
    const pts = spec.cfg.points;
    const end = pts[pts.length - 1] ?? [place.x, 0, place.z];
    const len = Math.sqrt((end[0] - place.x) ** 2 + (end[2] - place.z) ** 2);
    const on = Math.min(top, v);
    const vOut = Math.sqrt(Math.max(1, on * on - 2 * params.rail.friction * len));
    return { x: end[0] + sx * 3, z: end[2] + sz * 3, v: vOut, dist: len + 3, lipSpeed: on };
  }
  if (spec.kind === 'quarter' && spec.meta?.type === 'miniPipe') {
    // Down the flat bottom, from its top end to its bottom end.
    const len = spec.cfg.width;
    const vOut = rideAlong(world, place.x, place.z, place.yaw, len, v);
    return { x: place.x + sx * len, z: place.z + sz * len, v: vOut, dist: len, lipSpeed: v };
  }
  const lip = spec.meta?.lip;
  if ((spec.kind === 'kicker' || spec.kind === 'corner') && lip !== undefined) {
    const lipSpeed = Math.min(top, rideAlong(world, place.x, place.z, place.yaw, lip - 0.1, v));
    const lx = place.x + sx * (lip - 0.02);
    const lz = place.z + sz * (lip - 0.02);
    const [popMin, popMax] = popRange(params);
    const l = launch(world, lx, lz, sx, sz, lipSpeed, (popMin + popMax) / 2);
    const f = fly(world, params, lx, l.y, lz, l.vx, l.vy, l.vz, 6, false);
    const speed2 = l.vx * l.vx + l.vy * l.vy + l.vz * l.vz + 2 * params.world.gravity * (l.y - f.y);
    let vOut = Math.sqrt(Math.max(1, speed2 - f.impact * f.impact));
    // Ride out to where the feature ends (back on the ground under it).
    let x = f.x;
    let z = f.z;
    let dist = lip + Math.sqrt((f.x - lx) ** 2 + (f.z - lz) ** 2);
    for (let i = 0; i < 60; i++) {
      if (world.sample(x, z, c).height - ground.sample(x, z, c).height < 0.05) break;
      vOut = rideAlong(world, x, z, place.yaw, 2, vOut);
      x += sx * 2;
      z += sz * 2;
      dist += 2;
    }
    return { x, z, v: vOut, dist, lipSpeed };
  }
  // Rollers, spines, side hits: ride over on the surface until back on the ground.
  let x = place.x;
  let z = place.z;
  let dist = 0;
  let started = false;
  for (let i = 0; i < 60; i++) {
    const on = world.sample(x, z, c).height - ground.sample(x, z, c).height > 0.05;
    if (on) started = true;
    if (started && !on) break;
    v = rideAlong(world, x, z, place.yaw, 2, v);
    x += sx * 2;
    z += sz * 2;
    dist += 2;
  }
  return { x, z, v, dist, lipSpeed: v };
}
