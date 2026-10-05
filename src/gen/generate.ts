import * as dm from '../sim/dmath.ts';
import { params } from '../sim/params.ts';
import { createRng, type Rng } from '../sim/rng.ts';
import { createContact, createSlope, type Terrain } from '../sim/terrain.ts';
import type { FeatureSpec, Layout } from '../park/layout.ts';
import { GEN, type GenConfig } from './config.ts';
import { generateGround } from './ground.ts';
import { designHip, designKicker, designQuarter, designRail, designShape, designStepUp, type Place } from './kit.ts';

/** Seed in, layout out. The same seed and config give the same layout, byte for byte. */
export function generateLayout(seed: number, cfg: GenConfig = GEN): Layout {
  const rng = createRng(seed);
  const field = generateGround(rng, cfg);
  const ground = createSlope({ length: cfg.zone.length, width: cfg.zone.width, pitch: field.pitch, field });
  const features = showcase(rng, ground, cfg);
  return {
    version: 1,
    name: 'generated',
    seed,
    ground: { length: cfg.zone.length, width: cfg.zone.width, pitch: field.pitch, field },
    spawn: { x: 0, z: -5, heading: Math.PI },
    features,
    lines: [],
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

/**
 * Step 4 only: one of each kit feature, in three columns down the zone at mixed headings, so
 * the kit and its overlays can be looked at before lines (step 5) place them for real.
 */
function showcase(rng: Rng, ground: Terrain, cfg: GenConfig): FeatureSpec[] {
  const out: FeatureSpec[] = [];
  const at = (x: number, z: number, yaw: number): Place => ({ x, z, yaw });
  const kick = (p: Place, size: 'S' | 'M' | 'L' | 'XL'): void => {
    out.push(designKicker(p, size, pitchAlong(ground, p), cfg, params));
  };
  kick(at(0, -40, 0), 'M');
  kick(at(-70, -60, -0.35), 'S');
  kick(at(70, -60, 0.4), 'L');
  out.push(designHip(at(0, -170, 0), 'M', cfg));
  out.push(designShape('spine', at(-70, -170, 0.2), rng, cfg));
  out.push(designShape('roller', at(70, -170, -0.2), rng, cfg));
  kick(at(0, -300, 0.25), 'XL');
  out.push(designRail(at(-70, -300, 0), rng, cfg));
  out.push(designShape('sideHit', at(70, -300, 0.6), rng, cfg));
  out.push(designQuarter(at(0, -470, 0), rng, cfg));
  out.push(designHip(at(-70, -440, -0.5), 'S', cfg));
  kick(at(70, -440, -0.3), 'M');
  const up = at(-70, -560, 0.15);
  out.push(designStepUp(up, rng, pitchAlong(ground, up), cfg, params));
  return out;
}
