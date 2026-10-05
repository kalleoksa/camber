import { GEN } from '../gen/config.ts';
import { corners, footprint, type Footprint } from '../gen/footprint.ts';
import { redesign, wantedSpeed, type Kind } from '../gen/lines.ts';
import type { Size } from '../gen/kit.ts';
import { toSlopeConfig, type Design, type FeatureSpec, type Layout } from '../park/layout.ts';
import type { Field, PatchConfig } from '../sim/heightfield.ts';
import type { Params } from '../sim/params.ts';
import { createRng } from '../sim/rng.ts';
import { createContact, createSlope, type Terrain } from '../sim/terrain.ts';
import type { Rect } from '../render/terrainMesh.ts';

/**
 * The park editor's operations on a layout: pure data in, data out, nothing drawn. Edits change
 * `layout.features` in place; the editor snapshots the layout for undo.
 */

export type Place = { x: number; z: number; yaw: number };

/** Every part of the obstacle feature `i` belongs to (`meta.group`), `i` first. */
export function groupOf(layout: Layout, i: number): number[] {
  const id = layout.features[i]?.meta?.group;
  if (id === undefined) return [i];
  const rest = layout.features.flatMap((f, j) => (j !== i && f.meta?.group === id ? [j] : []));
  return [i, ...rest];
}

/** The part that carries the obstacle's design, if it was designed. */
export function designOf(layout: Layout, parts: readonly number[]): { index: number; design: Design } | undefined {
  for (const i of parts) {
    const design = layout.features[i]?.meta?.design;
    if (design) return { index: i, design };
  }
  return undefined;
}

/** Where a feature stands and which way it faces. A rail: its first point, along it. */
export function originOf(f: FeatureSpec): Place {
  if (f.kind === 'rail') {
    const a = f.cfg.points[0] ?? [0, 0, 0];
    const b = f.cfg.points[f.cfg.points.length - 1] ?? a;
    return { x: a[0], z: a[2], yaw: Math.atan2(b[0] - a[0], -(b[2] - a[2])) };
  }
  const c = f.cfg as { x: number; z: number; yaw?: number };
  return { x: c.x, z: c.z, yaw: c.yaw ?? 0 };
}

/** Turn (x, z) about (px, pz) by `yaw`, the way a feature's yaw turns (toward +X as it grows). */
function turn(x: number, z: number, px: number, pz: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dx = x - px;
  const dz = z - pz;
  return [px + dx * c - dz * s, pz + dx * s + dz * c];
}

/** A copy of `f` turned by `dyaw` about (px, pz), then moved by (dx, dz); its design's place with it. */
export function moved(f: FeatureSpec, px: number, pz: number, dx: number, dz: number, dyaw: number): FeatureSpec {
  const g = structuredClone(f);
  const design = g.meta?.design;
  if (design) {
    const [tx, tz] = turn(design.place.x, design.place.z, px, pz, dyaw);
    design.place = { x: tx + dx, z: tz + dz, yaw: design.place.yaw + dyaw };
  }
  if (g.kind === 'rail') {
    g.cfg.points = g.cfg.points.map(([x, y, z]) => {
      const [tx, tz] = turn(x, z, px, pz, dyaw);
      return [tx + dx, y, tz + dz];
    });
    return g;
  }
  const c = g.cfg as { x: number; z: number; yaw?: number };
  const [tx, tz] = turn(c.x, c.z, px, pz, dyaw);
  c.x = tx + dx;
  c.z = tz + dz;
  if (dyaw !== 0 || c.yaw !== undefined) c.yaw = (c.yaw ?? 0) + dyaw;
  return g;
}

/** A copy of `f` mirrored across the fall line through x = px: left becomes right. */
export function mirrored(f: FeatureSpec, px: number): FeatureSpec {
  const g = structuredClone(f);
  if (g.kind === 'rail') {
    g.cfg.points = g.cfg.points.map(([x, y, z]) => [2 * px - x, y, z]);
    return g;
  }
  const c = g.cfg as { x: number; yaw?: number; side?: number; hip?: { side: number } };
  c.x = 2 * px - c.x;
  if (c.yaw !== undefined) c.yaw = -c.yaw;
  if (c.side !== undefined) c.side = -c.side;
  if (c.hip) c.hip.side = -c.hip.side;
  return g;
}

/** The ground alone, as the kit designs over it. `baked`: the layout's baked field, to skip the bake. */
export function groundOf(layout: Layout, baked?: Field): Terrain {
  return createSlope(toSlopeConfig({ ...layout, features: [] }), baked);
}

/** Design speeds (m/s at the lip) for a kit obstacle at a size, as the generator would give it. */
export function designSpeed(kind: Kind, size: Size, params: Params): [number, number] {
  const preset = kind === 'hip' || kind === 'stepDownHip' ? GEN.hip.sizes[size] : GEN.kicker.sizes[size];
  if (['kicker', 'stepUp', 'euroGap', 'stepDown', 'corner', 'hip', 'stepDownHip'].includes(kind)) return [preset.speed[0] ?? 0, preset.speed[1] ?? 0];
  // Every other kind's speed doesn't depend on the line, so any rng and speed will do.
  return wantedSpeed(kind, false, 0, createRng(1), GEN, params).speed;
}

/** The sizes a kit obstacle comes in. */
export function sizesOf(kind: Kind): Size[] {
  if (kind === 'kicker' || kind === 'stepDown' || kind === 'hip' || kind === 'stepDownHip') return ['S', 'M', 'L', 'XL'];
  if (kind === 'euroGap') return GEN.euroGap.sizes as Size[];
  if (kind === 'corner') return GEN.corner.sizes as Size[];
  if (kind === 'stepUp') return ['M'];
  if (kind === 'booter') return ['L'];
  return ['S'];
}

/** A kit obstacle designed at `place`, its parts grouped as `group`; none when it can't go there. */
export function design(design: Design, ground: Terrain, params: Params, group: number, ranges?: Record<string, readonly number[]>): FeatureSpec[] {
  const parts = redesign(design, ground, GEN, params, ranges);
  if (parts.length > 1) for (const p of parts) p.meta = { ...(p.meta ?? { type: p.kind }), group };
  return parts;
}

/** A group id no feature uses yet. */
export function freeGroup(layout: Layout): number {
  let id = 0;
  for (const f of layout.features) if (f.meta?.group !== undefined && f.meta.group >= id) id = f.meta.group + 1;
  return id;
}

/**
 * Remove features, keeping lines and links pointing at the right ones: a line loses the removed
 * features (and their speeds), a link touching one goes.
 */
export function removeFeatures(layout: Layout, remove: readonly number[]): void {
  const gone = new Set(remove);
  const index: number[] = [];
  let n = 0;
  for (let i = 0; i < layout.features.length; i++) index.push(gone.has(i) ? -1 : n++);
  layout.features = layout.features.filter((_, i) => !gone.has(i));
  for (const line of layout.lines) {
    const keep = line.features.map((f, k) => [index[f] ?? -1, line.speed[k] ?? 0] as const).filter(([f]) => f >= 0);
    line.features = keep.map(([f]) => f);
    line.speed = keep.map(([, v]) => v);
  }
  layout.lines = layout.lines.filter((l) => l.features.length > 0);
  layout.links = layout.links
    .map((l) => ({ ...l, from: index[l.from] ?? -1, to: index[l.to] ?? -1 }))
    .filter((l) => l.from >= 0 && l.to >= 0);
}

/**
 * Put `parts` where `old` were: one for one in place (lines keep pointing at them), extra old
 * parts removed, extra new ones added at the end.
 */
export function replaceParts(layout: Layout, old: readonly number[], parts: readonly FeatureSpec[]): number[] {
  const at: number[] = [];
  old.forEach((i, k) => {
    const p = parts[k];
    if (p) {
      layout.features[i] = p;
      at.push(i);
    }
  });
  const extra = parts.slice(old.length);
  if (old.length > parts.length) {
    const drop = old.slice(parts.length);
    removeFeatures(layout, drop);
    // Indices past a removed one moved down.
    for (let k = 0; k < at.length; k++) at[k] = (at[k] ?? 0) - drop.filter((d) => d < (at[k] ?? 0)).length;
  }
  for (const p of extra) at.push(layout.features.push(p) - 1);
  return at;
}

/** The world box a footprint covers. */
export function rectOf(p: Footprint): Rect {
  const cs = corners(p);
  return {
    x0: Math.min(...cs.map((c) => c[0])),
    x1: Math.max(...cs.map((c) => c[0])),
    z0: Math.min(...cs.map((c) => c[1])),
    z1: Math.max(...cs.map((c) => c[1])),
  };
}

/** Footprints by shape (the config at the origin, unturned), so moving or turning one is free. */
const shapes = new Map<string, Footprint>();

/** Where a feature stands in plan: what it raises, plus half a metre. */
export function printOf(f: FeatureSpec): Footprint {
  if (f.kind === 'rail') return footprint(f, 0, 0.5);
  const o = originOf(f);
  const key = f.kind + JSON.stringify({ ...f.cfg, x: 0, z: 0, yaw: 0 });
  let p = shapes.get(key);
  if (!p) {
    p = footprint({ ...f, cfg: { ...f.cfg, x: 0, z: 0, yaw: 0 } } as FeatureSpec, 0, 0.5);
    shapes.set(key, p);
  }
  return { ...p, x: o.x, z: o.z, yaw: o.yaw };
}

/** Is (x, z) inside the footprint? */
export function inside(p: Footprint, x: number, z: number): boolean {
  const s = (x - p.x) * Math.sin(p.yaw) - (z - p.z) * Math.cos(p.yaw);
  const w = (x - p.x) * Math.cos(p.yaw) + (z - p.z) * Math.sin(p.yaw);
  return s >= p.s0 && s <= p.s1 && w >= p.w0 && w <= p.w1;
}

/** The feature under (x, z): the smallest footprint holding it. */
export function featureAt(layout: Layout, x: number, z: number): number | undefined {
  let best: number | undefined;
  let area = Infinity;
  layout.features.forEach((f, i) => {
    const p = printOf(f);
    const a = (p.s1 - p.s0) * (p.w1 - p.w0);
    if (a < area && inside(p, x, z)) {
      best = i;
      area = a;
    }
  });
  return best;
}

/**
 * Where to start a run at feature `f`: `runIn` m uphill of its lip on its axis, facing it, at the
 * middle of its design speeds.
 */
export function rideSpawn(f: FeatureSpec, terrain: Terrain, runIn: number): { position: { x: number; y: number; z: number }; heading: number; speed: number } {
  const o = originOf(f);
  const back = (f.meta?.lip ?? 0) - runIn;
  const x = o.x + Math.sin(o.yaw) * back;
  const z = o.z - Math.cos(o.yaw) * back;
  const speeds = f.meta?.design?.speed ?? f.meta?.speed;
  const mid = speeds ? (speeds[0] + speeds[1]) / 2 : 8;
  return {
    position: { x, y: terrain.sample(x, z, createContact()).height + 0.3, z },
    heading: Math.PI - o.yaw,
    speed: mid > 0 && mid < 40 ? mid : 8,
  };
}

/** Height a patch leaves over the base grade at its end: anything but 0 is a step across the slope. */
export function patchStep(p: PatchConfig, basePitch: number): number {
  const base = Math.tan(basePitch);
  let h = 0;
  for (const [len, pitch] of p.segs) h += (base - Math.tan(pitch)) * len;
  return h;
}

/** Where (x, z) is in a patch's frame (heightfield.ts): `along` its axis from its start, `across` it. */
export function patchFrame(p: PatchConfig, x: number, z: number): { along: number; across: number } {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return { along: (p.z - z) * c + (x - p.x) * s, across: (x - p.x) * c - (p.z - z) * s };
}

/** The patch under (x, z): the smallest holding it at full height. Natural zones aren't shapes, so not those. */
export function patchAt(patches: readonly PatchConfig[], x: number, z: number): number | undefined {
  let best: number | undefined;
  let area = Infinity;
  patches.forEach((p, i) => {
    if (p.natural) return;
    let total = 0;
    for (const [len] of p.segs) total += len;
    const { along, across } = patchFrame(p, x, z);
    const a = total * p.halfWidth;
    if (along >= 0 && along <= total && Math.abs(across) <= p.halfWidth && a < area) {
      best = i;
      area = a;
    }
  });
  return best;
}

/**
 * A new patch at (x, z) facing `yaw`: a gentle bench and then a steeper roll that gives the
 * height back, so it leaves no step.
 */
export function newPatch(x: number, z: number, yaw: number, basePitch: number): PatchConfig {
  const bench = 15;
  const flat = Math.tan(basePitch * 0.3);
  const steep = Math.tan(Math.max(basePitch * 2.2, 15 / (180 / Math.PI)));
  const roll = (bench * (Math.tan(basePitch) - flat)) / Math.max(1e-3, steep - Math.tan(basePitch));
  return { x, z, yaw, halfWidth: 8, edge: 4, blend: 4, segs: [[bench, Math.atan(flat)], [Math.max(2, roll), Math.atan(steep)]] };
}

const PITCH_MIN = -10 / (180 / Math.PI);
const PITCH_MAX = 60 / (180 / Math.PI);

/**
 * Re-pitch the other segments so the patch leaves no step after segment `changed` was edited:
 * the nearest first (the one after, then before, then further out), each within −10…60°, the
 * rest passed on to the next. Only an edit no other segment can make up for leaves a step.
 */
export function zeroStep(p: PatchConfig, changed: number, basePitch: number): void {
  const order: number[] = [];
  for (let d = 1; d < p.segs.length; d++) for (const j of [changed + d, changed - d]) if (j >= 0 && j < p.segs.length) order.push(j);
  for (const j of order) {
    const seg = p.segs[j];
    const step = patchStep(p, basePitch);
    if (!seg || seg[0] <= 0 || Math.abs(step) < 1e-9) continue;
    // This segment's grade that would take the whole step: (base − t)·len changes by −step.
    seg[1] = Math.max(PITCH_MIN, Math.min(PITCH_MAX, Math.atan(Math.tan(seg[1]) + step / seg[0])));
  }
}
