import type { RailConfig } from '../sim/rails.ts';
import type { ShapeConfig } from '../sim/features.ts';
import type { FieldConfig } from '../sim/heightfield.ts';
import type { HipConfig, GradeConfig, KickerConfig, QuarterConfig, SlopeConfig, WallConfig } from '../sim/terrain.ts';

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
  roll?: number; // generated: which re-roll of the seed this is (0 = the first try passed)
  ground: Ground;
  spawn: { x: number; z: number; heading: number }; // heading in rad, π = nose down the fall line
  features: FeatureSpec[];
  lines: LineSpec[];
  links: LinkSpec[];
};

/** The base slope: a plane at `pitch` reshaped by grades down the hill, or a generated field. */
export type Ground = { length: number; width: number; pitch: number; grades?: GradeConfig[]; field?: FieldConfig };

export type FeatureMeta = {
  type: string;
  size?: string;
  speed?: [number, number]; // m/s at the lip it was designed for
  hero?: boolean;
  fill?: boolean; // placed by the fill, not on a line
  lip?: number; // m along its axis from (x, z) to where it takes off
  checks?: { speed: number; pop: number; grade: string; impact: number; past: number }[]; // designed airs
  group?: number; // parts of one obstacle (a table and its rail) share this id and move as one
  design?: Design; // on the first part: what the kit was asked for, so the editor can change it and re-solve
};

/**
 * A feature as the generator's kit designed it: which obstacle, where and which way, its size
 * and design speeds, and its random inputs by name (kit.ts `Inputs`). `redesign` in
 * src/gen/lines.ts builds it again from these — the same parts, or new ones with an input
 * changed.
 */
export type Design = { kind: string; place: { x: number; z: number; yaw: number }; size: string; speed: [number, number]; inputs: Record<string, number> };

export type FeatureSpec =
  | { kind: 'kicker'; cfg: KickerConfig; meta?: FeatureMeta }
  | { kind: 'corner'; cfg: HipConfig; meta?: FeatureMeta }
  | { kind: 'quarter'; cfg: QuarterConfig; meta?: FeatureMeta }
  | { kind: 'wall'; cfg: WallConfig; meta?: FeatureMeta }
  | { kind: 'rail'; cfg: RailConfig; meta?: FeatureMeta }
  | { kind: 'shape'; cfg: ShapeConfig; meta?: FeatureMeta };

/**
 * A line: feature indices in riding order, the speed each is taken at (m/s, at the lip or onto
 * the rail), and the path it was traced along ([x, z, speed] every few metres) with the speed
 * the generator expects a rider to carry there.
 */
export type LineSpec = { name: string; features: number[]; speed: number[]; path?: [number, number, number][] }; // path: x, z, predicted m/s

/**
 * From one feature's takeoff a clean landing leads on to another: riding on to its lip
 * ('ride'), or landing on its own landing ('transfer'). `speed`: m/s off the first that do it.
 */
export type LinkSpec = { from: number; to: number; speed: [number, number]; kind?: 'ride' | 'transfer' };

export function toSlopeConfig(layout: Layout): SlopeConfig {
  const g = layout.ground;
  const cfg: SlopeConfig = { length: g.length, width: g.width, pitch: g.pitch };
  if (g.grades) cfg.grades = g.grades;
  if (g.field) cfg.field = g.field;
  const kickers: KickerConfig[] = [];
  const corners: HipConfig[] = [];
  const quarters: QuarterConfig[] = [];
  const walls: WallConfig[] = [];
  const rails: RailConfig[] = [];
  const shapes: ShapeConfig[] = [];
  for (const f of layout.features) {
    if (f.kind === 'kicker') kickers.push(f.cfg);
    else if (f.kind === 'corner') corners.push(f.cfg);
    else if (f.kind === 'quarter') quarters.push(f.cfg);
    else if (f.kind === 'wall') walls.push(f.cfg);
    else if (f.kind === 'shape') shapes.push(f.cfg);
    else rails.push(f.cfg);
  }
  if (kickers.length) cfg.kickers = kickers;
  if (corners.length) cfg.corners = corners;
  if (quarters.length) cfg.quarters = quarters;
  if (walls.length) cfg.walls = walls;
  if (rails.length) cfg.rails = rails;
  if (shapes.length) cfg.shapes = shapes;
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
