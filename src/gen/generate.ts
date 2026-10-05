import * as dm from '../sim/dmath.ts';
import { params as defaultParams, type Params } from '../sim/params.ts';
import { createRng } from '../sim/rng.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';
import type { Layout } from '../park/layout.ts';
import { GEN, type GenConfig } from './config.ts';
import { generateGround } from './ground.ts';
import type { Place } from './kit.ts';
import { placeLines } from './lines.ts';

/**
 * Seed in, layout out: the ground, then spine lines with their features. The same seed, config and params give the same layout, byte for
 * byte. Params matter because features are sized from the sim's physics.
 */
export function generateLayout(seed: number, cfg: GenConfig = GEN, params: Params = defaultParams): Layout {
  const rng = createRng(seed);
  const ground = generateGround(rng, cfg);
  const { features, lines } = placeLines(rng, ground, cfg, params);
  const field = ground;
  return {
    version: 1,
    name: 'generated',
    seed,
    ground: { length: cfg.zone.length, width: cfg.zone.width, pitch: field.pitch, field },
    spawn: { x: 0, z: -5, heading: Math.PI },
    features,
    lines,
    links: [],
  };
}

/** Grade of the ground along a feature's axis at (x, z), rad, downhill positive. */
export function pitchAlong(ground: Terrain, p: Place): number {
  const c = createContact();
  const d = 6;
  const h0 = ground.sample(p.x, p.z, c).height;
  const h1 = ground.sample(p.x + dm.sin(p.yaw) * d, p.z - dm.cos(p.yaw) * d, c).height;
  return dm.atan((h0 - h1) / d);
}
