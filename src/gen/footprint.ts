import * as dm from '../sim/dmath.ts';
import { createContact, createSlope } from '../sim/terrain.ts';
import { toSlopeConfig, type FeatureSpec } from '../park/layout.ts';

/**
 * Where a feature is, in plan: a rectangle in its own frame (along its axis from its origin,
 * across it), covering everything it raises plus clear run-in before its takeoff. Two features
 * whose footprints overlap would merge into each other or block one's approach.
 */
export type Footprint = { x: number; z: number; yaw: number; s0: number; s1: number; w0: number; w1: number };

const STEP = 2; // m between samples when measuring a feature's extent
const FAR = 140; // m searched along and across

/** Measure a feature's extent from its own height function, then add the run-in it needs. */
export function footprint(f: FeatureSpec, runIn: number, margin: number): Footprint {
  if (f.kind === 'rail') {
    const a = f.cfg.points[0] ?? [0, 0, 0];
    const b = f.cfg.points[f.cfg.points.length - 1] ?? a;
    const len = Math.sqrt((b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2);
    const yaw = dm.atan2(b[0] - a[0], -(b[2] - a[2]));
    return { x: a[0], z: a[2], yaw, s0: -runIn * 0.6 - margin, s1: len + margin + 4, w0: -margin - 1, w1: margin + 1 };
  }
  const cfg = f.cfg as { x: number; z: number; yaw?: number };
  const yaw = cfg.yaw ?? 0;
  // The feature alone at yaw 0 on flat ground: its extent in its own frame.
  const alone: FeatureSpec = { ...f, cfg: { ...f.cfg, x: 0, z: 0, yaw: 0 } } as FeatureSpec;
  const t = createSlope(toSlopeConfig({ version: 1, name: '', ground: { length: 400, width: 400, pitch: 0 }, spawn: { x: 0, z: 0, heading: 0 }, features: [alone], lines: [], links: [] }));
  const c = createContact();
  let s0 = Infinity;
  let s1 = -Infinity;
  let w0 = Infinity;
  let w1 = -Infinity;
  for (let s = -FAR / 2; s <= FAR; s += STEP) {
    for (let w = -FAR / 2; w <= FAR / 2; w += STEP) {
      if (t.sample(w, -s, c).height > 0.05) {
        if (s < s0) s0 = s;
        if (s > s1) s1 = s;
        if (w < w0) w0 = w;
        if (w > w1) w1 = w;
      }
    }
  }
  if (!Number.isFinite(s0)) return { x: cfg.x, z: cfg.z, yaw, s0: 0, s1: 0, w0: 0, w1: 0 };
  // Run-in: straight ahead of the takeoff, as wide as the feature's middle.
  return { x: cfg.x, z: cfg.z, yaw, s0: s0 - runIn - margin, s1: s1 + margin, w0: w0 - margin, w1: w1 + margin };
}

/** The rectangle's four corners in world (x, z). */
export function corners(p: Footprint): [number, number][] {
  const ax = dm.sin(p.yaw);
  const az = -dm.cos(p.yaw);
  const cx = dm.cos(p.yaw);
  const cz = dm.sin(p.yaw);
  const at = (s: number, w: number): [number, number] => [p.x + ax * s + cx * w, p.z + az * s + cz * w];
  return [at(p.s0, p.w0), at(p.s1, p.w0), at(p.s1, p.w1), at(p.s0, p.w1)];
}

/** Separating-axis test between two footprints. */
export function overlaps(a: Footprint, b: Footprint): boolean {
  const ca = corners(a);
  const cb = corners(b);
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i] ?? [0, 0];
      const q = poly[(i + 1) % 4] ?? [0, 0];
      const nx = q[1] - p[1];
      const nz = p[0] - q[0];
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const [x, z] of ca) {
        const d = x * nx + z * nz;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const [x, z] of cb) {
        const d = x * nx + z * nz;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

/** Does the footprint cover a point (with `r` m to spare)? */
export function covers(p: Footprint, x: number, z: number, r: number): boolean {
  const dx = x - p.x;
  const dz = z - p.z;
  const s = dx * dm.sin(p.yaw) - dz * dm.cos(p.yaw);
  const w = dx * dm.cos(p.yaw) + dz * dm.sin(p.yaw);
  return s > p.s0 - r && s < p.s1 + r && w > p.w0 - r && w < p.w1 + r;
}
