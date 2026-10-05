import * as dm from '../sim/dmath.ts';
import type { FieldConfig } from '../sim/heightfield.ts';
import type { Params } from '../sim/params.ts';
import { next, type Rng } from '../sim/rng.ts';
import { createContact, createSlope } from '../sim/terrain.ts';
import type { FeatureSpec, LineSpec } from '../park/layout.ts';
import type { GenConfig } from './config.ts';
import { covers, footprint, overlaps, type Footprint } from './footprint.ts';
import { RAD, range } from './ground.ts';
import type { Place } from './kit.ts';
import { build, group, pick, wantedSpeed } from './lines.ts';
import { computeSpeedMap, speedAt } from './speedmap.ts';

/**
 * Fill: extra features thrown at random spots between and around the lines (dart throwing —
 * a spot is kept only if it is far enough from every feature there already, so they spread
 * evenly), each turned up to `fill.yaw` off the fall line so not everything faces downhill,
 * sized to the speed a rider could carry there going straight. A spot is dropped if the
 * feature would overlap another's footprint (its own ground and clear run-in) or sit on a
 * line's path. Near the zone's edges some become side hits.
 */
export function placeFill(
  rng: Rng,
  field: FieldConfig,
  cfg: GenConfig,
  params: Params,
  features: FeatureSpec[],
  lines: LineSpec[],
  prints: Footprint[],
): FeatureSpec[] {
  const F = cfg.fill;
  const ground = createSlope({ length: field.length, width: field.width, pitch: field.pitch, field });
  const map = computeSpeedMap(ground, params, { width: field.width, length: field.length, ...cfg.speedMap });
  const c = createContact();
  const g = params.world.gravity;
  const origins: [number, number][] = features.map((f) => origin(f));
  const path: [number, number][] = [];
  for (const l of lines) for (const p of l.path ?? []) path.push([p[0], p[1]]);
  const added: FeatureSpec[] = [];
  const half = field.width / 2 - cfg.bank.width - 8;

  // Natural zones first: a booter, else a cliff drop, else a kicker solved over the falling
  // ground (a step-down), at a few spots across each zone's top edge, facing down its axis.
  const N = cfg.natural;
  for (const p of field.patches) {
    if (!p.natural) continue;
    const ax = dm.sin(p.yaw);
    const az = -dm.cos(p.yaw);
    for (let k = 0; k < N.tries; k++) {
      const across = (k - (N.tries - 1) / 2) * p.halfWidth * 0.6;
      for (const kind of ['booter', 'drop', 'kicker'] as const) {
        const back = range(rng, N.lead) + (kind === 'drop' ? N.shelf : 0);
        const x = p.x + across * dm.cos(p.yaw) - ax * back;
        const z = p.z + across * dm.sin(p.yaw) - az * back;
        if (Math.abs(x) > half) continue;
        const v = speedAt(map, x, z) / cfg.lines.speedMargin;
        const want = wantedSpeed(kind, false, v, rng, cfg, params);
        const atLip = Math.sqrt(Math.max(0, v * v - 2 * g * want.lipHeight - 2 * params.ground.friction * g * want.runIn));
        if (atLip < want.speed[0]) continue;
        const parts = build(kind, want, { x, z, yaw: p.yaw }, rng, ground, cfg, params);
        const spec = parts[0];
        if (!spec) continue;
        const partPrints = parts.map((q) => footprint(q, cfg.clear.runIn, cfg.clear.margin));
        if (partPrints.some((print) => prints.some((q) => overlaps(q, print)))) continue;
        if (partPrints.some((print) => path.some(([px, pz]) => covers(print, px, pz, cfg.clear.path)))) continue;
        for (const q of parts) q.meta = { ...(q.meta ?? { type: q.kind }), fill: true };
        group(parts, features.length + added.length);
        added.push(...parts);
        prints.push(...partPrints);
        origins.push(origin(spec));
        break;
      }
    }
  }

  for (let attempt = 0; attempt < F.attempts && added.length < F.count; attempt++) {
    const x = range(rng, [-half, half]);
    const z = range(rng, [-40, -(field.length - 60)]);
    // Cheap rejections first: spacing from other features, and off the lines' paths.
    if (origins.some(([ox, oz]) => (ox - x) ** 2 + (oz - z) ** 2 < F.spacing * F.spacing)) continue;
    if (path.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < (cfg.clear.path + 6) ** 2)) continue;

    const n = ground.sample(x, z, c).normal;
    const fall = dm.atan2(n.x, -n.z);
    let parts: FeatureSpec[] = [];
    const nearEdge = Math.abs(x) > half - 30;
    if (nearEdge && next(rng) < F.sideHit) {
      // A side hit along the run's edge, kicking back in toward the middle.
      const yaw = fall - Math.sign(x) * range(rng, [0.3, 0.8]);
      parts = build('sideHit', { size: 'S', speed: [0, 1e9], lipHeight: 0, runIn: 0 }, { x, z, yaw }, rng, ground, cfg, params);
    } else {
      const yaw = fall + (next(rng) * 2 - 1) * F.yaw * RAD;
      const place: Place = { x, z, yaw };
      // A rider gets here going straight at most this fast; some is lost lining up.
      const v = speedAt(map, x, z) / cfg.lines.speedMargin;
      let kind = pick(rng, F.mix);
      if (kind === 'spine' && v < cfg.lines.spineSpeed) kind = 'roller';
      const want = wantedSpeed(kind, false, v, rng, cfg, params);
      const atLip = Math.sqrt(Math.max(0, v * v - 2 * g * want.lipHeight - 2 * params.ground.friction * g * want.runIn));
      if (atLip < want.speed[0]) continue;
      parts = build(kind, want, place, rng, ground, cfg, params);
    }
    const spec = parts[0];
    if (!spec) continue;
    const partPrints = parts.map((p) => footprint(p, cfg.clear.runIn, cfg.clear.margin));
    if (partPrints.some((print) => prints.some((p) => overlaps(p, print)))) continue;
    if (partPrints.some((print) => path.some(([px, pz]) => covers(print, px, pz, cfg.clear.path)))) continue;
    for (const p of parts) p.meta = { ...(p.meta ?? { type: p.kind }), fill: true };
    group(parts, features.length + added.length);
    added.push(...parts);
    prints.push(...partPrints);
    origins.push(origin(spec));
  }
  return added;
}

function origin(f: FeatureSpec): [number, number] {
  if (f.kind === 'rail') {
    const p = f.cfg.points[0];
    return [p?.[0] ?? 0, p?.[2] ?? 0];
  }
  const cfg = f.cfg as { x: number; z: number };
  return [cfg.x, cfg.z];
}
