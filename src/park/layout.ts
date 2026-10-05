import type { RailConfig } from '../sim/rails.ts';
import type { CornerConfig, GradeConfig, KickerConfig, QuarterConfig, SlopeConfig, WallConfig } from '../sim/terrain.ts';

/**
 * A park as data: the ground it sits on, the features placed on it, and (for generated
 * parks) the lines and connection graph found in it. Hand-built and generated parks share
 * this format. Every feature carries the low-level config the terrain builds from, so a
 * layout always loads to the same height function; `meta` keeps what a generator or a
 * hand placement was asked for (type, design speeds), for overlays and re-generation.
 */
export type Layout = {
  version: 1;
  name: string;
  seed?: number;
  ground: Ground;
  spawn: { x: number; z: number; heading: number }; // heading in rad, π = nose down the fall line
  features: FeatureSpec[];
  lines: LineSpec[];
  links: LinkSpec[];
};

/** The base slope: a plane at `pitch` reshaped by grades down the hill. */
export type Ground = { length: number; width: number; pitch: number; grades?: GradeConfig[] };

export type FeatureMeta = { type: string; speed?: [number, number]; hero?: boolean };

export type FeatureSpec =
  | { kind: 'kicker'; cfg: KickerConfig; meta?: FeatureMeta }
  | { kind: 'corner'; cfg: CornerConfig; meta?: FeatureMeta }
  | { kind: 'quarter'; cfg: QuarterConfig; meta?: FeatureMeta }
  | { kind: 'wall'; cfg: WallConfig; meta?: FeatureMeta }
  | { kind: 'rail'; cfg: RailConfig; meta?: FeatureMeta };

/** A line: feature indices in riding order, with the speed each is designed to be hit at. */
export type LineSpec = { name: string; features: number[]; speed: number[] };

/** A takeoff on one feature reaches a clean landing on another. */
export type LinkSpec = { from: number; to: number; speed: [number, number] };

export function toSlopeConfig(layout: Layout): SlopeConfig {
  const g = layout.ground;
  const cfg: SlopeConfig = { length: g.length, width: g.width, pitch: g.pitch };
  if (g.grades) cfg.grades = g.grades;
  const kickers: KickerConfig[] = [];
  const corners: CornerConfig[] = [];
  const quarters: QuarterConfig[] = [];
  const walls: WallConfig[] = [];
  const rails: RailConfig[] = [];
  for (const f of layout.features) {
    if (f.kind === 'kicker') kickers.push(f.cfg);
    else if (f.kind === 'corner') corners.push(f.cfg);
    else if (f.kind === 'quarter') quarters.push(f.cfg);
    else if (f.kind === 'wall') walls.push(f.cfg);
    else rails.push(f.cfg);
  }
  if (kickers.length) cfg.kickers = kickers;
  if (corners.length) cfg.corners = corners;
  if (quarters.length) cfg.quarters = quarters;
  if (walls.length) cfg.walls = walls;
  if (rails.length) cfg.rails = rails;
  return cfg;
}

/** Wraps a hand-placed SlopeConfig as a layout, feature order kept so the terrain is identical. */
export function layoutFromSlope(name: string, cfg: SlopeConfig, spawn: Layout['spawn']): Layout {
  const features: FeatureSpec[] = [];
  for (const k of cfg.kickers ?? (cfg.kicker ? [cfg.kicker] : [])) features.push({ kind: 'kicker', cfg: k });
  for (const c of cfg.corners ?? []) features.push({ kind: 'corner', cfg: c });
  for (const q of cfg.quarters ?? []) features.push({ kind: 'quarter', cfg: q });
  for (const w of cfg.walls ?? []) features.push({ kind: 'wall', cfg: w });
  for (const r of cfg.rails ?? []) features.push({ kind: 'rail', cfg: r });
  const ground: Ground = { length: cfg.length, width: cfg.width, pitch: cfg.pitch };
  if (cfg.grades) ground.grades = cfg.grades;
  return { version: 1, name, ground, spawn, features, lines: [], links: [] };
}
