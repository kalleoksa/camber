import { normalize, vec3, type Vec3 } from './vec3.ts';

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
};

export function createContact(): Contact {
  return { height: 0, normal: vec3(0, 1, 0), surface: 'snow' };
}

/**
 * Constant-pitch plane falling toward -Z, with the sides rolled up slightly so a run
 * that drifts wide is pushed back to the fall line instead of off the edge.
 */
export function createSlope(cfg: SlopeConfig): Terrain {
  const slope = Math.tan(cfg.pitch);
  const half = cfg.width * 0.5;
  const bankHeight = cfg.width * 0.06;
  const bankWidth = cfg.width * 0.3;

  const bank = (x: number): number => {
    const over = Math.abs(x) - (half - bankWidth);
    if (over <= 0) return 0;
    const t = Math.min(over / bankWidth, 1);
    return bankHeight * t * t;
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
      normalize(out.normal);

      out.surface = 'snow';
      return out;
    },
  };
}
