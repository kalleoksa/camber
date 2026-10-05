import { createRng } from '../sim/rng.ts';
import type { Layout } from '../park/layout.ts';
import { GEN, type GenConfig } from './config.ts';
import { generateGround } from './ground.ts';

/** Seed in, layout out. The same seed and config give the same layout, byte for byte. */
export function generateLayout(seed: number, cfg: GenConfig = GEN): Layout {
  const rng = createRng(seed);
  const field = generateGround(rng, cfg);
  return {
    version: 1,
    name: 'generated',
    seed,
    ground: { length: cfg.zone.length, width: cfg.zone.width, pitch: field.pitch, field },
    spawn: { x: 0, z: -5, heading: Math.PI },
    features: [],
    lines: [],
    links: [],
  };
}
