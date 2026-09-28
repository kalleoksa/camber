import { normalize, vec3, type Vec3 } from './vec3.ts';
import * as dm from './dmath.ts';

export type SurfaceType = 'snow' | 'rail' | 'wall';

export type Contact = {
  height: number;
  normal: Vec3;
  surface: SurfaceType;
};

/**
 * The sim only ever asks the world for a contact under a point. Milestone 1 answers
 * analytically; the BVH raycast implementation slots in behind the same call.
 */
export type Terrain = {
  sample(x: number, z: number, out: Contact): Contact;
};

export type SlopeConfig = {
  length: number; // m along -Z
  width: number; // m along X
  pitch: number; // rad, fall line points toward -Z
  kicker?: KickerConfig;
};

/**
 * A table-top, measured from the base slope: circular transition up to the lip, a flat
 * deck at lip height, then a landing ramp back down, steeper than the slope. Terrain
 * data rather than params — a take stores it, so a replay rebuilds the same jump.
 * Stand-in until milestone 7's park.json.
 */
export type KickerConfig = {
  z: number; // m, where the transition starts (downhill is −Z)
  x: number; // m, centre across the slope
  width: number; // m
  lipHeight: number; // m above the base slope
  lipAngle: number; // rad, takeoff angle relative to the base slope
  deckLength: number; // m of flat table between lip and knuckle
  sideTaper: number; // m over which the sides fall away, so the edge isn't a wall
  /**
   * A park landing: rounded knuckle, a straight ramp at `landingAngle` below the base
   * slope, and a rounded run-out back onto it. Set these three for that; leave them out
   * and `landingLength` gives the older straight ramp from deck to slope, kept so takes
   * recorded on it still replay.
   */
  landingAngle?: number; // rad the landing falls away below the base slope
  knuckleRadius?: number; // m, convex roll from deck into landing
  runoutRadius?: number; // m, concave roll from landing back onto the slope
  landingLength?: number; // m, legacy straight ramp only
};

export function createContact(): Contact {
  return { height: 0, normal: vec3(0, 1, 0), surface: 'snow' };
}

/**
 * Constant-pitch plane falling toward -Z, with the sides rolled up slightly so a run
 * that drifts wide is pushed back to the fall line instead of off the edge.
 */
export function createSlope(cfg: SlopeConfig): Terrain {
  const slope = dm.tan(cfg.pitch);
  const half = cfg.width * 0.5;
  const bankHeight = cfg.width * 0.06;
  const bankWidth = cfg.width * 0.3;

  const bank = (x: number): number => {
    const over = Math.abs(x) - (half - bankWidth);
    if (over <= 0) return 0;
    const t = Math.min(over / bankWidth, 1);
    return bankHeight * t * t;
  };

  // Kicker profile along s, metres downhill past its start. The transition is a circular
  // arc so the rider is loaded smoothly into the lip; its radius follows from lip height
  // and angle (H = R(1 − cos θ), run-in L = R sin θ).
  const k = cfg.kicker;
  const radius = k ? k.lipHeight / (1 - dm.cos(k.lipAngle)) : 0;
  const runIn = k ? radius * dm.sin(k.lipAngle) : 0;
  const deckEnd = k ? runIn + k.deckLength : 0;

  // Park landing geometry: knuckle arc, straight landing, run-out arc. Each arc turns
  // through `landingAngle`, so the knuckle drops Rk(1 − cos α) over Rk sin α and the
  // run-out the same with its own radius; the straight covers the height left between.
  const alpha = k?.landingAngle ?? 0;
  const park = k !== undefined && alpha > 0;
  const rk = k?.knuckleRadius ?? 0;
  const rb = k?.runoutRadius ?? 0;
  const knuckleLen = park ? rk * dm.sin(alpha) : 0;
  const knuckleDrop = park ? rk * (1 - dm.cos(alpha)) : 0;
  const runoutLen = park ? rb * dm.sin(alpha) : 0;
  const runoutRise = park ? rb * (1 - dm.cos(alpha)) : 0;
  const slopeAlpha = park ? dm.tan(alpha) : 0;
  const straightLen = park && k ? Math.max(0, k.lipHeight - knuckleDrop - runoutRise) / slopeAlpha : 0;
  const knuckleEnd = deckEnd + knuckleLen;
  const straightEnd = knuckleEnd + straightLen;
  const end = !k ? 0 : park ? straightEnd + runoutLen : deckEnd + (k.landingLength ?? 0);

  const kickerHeight = (x: number, z: number): number => {
    if (!k) return 0;
    const s = k.z - z;
    if (s <= 0 || s >= end) return 0;
    const side = Math.abs(x - k.x) - k.width * 0.5;
    if (side >= k.sideTaper) return 0;
    let h: number;
    if (s < runIn) h = radius - Math.sqrt(radius * radius - s * s);
    else if (s < deckEnd) h = k.lipHeight;
    else if (!park) h = k.lipHeight * (1 - (s - deckEnd) / (k.landingLength ?? 1));
    else if (s < knuckleEnd) {
      const u = s - deckEnd;
      h = k.lipHeight - (rk - Math.sqrt(rk * rk - u * u));
    } else if (s < straightEnd) h = k.lipHeight - knuckleDrop - (s - knuckleEnd) * slopeAlpha;
    else {
      const u = end - s; // distance still to go to the slope
      h = rb - Math.sqrt(rb * rb - u * u);
    }
    if (side > 0) {
      const t = 1 - side / k.sideTaper;
      h *= t * t * (3 - 2 * t); // smoothstep, so the sides roll off rather than cliff
    }
    return h;
  };

  return {
    sample(x, z, out) {
      out.height = z * slope + bank(x);

      // Analytic gradient: dh/dx from the bank, dh/dz from the pitch.
      const eps = 0.05;
      const dhdx = (bank(x + eps) - bank(x - eps)) / (2 * eps);
      out.normal.x = -dhdx;
      out.normal.y = 1;
      out.normal.z = -slope;

      // Kicker on top, by central difference — only near it, so the plain slope stays
      // bit-identical to before the kicker existed and old takes keep their hashes.
      const kh = kickerHeight(x, z);
      if (
        kh > 0 ||
        kickerHeight(x, z + eps) > 0 ||
        kickerHeight(x, z - eps) > 0 ||
        kickerHeight(x + eps, z) > 0 ||
        kickerHeight(x - eps, z) > 0
      ) {
        out.height += kh;
        out.normal.x -= (kickerHeight(x + eps, z) - kickerHeight(x - eps, z)) / (2 * eps);
        out.normal.z -= (kickerHeight(x, z + eps) - kickerHeight(x, z - eps)) / (2 * eps);
      }
      normalize(out.normal);

      out.surface = 'snow';
      return out;
    },
  };
}
