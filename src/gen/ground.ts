import * as dm from '../sim/dmath.ts';
import type { FieldConfig, PatchConfig } from '../sim/heightfield.ts';
import { next, type Rng } from '../sim/rng.ts';
import type { GenConfig } from './config.ts';

export const RAD = Math.PI / 180;

export const range = (rng: Rng, [lo, hi]: readonly number[]): number => (lo ?? 0) + next(rng) * ((hi ?? 0) - (lo ?? 0));

/**
 * The zone's ground: a base grade, smooth noise, and steepness bands laid down the hill in
 * columns. Each band is a main segment (a flat bench, a run-in, a steep pitch) and a recovery
 * segment that gives the height back, so the ground never steps between columns.
 */
export function generateGround(rng: Rng, cfg: GenConfig): FieldConfig {
  const b = cfg.bands;
  const pitch = range(rng, cfg.basePitch) * RAD;
  const base = dm.tan(pitch);
  const patches: PatchConfig[] = [];
  const colWidth = cfg.zone.width / b.columns;

  for (let c = 0; c < b.columns; c++) {
    const centre = -cfg.zone.width / 2 + colWidth * (c + 0.5);
    let z = -range(rng, b.gap); // stagger the columns
    while (z > -cfg.zone.length) {
      const segs = band(rng, cfg, base);
      let len = 0;
      for (const [l] of segs) len += l;
      if (z - len < -cfg.zone.length) break;
      patches.push({
        x: centre + (next(rng) - 0.5) * colWidth * 0.3,
        z,
        yaw: (next(rng) * 2 - 1) * b.yaw * RAD,
        halfWidth: colWidth * (0.25 + next(rng) * 0.2),
        edge: range(rng, b.edge),
        blend: b.blend,
        segs,
      });
      z -= len + range(rng, b.gap);
    }
  }

  // Natural zones on top of the bands: a steep pitch sinking the ground, then a flatter run-out
  // giving the height back.
  const N = cfg.natural;
  const count = Math.round(range(rng, N.count));
  const basePitch = dm.atan(base);
  for (let i = 0; i < count; i++) {
    const p = range(rng, N.steep) * RAD;
    const t = dm.tan(p);
    const len = Math.min(range(rng, N.length), N.maxOffset / Math.max(1e-6, t - base));
    const sunk = (t - base) * len;
    const rp = Math.min(basePitch - 2 * RAD, range(rng, N.recover) * RAD);
    const recover = sunk / Math.max(1e-6, base - dm.tan(rp));
    const edge = cfg.zone.width / 2 - cfg.bank.width - 40;
    const halfWidth = range(rng, N.halfWidth);
    // Its sides fade over enough ground that the depth they climb stays a slope, not a wall.
    const fade = Math.max(range(rng, N.edge), (1.5 * sunk) / dm.tan(N.side * RAD));
    const yaw = (next(rng) * 2 - 1) * N.yaw * RAD;
    // Grades on top of each other add up to cliffs, so the zone clears the bands it would
    // overlap. Each patch gives back the height it takes, so removing one whole leaves no step.
    const x = (next(rng) * 2 - 1) * edge;
    const z = -range(rng, N.at);
    if (patches.some((q) => q.natural && Math.abs(q.x - x) < q.halfWidth + q.edge + halfWidth + fade && Math.abs(q.z - z) < 200)) continue; // one zone per stretch of hill
    for (let k = patches.length - 1; k >= 0; k--) {
      const q = patches[k];
      if (!q || q.natural) continue;
      let qLen = 0;
      for (const [l] of q.segs) qLen += l;
      // Cores and half the fades: where only the outer fades meet, the grades added stay gentle.
      const apartX = Math.abs(q.x - x) > q.halfWidth + halfWidth + 0.5 * (q.edge + fade);
      const apartZ = q.z - qLen > z + N.blend || z - len - recover > q.z + q.blend;
      if (!apartX && !apartZ) patches.splice(k, 1);
    }
    patches.push({ x, z, yaw, halfWidth, edge: fade, blend: N.blend, segs: [[len, p], [recover, rp]], natural: true });
  }

  return {
    pitch,
    width: cfg.zone.width,
    length: cfg.zone.length,
    cell: cfg.cell,
    bankWidth: cfg.bank.width,
    bankHeight: cfg.bank.height,
    noise: { seed: (next(rng) * 0x7fffffff) | 0, ...cfg.noise },
    patches,
  };
}

/** One band: [length, pitch rad] main segment, then the recovery that closes its height. */
function band(rng: Rng, cfg: GenConfig, base: number): [number, number][] {
  const b = cfg.bands;
  const total = b.kinds.bench + b.kinds.runIn + b.kinds.steep;
  const pick = next(rng) * total;
  const [grade, length, maxOffset] =
    pick < b.kinds.bench
      ? [b.flat, b.flatLength, b.maxOffset.bench]
      : pick < b.kinds.bench + b.kinds.runIn
        ? [b.runIn, b.runInLength, b.maxOffset.runIn]
        : [b.steep, b.steepLength, b.maxOffset.steep];
  const p = range(rng, grade) * RAD;
  const t = dm.tan(p);
  // Height taken off (or added to) the base plane, capped so the ground stays near it.
  let len = range(rng, length);
  len = Math.min(len, maxOffset / Math.max(1e-6, Math.abs(base - t)));
  const offset = (base - t) * len;
  // Recover on the far side of the base grade: a bench (raised) drops back on a run-in, a
  // run-in or steep (sunk) comes back on something flatter than the base.
  const basePitch = dm.atan(base);
  const rp = offset > 0 ? Math.min(range(rng, b.runIn) * RAD, b.maxPitch * RAD) : Math.max((b.flat[1] ?? 5) * RAD, basePitch - range(rng, [3, 6]) * RAD);
  const rt = dm.tan(rp);
  const recover = Math.abs(offset / (rt - base));
  return [
    [len, p],
    [recover, rp],
  ];
}
