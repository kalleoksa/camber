import { set, type Vec3 } from './vec3.ts';

/**
 * A rail as data (§8): points as (x, height above the slope, z), joined by straight
 * segments. Terrain config, so a take carries it. Straight segments rather than the
 * catmull-rom the design names — a straight rail is exact either way, and a curved one can
 * be built from short segments until milestone 7 needs better.
 */
export type RailConfig = {
  points: [number, number, number][];
};

/** World-space rail, built once. Flat arrays so queries on the tick path don't allocate. */
export type Rail = {
  count: number; // points
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  cum: Float64Array; // arc length at each point
  length: number;
};

export function buildRail(cfg: RailConfig, heightAt: (x: number, z: number) => number): Rail {
  const n = cfg.points.length;
  const rail: Rail = {
    count: n,
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    cum: new Float64Array(n),
    length: 0,
  };
  for (let i = 0; i < n; i++) {
    const p = cfg.points[i];
    if (!p) continue;
    rail.x[i] = p[0];
    rail.z[i] = p[2];
    rail.y[i] = heightAt(p[0], p[2]) + p[1];
    if (i > 0) {
      const dx = (rail.x[i] ?? 0) - (rail.x[i - 1] ?? 0);
      const dy = (rail.y[i] ?? 0) - (rail.y[i - 1] ?? 0);
      const dz = (rail.z[i] ?? 0) - (rail.z[i - 1] ?? 0);
      rail.cum[i] = (rail.cum[i - 1] ?? 0) + Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  rail.length = rail.cum[n - 1] ?? 0;
  return rail;
}

/** Point and unit tangent (first point → last) at arc length `s`, clamped to the rail. */
export function railAt(rail: Rail, s: number, outPos: Vec3, outTan: Vec3): void {
  const len = rail.length;
  const u = s < 0 ? 0 : s > len ? len : s;
  let i = 1;
  while (i < rail.count - 1 && (rail.cum[i] ?? 0) < u) i++;
  const a = i - 1;
  const segStart = rail.cum[a] ?? 0;
  const segLen = (rail.cum[i] ?? 0) - segStart;
  const t = segLen > 0 ? (u - segStart) / segLen : 0;
  const ax = rail.x[a] ?? 0;
  const ay = rail.y[a] ?? 0;
  const az = rail.z[a] ?? 0;
  const dx = (rail.x[i] ?? 0) - ax;
  const dy = (rail.y[i] ?? 0) - ay;
  const dz = (rail.z[i] ?? 0) - az;
  set(outPos, ax + dx * t, ay + dy * t, az + dz * t);
  const l = segLen > 0 ? segLen : 1;
  set(outTan, dx / l, dy / l, dz / l);
}

/** Written by `nearestOnRail`: arc length and squared distance of the closest point. */
export const nearest = { s: 0, dist2: Infinity };

/** Closest point on the rail to (x, y, z), by projecting onto each segment. */
export function nearestOnRail(rail: Rail, x: number, y: number, z: number): typeof nearest {
  nearest.s = 0;
  nearest.dist2 = Infinity;
  for (let i = 1; i < rail.count; i++) {
    const ax = rail.x[i - 1] ?? 0;
    const ay = rail.y[i - 1] ?? 0;
    const az = rail.z[i - 1] ?? 0;
    const dx = (rail.x[i] ?? 0) - ax;
    const dy = (rail.y[i] ?? 0) - ay;
    const dz = (rail.z[i] ?? 0) - az;
    const l2 = dx * dx + dy * dy + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - x;
    const py = ay + dy * t - y;
    const pz = az + dz * t - z;
    const d2 = px * px + py * py + pz * pz;
    if (d2 < nearest.dist2) {
      nearest.dist2 = d2;
      nearest.s = (rail.cum[i - 1] ?? 0) + Math.sqrt(l2) * t;
    }
  }
  return nearest;
}
