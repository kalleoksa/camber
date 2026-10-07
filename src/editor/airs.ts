import { GEN } from '../gen/config.ts';
import { fly, launch, type Flight } from '../gen/flight.ts';
import type { Size } from '../gen/kit.ts';
import { computeSpeedMap, speedAt, type SpeedMap } from '../gen/speedmap.ts';
import { checkLines, type FeatureCheck } from '../park/check.ts';
import { toSlopeConfig, type FeatureSpec, type Layout } from '../park/layout.ts';
import { hipTakeoff } from '../sim/hip.ts';
import type { Params } from '../sim/params.ts';
import { createContact, createSlope, type Terrain } from '../sim/terrain.ts';
import { groupOf, originOf } from './edits.ts';

/**
 * The editor's checks on a feature: where it takes off, the airs it was designed for flown over
 * the snow as it is, and a verdict (validation dot). Read-only: nothing here changes the layout.
 */

/** m along its axis from (x, z) to its lip, from the shape itself, so a hand edit moves it. */
export function lipOf(f: FeatureSpec): number {
  if (f.kind === 'kicker' || (f.kind === 'corner' && !f.cfg.hip)) return (f.cfg.lipHeight / (1 - Math.cos(f.cfg.lipAngle))) * Math.sin(f.cfg.lipAngle);
  if (f.kind === 'corner' && f.cfg.hip) return hipTakeoff(f.cfg, f.cfg.hip).runIn;
  return f.meta?.lip ?? 0;
}

export type Takeoff = { x: number; z: number; dirX: number; dirZ: number; speed: [number, number] };

/** A hip is flown toward its landing at its middle aim, as the kit checked it; anything else straight on. */
export function aimOf(f: FeatureSpec): number {
  if (f.kind !== 'corner' || !f.cfg.hip) return 0;
  const P = GEN.hip.sizes[(f.meta?.size ?? 'M') as Size] ?? GEN.hip.sizes.M;
  const mid = (((P.aim[0] ?? 10) + (P.aim[1] ?? 30)) / 2) * (Math.PI / 180);
  return (f.cfg.hip.side === 0 ? 1 : f.cfg.hip.side) * mid;
}

/** Where and which way a feature launches, at what design speeds; none for one that isn't jumped. */
export function takeoffOf(f: FeatureSpec, turn = 0): Takeoff | undefined {
  const speed = f.meta?.design?.speed ?? f.meta?.speed;
  if (f.kind === 'rail' || f.kind === 'quarter' || f.kind === 'wall' || !speed || speed[1] > 100) return undefined;
  const o = originOf(f);
  const lip = lipOf(f) - 0.02; // just on the lip, as the kit launches
  const heading = o.yaw + aimOf(f) + turn;
  return { x: o.x + Math.sin(o.yaw) * lip, z: o.z - Math.cos(o.yaw) * lip, dirX: Math.sin(heading), dirZ: -Math.cos(heading), speed: [speed[0], speed[1]] };
}

export type Air = { speed: number; pop: number; flight: Flight };

/** One straight air off the takeoff. */
export function airAt(t: Takeoff, terrain: Terrain, params: Params, speed: number, pop: number, points = true): Air {
  const l = launch(terrain, t.x, t.z, t.dirX, t.dirZ, speed, pop);
  return { speed, pop, flight: fly(terrain, params, t.x, l.y, t.z, l.vx, l.vy, l.vz, 6, points) };
}

/** The designed airs: slowest with no pop, middle and top speed with a medium pop. */
export function designedAirs(t: Takeoff, terrain: Terrain, params: Params, pops: [number, number]): Air[] {
  const mid = (pops[0] + pops[1]) / 2;
  const [v0, v1] = t.speed;
  return [airAt(t, terrain, params, v0, pops[0]), airAt(t, terrain, params, (v0 + v1) / 2, mid), airAt(t, terrain, params, v1, mid)];
}

/** Airs at evenly spread speeds, medium pop, past both ends of the design range: where each comes down. */
export function sweep(t: Takeoff, terrain: Terrain, params: Params, pops: [number, number], n = 24): Air[] {
  const lo = t.speed[0] * 0.7;
  const hi = t.speed[1] * 1.15;
  const mid = (pops[0] + pops[1]) / 2;
  const out: Air[] = [];
  for (let i = 0; i < n; i++) out.push(airAt(t, terrain, params, lo + ((hi - lo) * i) / (n - 1), mid, false));
  return out;
}

export type Colour = 'red' | 'amber' | 'green';
export type Verdict = { colour: Colour; why: string[] };

/**
 * Every checked feature's verdict, by index. Red: something stands on its run-in, its slowest
 * air bails, the speed check bot bails or misses it, or it can't be reached at its slowest
 * design speed. Amber: a designed air is sketchy, or the bot gets there faster than its design.
 */
export function validate(layout: Layout, terrain: Terrain, params: Params, pops: [number, number]): Map<number, Verdict> {
  const out = new Map<number, Verdict>();
  const c = createContact();
  const bot = new Map<number, FeatureCheck>();
  for (const line of checkLines(layout, terrain, params)) for (const f of line.features) bot.set(f.feature, f);
  // Off the lines, the speed straight down the fall line from the top: on generated ground only.
  const field = layout.ground.field;
  let map: SpeedMap | undefined;
  const mapAt = (x: number, z: number): number | undefined => {
    if (!field) return undefined;
    map ??= computeSpeedMap(terrain, params, { width: field.width, length: field.length, ...GEN.speedMap });
    return speedAt(map, x, z);
  };
  const seen = new Set<number>();
  layout.features.forEach((f, i) => {
    const t = takeoffOf(f);
    if (seen.has(i) || (!t && f.kind !== 'rail')) return;
    const parts = groupOf(layout, i);
    for (const p of parts) seen.add(p);
    const red: string[] = [];
    const amber: string[] = [];

    // Run-in: the snow before it as it would be with this obstacle alone on the ground.
    const alone = createSlope(toSlopeConfig({ ...layout, features: parts.map((p) => layout.features[p] as FeatureSpec) }), terrain.field);
    const o = originOf(f);
    const ax = Math.sin(o.yaw);
    const az = -Math.cos(o.yaw);
    const lip = t ? lipOf(f) : 0;
    for (let s = lip - GEN.clear.runIn; s < lip - 2; s += 1) {
      const x = o.x + ax * s;
      const z = o.z + az * s;
      if (Math.abs(terrain.sample(x, z, c).height - alone.sample(x, z, c).height) > 0.3) {
        red.push(`something on its run-in ${(lip - s).toFixed(0)} m before the ${t ? 'lip' : 'rail'}`);
        break;
      }
    }

    if (t) {
      const [slow, mid, fast] = designedAirs(t, terrain, params, pops);
      if (slow?.flight.grade === 'bail') red.push(`slowest air (${t.speed[0].toFixed(1)} m/s, no pop) bails: ${slow.flight.impact.toFixed(1)} m/s into the snow`);
      for (const [a, name] of [[slow, 'slowest'], [mid, 'middle'], [fast, 'fastest']] as const) {
        if (!a || a.flight.grade === 'clean' || (a === slow && a.flight.grade === 'bail')) continue;
        (a.flight.grade === 'bail' ? red : amber).push(`${name} air (${a.speed.toFixed(1)} m/s) ${a.flight.grade}: ${a.flight.impact.toFixed(1)} m/s into the snow`);
      }
    }

    const speed = f.meta?.design?.speed ?? f.meta?.speed;
    const b = parts.map((p) => bot.get(p)).find((x) => x);
    if (b) {
      if (b.how === 'BAIL' || b.how === 'MISSED') red.push(`speed check bot: ${b.how === 'BAIL' ? 'bailed' : 'missed the rail'}`);
      if (b.at < b.design[0]) red.push(`bot gets there at ${b.at.toFixed(1)} m/s, under its ${b.design[0]}`);
      else if (b.at > b.design[1]) amber.push(`bot gets there at ${b.at.toFixed(1)} m/s straight-lining, over its ${b.design[1]}: check speed`);
    } else if (speed && t) {
      const v = mapAt(t.x, t.z);
      if (v !== undefined && v < speed[0]) red.push(`straight down the fall line it gets there at ${v.toFixed(1)} m/s, under its ${speed[0]}`);
    }
    out.set(i, { colour: red.length ? 'red' : amber.length ? 'amber' : 'green', why: [...red, ...amber] });
  });
  return out;
}
