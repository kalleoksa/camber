import type { SlopeConfig } from '../sim/terrain.ts';

/** The gravity every park was sized for, and the real one. */
export const PARK_GRAVITY = 16;
export const REAL_GRAVITY = 9.81;

/**
 * The parks are built for the sim's 16 m/s² gravity at 0.61 of real size (sochi.ts): v² = 2gh,
 * so shrinking every length by g_real/g_sim keeps every speed real. Under real gravity the
 * same park at full size rides at the same speeds — `scalePark(cfg, 16 / 9.81)` undoes the
 * shrink. Every length scales; angles don't, and nor does a rail's height above the snow,
 * which is human-sized whatever the jump is.
 */
const UNSCALED = new Set(['pitch', 'lipAngle', 'landingAngle', 'angle', 'backAngle', 'side']);

function scaleObject<T extends object>(src: T, s: number): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    out[key] = typeof value === 'number' && !UNSCALED.has(key) ? value * s : value;
  }
  return out as T;
}

export function scalePark(cfg: SlopeConfig, s: number): SlopeConfig {
  if (s === 1) return cfg;
  return {
    ...scaleObject(cfg, s),
    kicker: cfg.kicker && scaleObject(cfg.kicker, s),
    kickers: cfg.kickers?.map((k) => scaleObject(k, s)),
    corners: cfg.corners?.map((c) => ({
      ...scaleObject(c, s),
      ...(c.hip && { hip: { ...c.hip, straightLip: c.hip.straightLip * s, knuckleRadius: c.hip.knuckleRadius * s, bottomRadius: c.hip.bottomRadius * s } }),
    })),
    quarters: cfg.quarters?.map((q) => scaleObject(q, s)),
    walls: cfg.walls?.map((w) => scaleObject(w, s)),
    grades: cfg.grades?.map((g) => scaleObject(g, s)),
    rails: cfg.rails?.map((r) => ({ ...r, points: r.points.map(([x, h, z]) => [x * s, h, z * s] as [number, number, number]) })),
  };
}
