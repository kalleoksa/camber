import * as dm from '../sim/dmath.ts';
import { shapeLip } from '../sim/features.ts';
import type { Params } from '../sim/params.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';
import type { FeatureSpec, LinkSpec } from '../park/layout.ts';
import type { GenConfig } from './config.ts';
import { fly, launch, popRange } from './flight.ts';
import { covers, type Footprint } from './footprint.ts';
import { RAD } from './ground.ts';
import { speedAt, type SpeedMap } from './speedmap.ts';

/**
 * The connection graph: from every takeoff, airs across its speed range and up to ±30° either
 * side of straight, flown over the finished park. Where one lands clean the rider rides on;
 * a link goes to every feature whose lip lies downhill of the touchdown, within steering reach,
 * reached at its slowest design speed or better — or, landing on another feature's own landing,
 * a transfer. Links only run downhill, so the graph has no loops and its longest chains are the
 * lines a rider can actually string together, whether the generator planned them or not.
 */
export type Takeoff = { feature: number; x: number; y?: number; z: number; yaw: number; speed: [number, number]; rail: boolean };

/** Where each feature can be left from, and how fast. Features without one (quarters, spines) have none. */
export function takeoffs(features: FeatureSpec[], map: SpeedMap, cfg: GenConfig, world: Terrain): Takeoff[] {
  const out: Takeoff[] = [];
  const c = createContact();
  features.forEach((f, i) => {
    if (f.kind === 'rail') {
      const pts = f.cfg.points;
      const a = pts[pts.length - 2] ?? pts[0];
      const b = pts[pts.length - 1];
      if (!a || !b) return;
      const yaw = dm.atan2(b[0] - a[0], -(b[2] - a[2]));
      out.push({ feature: i, x: b[0], y: world.sample(b[0], b[2], c).height + b[1], z: b[2], yaw, speed: cfg.lines.railSpeed as [number, number], rail: true });
      return;
    }
    const cfg2 = f.cfg as { x: number; z: number; yaw?: number };
    const yaw = cfg2.yaw ?? 0;
    let lip = f.meta?.lip;
    let speed = f.meta?.speed;
    if (f.kind === 'shape') {
      const s = shapeLip(f.cfg);
      if (s < 0) return;
      lip = s;
    }
    if (lip === undefined) return;
    const x = cfg2.x + dm.sin(yaw) * (lip - 0.02);
    const z = cfg2.z - dm.cos(yaw) * (lip - 0.02);
    if (!speed) {
      const v = speedAt(map, cfg2.x, cfg2.z);
      speed = [v * (cfg.graph.shapeSpeed[0] ?? 0.6), v * (cfg.graph.shapeSpeed[1] ?? 0.9)];
    }
    out.push({ feature: i, x, z, yaw, speed, rail: false });
  });
  return out;
}

export function buildGraph(features: FeatureSpec[], prints: Footprint[], world: Terrain, map: SpeedMap, cfg: GenConfig, params: Params): LinkSpec[] {
  const G = cfg.graph;
  const g = params.world.gravity;
  const c = createContact();
  const [popMin, popMax] = popRange(params);
  const pop = (popMin + popMax) / 2;
  const offs = takeoffs(features, map, cfg, world);
  // Where each feature is entered: its lip (or a rail's start) and the slowest it works at.
  const entries = features.map((f) => entry(f));
  const best = new Map<string, LinkSpec>();
  const add = (from: number, to: number, speed: number, kind: 'ride' | 'transfer'): void => {
    const key = `${from}>${to}`;
    const l = best.get(key);
    if (!l) best.set(key, { from, to, speed: [speed, speed], kind });
    else {
      l.speed = [Math.min(l.speed[0], speed), Math.max(l.speed[1], speed)];
      if (kind === 'transfer') l.kind = 'transfer';
    }
  };

  for (const t of offs) {
    for (let si = 0; si < G.speeds; si++) {
      const speed = t.speed[0] + ((t.speed[1] - t.speed[0]) * si) / Math.max(1, G.speeds - 1);
      for (let hi = 0; hi < G.headings; hi++) {
        const off = (-G.heading + (2 * G.heading * hi) / Math.max(1, G.headings - 1)) * RAD;
        const yaw = t.yaw + off;
        const dx = dm.sin(yaw);
        const dz = -dm.cos(yaw);
        let x0 = t.x;
        let z0 = t.z;
        let l: { y: number; vx: number; vy: number; vz: number };
        if (t.rail) {
          // Off a rail's end: along it, a little pop straight up.
          x0 = t.x + dx * 0.3;
          z0 = t.z + dz * 0.3;
          l = { y: t.y ?? 0, vx: dx * speed, vy: popMin, vz: dz * speed };
        } else {
          l = launch(world, x0, z0, dx, dz, speed, pop);
        }
        const f = fly(world, params, x0, l.y, z0, l.vx, l.vy, l.vz, 6, false);
        if (f.grade !== 'clean') continue;
        const v2 = l.vx * l.vx + l.vy * l.vy + l.vz * l.vz + 2 * g * (l.y - f.y);
        const vOut = Math.sqrt(Math.max(0, v2 - f.impact * f.impact));
        const hOut = world.sample(f.x, f.z, c).height;
        for (let j = 0; j < features.length; j++) {
          if (j === t.feature) continue;
          const e = entries[j];
          const p = prints[j];
          if (!e || !p) continue;
          // Onto another feature's own landing: a transfer.
          if (e.downstream && covers(p, f.x, f.z, 0) && along(e, f.x, f.z) > 0.5) {
            add(t.feature, j, speed, 'transfer');
            continue;
          }
          // On to its lip: downhill, within reach, steerable, fast enough on arrival.
          const dxl = e.x - f.x;
          const dzl = e.z - f.z;
          const d = Math.sqrt(dxl * dxl + dzl * dzl);
          if (d < (G.reach[0] ?? 8) || d > (G.reach[1] ?? 90) || e.z > f.z - 2) continue;
          // Its approach comes in along its own axis: the touchdown must sit in front of it.
          const s = along(e, f.x, f.z);
          const w = across(e, f.x, f.z);
          if (s > -2 || Math.abs(w) > (G.steer[0] ?? 6) + (G.steer[1] ?? 0.6) * -s) continue;
          const hLip = world.sample(e.x, e.z, c).height;
          const arrive2 = vOut * vOut + 2 * g * (hOut - hLip) - 2 * params.ground.friction * g * d;
          if (arrive2 < e.minSpeed * e.minSpeed) continue;
          add(t.feature, j, speed, 'ride');
        }
      }
    }
  }
  return [...best.values()].map((l) => ({ ...l, speed: [Number(l.speed[0].toFixed(2)), Number(l.speed[1].toFixed(2))] as [number, number] }));

  function entry(f: FeatureSpec): { x: number; z: number; yaw: number; minSpeed: number; downstream: boolean } | undefined {
    if (f.kind === 'rail') {
      const a = f.cfg.points[0];
      const b = f.cfg.points[1];
      if (!a || !b) return undefined;
      return { x: a[0], z: a[2], yaw: dm.atan2(b[0] - a[0], -(b[2] - a[2])), minSpeed: cfg.lines.railSpeed[0] ?? 0, downstream: false };
    }
    const k = f.cfg as { x: number; z: number; yaw?: number };
    const yaw = k.yaw ?? 0;
    const lip = f.meta?.lip ?? 0;
    return {
      x: k.x + dm.sin(yaw) * lip,
      z: k.z - dm.cos(yaw) * lip,
      yaw,
      minSpeed: f.meta?.speed?.[0] ?? 0,
      downstream: f.kind === 'kicker' || f.kind === 'corner',
    };
  }
}

/** Metres along a feature's axis from its lip (negative: in front of it). */
function along(e: { x: number; z: number; yaw: number }, x: number, z: number): number {
  return (x - e.x) * dm.sin(e.yaw) - (z - e.z) * dm.cos(e.yaw);
}
function across(e: { x: number; z: number; yaw: number }, x: number, z: number): number {
  return (x - e.x) * dm.cos(e.yaw) + (z - e.z) * dm.sin(e.yaw);
}

/**
 * Chains: the longest path through the links, taken out, the next longest, and so on — the
 * lines a rider can string together. Links run downhill, so features sorted by height order
 * them. Returns each chain as feature indices, longest first.
 */
export function chains(count: number, links: LinkSpec[], z: (i: number) => number): number[][] {
  const out: number[][] = [];
  const used = new Set<number>();
  const order = [...Array(count).keys()].sort((a, b) => z(b) - z(a)); // uphill first
  for (;;) {
    const len = new Array<number>(count).fill(0);
    const prev = new Array<number>(count).fill(-1);
    for (const i of order) {
      if (used.has(i)) continue;
      for (const l of links) {
        if (l.from !== i || used.has(l.to)) continue;
        if ((len[i] ?? 0) + 1 > (len[l.to] ?? 0)) {
          len[l.to] = (len[i] ?? 0) + 1;
          prev[l.to] = i;
        }
      }
    }
    let end = -1;
    for (let i = 0; i < count; i++) if (!used.has(i) && (end < 0 || (len[i] ?? 0) > (len[end] ?? 0))) end = i;
    if (end < 0 || (len[end] ?? 0) === 0) break;
    const chain: number[] = [];
    for (let i = end; i >= 0; i = prev[i] ?? -1) chain.unshift(i);
    chain.forEach((i) => used.add(i));
    out.push(chain);
  }
  return out;
}
