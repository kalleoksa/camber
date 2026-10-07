import { TICK_DT } from '../core/loop.ts';
import { neutralInput } from '../input/snapshot.ts';
import * as dm from '../sim/dmath.ts';
import type { Params } from '../sim/params.ts';
import { tick } from '../sim/rider.ts';
import { createRiderState } from '../sim/state.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';
import type { FeatureSpec, Layout } from './layout.ts';

/**
 * The speed check: the sim's rider rides each line of a layout from the top, straight down its
 * line, never braking, popping at every lip and rail start — except that rails are scrubbed into
 * (L2) at their design speed. Per feature: the speed it got there with against the range it was
 * designed for, and how it went — landed (clean / sketchy / bail), on the rail and off it, or
 * missed. Shared by `scripts/talma-check.ts` and the park editor.
 */
export type FeatureCheck = { feature: number; type: string; z: number; at: number; design: [number, number]; ok: boolean; how: string };
export type LineCheck = { name: string; features: FeatureCheck[] };

/** Where a feature is taken (z), and across the slope (x). */
function target(f: FeatureSpec): { x: number; z: number } {
  if (f.kind === 'rail') {
    const p = f.cfg.points[0] ?? [0, 0, 0];
    return { x: p[0], z: p[2] };
  }
  const k = f.cfg as { x: number; z: number };
  return { x: k.x, z: k.z - (f.meta?.lip ?? 0) };
}

export function checkLines(layout: Layout, t: Terrain, params: Params): LineCheck[] {
  const c = createContact();
  const out: LineCheck[] = [];
  for (const line of layout.lines) {
    const result: LineCheck = { name: line.name, features: [] };
    out.push(result);
    const indices = line.features.filter((i) => layout.features[i] !== undefined);
    const feats = indices.map((i) => layout.features[i] as FeatureSpec);
    const targets = feats.map(target);
    const x0 = targets[0]?.x ?? 0;
    const s = createRiderState({ position: { x: x0, y: t.sample(x0, layout.spawn.z, c).height + 0.05, z: layout.spawn.z }, heading: Math.PI });
    let fi = 0;
    let at = 0; // speed arriving at the current feature
    let railed = false;
    let flew = false;
    for (let i = 0; i < 120 * 120 && fi < feats.length && s.position.z > -layout.ground.length; i++) {
      const f = feats[fi];
      const tg = targets[fi];
      if (!f || !tg) break;
      const inp = neutralInput();
      const speed = Math.sqrt(s.velocity.x * s.velocity.x + s.velocity.y * s.velocity.y + s.velocity.z * s.velocity.z);
      const toGo = s.position.z - tg.z;
      if (s.mode === 'grounded') {
        // Hold the line: aim 10 m ahead on it.
        const want = dm.atan2(tg.x - s.position.x, 10);
        const vh = dm.atan2(s.velocity.x, -s.velocity.z);
        inp.lx = Math.max(-0.6, Math.min(0.6, (want - vh) * 2));
        const time = toGo / Math.max(1, -s.velocity.z);
        // A rail takes a light ollie (0.1 s of charge) to clear its 0.5 m and come down on it.
        const lead = f.kind === 'rail' ? 0.12 : params.pop.chargeTime + 0.05;
        if (time < lead && time > 0.02) inp.rt = 1;
        if (time < 0.4) inp.lx = 0;
        // Rails are taken at their design speed: scrub to it on the way in (kickers: never brake).
        const top = (f.meta?.speed?.[1] ?? 99) - 1;
        if (f.kind === 'rail' && toGo > 0 && toGo < 40 && speed > top && time > 0.4) {
          // The speed check: LT on one stick, the right stick's skid on two (LT does nothing there).
          const scrub = Math.min(1, (speed - top) * 0.8);
          if (params.input.scheme > 0) inp.rx = scrub;
          else inp.lt = scrub;
        }
      }
      if (toGo > 0 && s.mode === 'grounded') at = speed; // run-in speed, not the pop
      const was = s.mode;
      tick(s, inp, params, t, TICK_DT);
      if (s.mode === 'railed') railed = true;
      if (s.mode === 'airborne' && toGo < 1) flew = true; // only off this feature, not a drop on the way
      const passed = s.position.z < tg.z - (f.kind === 'rail' ? 14 : 30);
      const landed = flew && was === 'airborne' && s.mode !== 'airborne' && f.kind !== 'rail';
      if (passed || landed || s.mode === 'bailed') {
        const design: [number, number] = [f.meta?.speed?.[0] ?? 0, f.meta?.speed?.[1] ?? 99];
        const how = s.mode === 'bailed' ? 'BAIL' : f.kind === 'rail' ? (railed ? 'railed' : 'MISSED') : s.landing || 'rode';
        result.features.push({ feature: indices[fi] ?? -1, type: f.meta?.type ?? f.kind, z: tg.z, at, design, ok: at >= design[0] && at <= design[1], how });
        if (s.mode === 'bailed') break;
        fi++;
        railed = false;
        flew = false;
      }
    }
  }
  return out;
}

/** A check failed: arrived outside the design speed, bailed, or missed a rail. */
export const failed = (f: FeatureCheck): boolean => !f.ok || f.how === 'BAIL' || f.how === 'MISSED' || f.how === 'bail';
