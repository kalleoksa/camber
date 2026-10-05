import * as dm from '../sim/dmath.ts';
import { params as defaultParams, type Params } from '../sim/params.ts';
import { createRng } from '../sim/rng.ts';
import { createContact, createSlope, type Terrain } from '../sim/terrain.ts';
import { toSlopeConfig, type FeatureSpec, type Layout, type LineSpec } from '../park/layout.ts';
import { GEN, type GenConfig } from './config.ts';
import { placeFill } from './fill.ts';
import { footprint, type Footprint } from './footprint.ts';
import { buildGraph, chains } from './graph.ts';
import { generateGround } from './ground.ts';
import type { Place } from './kit.ts';
import { placeLines } from './lines.ts';
import { computeSpeedMap } from './speedmap.ts';

/**
 * Seed in, layout out: the ground, spine lines with their features, the fill between them,
 * then the connection graph — features nothing leads into are dropped, and a try with fewer
 * than `graph.minChains` chains of `graph.chainLinks`+ links re-rolls (the best of the tries
 * is kept). The same seed, config and params give the same layout, byte for byte. Params
 * matter because features are sized from the sim's physics.
 */
export function generateLayout(seed: number, cfg: GenConfig = GEN, params: Params = defaultParams): Layout {
  let best: Layout | undefined;
  let bestChains = -1;
  for (let roll = 0; roll <= cfg.graph.rolls; roll++) {
    const layout = attempt(seed, roll, cfg, params);
    const n = longChains(layout, cfg);
    if (n > bestChains) {
      best = layout;
      bestChains = n;
    }
    if (n >= cfg.graph.minChains) break;
  }
  return best as Layout;
}

/** Chains of `chainLinks` links or more through a layout's graph. */
export function longChains(layout: Layout, cfg: GenConfig = GEN): number {
  const z = (i: number): number => originZ(layout.features[i]);
  return chains(layout.features.length, layout.links, z).filter((c) => c.length > cfg.graph.chainLinks).length;
}

function attempt(seed: number, roll: number, cfg: GenConfig, params: Params): Layout {
  const rng = createRng(seed + roll * 7919);
  const field = generateGround(rng, cfg);
  const placed = placeLines(rng, field, cfg, params);
  let features = placed.features;
  let lines = placed.lines;
  let prints = placed.prints;
  features.push(...placeFill(rng, field, cfg, params, features, lines, prints));

  const ground = createSlope({ length: field.length, width: field.width, pitch: field.pitch, field });
  const map = computeSpeedMap(ground, params, { width: field.width, length: field.length, ...cfg.speedMap });
  const shell = (f: FeatureSpec[]): Layout => ({
    version: 1,
    name: 'generated',
    seed,
    roll,
    ground: { length: cfg.zone.length, width: cfg.zone.width, pitch: field.pitch, field },
    // At the top of the middle line, facing down it.
    spawn: { x: lines[Math.floor(lines.length / 2)]?.path?.[0]?.[0] ?? 0, z: -5, heading: Math.PI },
    features: f,
    lines,
    links: [],
  });
  const graphOf = (f: FeatureSpec[], p: Footprint[]) => buildGraph(f, p, createSlope(toSlopeConfig(shell(f))), map, cfg, params);

  // Drop what nothing leads into: no link in, not near the top, not the start of a line.
  let links = graphOf(features, prints);
  const firsts = new Set(lines.map((l) => l.features[0]));
  const entered = new Set(links.map((l) => l.to));
  const keep = features.map((f, i) => entered.has(i) || firsts.has(i) || originZ(f) > -cfg.graph.top);
  if (keep.some((k) => !k)) {
    const remap = new Map<number, number>();
    features.forEach((_, i) => {
      if (keep[i]) remap.set(i, remap.size);
    });
    features = features.filter((_, i) => keep[i]);
    prints = prints.filter((_, i) => keep[i]);
    lines = lines.map((l): LineSpec => {
      const kept = l.features.map((fi, j) => [remap.get(fi), l.speed[j]] as const).filter(([fi]) => fi !== undefined);
      return { ...l, features: kept.map(([fi]) => fi as number), speed: kept.map(([, v]) => v ?? 0) };
    });
    links = graphOf(features, prints);
  }
  return { ...shell(features), lines, links };
}

function originZ(f: FeatureSpec | undefined): number {
  if (!f) return 0;
  if (f.kind === 'rail') return f.cfg.points[0]?.[2] ?? 0;
  return (f.cfg as { z: number }).z;
}

/** Footprints for a layout's features (for overlays and checks). */
export function footprints(layout: Layout, cfg: GenConfig = GEN): Footprint[] {
  return layout.features.map((f) => footprint(f, cfg.clear.runIn, cfg.clear.margin));
}

/** Grade of the ground along a feature's axis at (x, z), rad, downhill positive. */
export function pitchAlong(ground: Terrain, p: Place): number {
  const c = createContact();
  const d = 6;
  const h0 = ground.sample(p.x, p.z, c).height;
  const h1 = ground.sample(p.x + dm.sin(p.yaw) * d, p.z - dm.cos(p.yaw) * d, c).height;
  return dm.atan((h0 - h1) / d);
}
