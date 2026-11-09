/**
 * The flow park: `node scripts/build-flow.ts` writes parks/flow.json, the game's default park.
 * One hand-laid park for testing feel — a mellow jib plaza at the top, where speed is low, then
 * three lines down a steeper hill with transitions as the backbone (hips, spines, berms, a wall,
 * a mini pipe), a jump line beside them, and a bowl of quarter pipes across the bottom. The bot
 * can't ride pipe airs, so the bowl and the features between the lines are placed, not checked.
 *
 * Every number is in FLOW below; the script only places and measures. Each feature goes `gap` m
 * below the one before it on its line. The check bot (src/park/check.ts) then rides the line to
 * it without braking, and a sized feature (kicker, hip) takes the kit's size whose design speeds
 * hold the speed the bot arrived with — so the ground sets the speeds, and nothing needs a speed
 * check. Features are the generator's kit (src/gen/kit.ts), kept with their design so the editor
 * can change them.
 */
import { writeFileSync } from 'node:fs';
import { GEN } from '../src/gen/config.ts';
import { corners, footprint, overlaps, type Footprint } from '../src/gen/footprint.ts';
import type { Size } from '../src/gen/kit.ts';
import { group, redesign, type Kind } from '../src/gen/lines.ts';
import { checkLines, failed, type FeatureCheck } from '../src/park/check.ts';
import { toSlopeConfig, type FeatureSpec, type Layout, type LineSpec } from '../src/park/layout.ts';
import * as dm from '../src/sim/dmath.ts';
import { buildField, type FieldConfig } from '../src/sim/heightfield.ts';
import { params } from '../src/sim/params.ts';
import { createContact, createSlope, type Terrain } from '../src/sim/terrain.ts';

const RAD = Math.PI / 180;

type Slot = {
  kind: Kind | 'panel' | 'block';
  gap: number; // m from the end of the feature before it on the line (the first: from the line's start)
  dx?: number; // m across from the line
  size?: Size; // sized kinds: where the search starts; the bot's arrival speed decides
  yaw?: number; // ° off the fall line
  inputs?: Record<string, number>; // the kit's inputs by name; left out, the middle of its range
  cfg?: Record<string, number>; // panel, block: their own numbers
};

const FLOW = {
  length: 620, // m down the hill
  width: 200, // m across, banks included
  cell: 1, // m between heightfield nodes
  bank: { width: 14, height: 5 },
  // The hill top down, full width: [length m, grade °]. A short drop-in, the jib plaza on a
  // grade that holds rail speed, then the hill proper, and a flat bowl at the bottom.
  hill: [
    [14, 15],
    [140, 4.5],
    [26, 16],
    [160, 7.5],
    [46, 12],
    [144, 8.5],
    [90, 1],
  ] as [number, number][],
  blend: 14, // m the grade changes over
  start: -4, // z the rider spawns at
  // Lines 52 m apart: a double hip is ~50 m across, so only the centre line has them, and the
  // lines beside it keep narrow features level with them.
  lines: [
    {
      name: 'wall line',
      x: -52,
      slots: [
        { kind: 'rail', gap: 28, inputs: { box: 1, flatDown: 0, length: 10, height: 0.4 } },
        { kind: 'jibTable', gap: 16, inputs: { box: 0, deck: 16, railLength: 10, railHeight: 0.4 } },
        { kind: 'rail', gap: 14, inputs: { box: 0, flatDown: 1, length: 12, height: 0.45 } },
        // Down the drop into the hill: a wall to ride, single hips landing toward the bank, a mini pipe.
        { kind: 'panel', gap: 50, dx: -3, cfg: { length: 22, height: 2.8, lean: 8, foot: 0.5, rampLength: 3 } },
        { kind: 'hip', gap: 20, size: 'M', inputs: { single: 1, left: 1 } },
        { kind: 'spine', gap: 20, inputs: { height: 2.4, width: 12 } },
        { kind: 'miniPipe', gap: 58, inputs: { length: 32, flat: 5, height: 1.8, angle: 65, radius: 2.5 } },
        { kind: 'spine', gap: 18, inputs: { height: 3.2, width: 14 } },
      ],
    },
    {
      name: 'transition line',
      x: 0,
      slots: [
        { kind: 'funBox', gap: 30, inputs: { top: 7, height: 1.6, faceAngle: 20, width: 9 } },
        { kind: 'rail', gap: 14, inputs: { box: 1, flatDown: 1, length: 12, height: 0.4 } },
        { kind: 'mini', gap: 14, inputs: { height: 0.6, angle: 16, width: 5 } },
        // Two rollers to pump, then hip, spine, pyramid, hip, spine — nothing here is a straight jump.
        { kind: 'roller', gap: 48, inputs: { height: 1.0, length: 12, width: 16 } },
        { kind: 'roller', gap: 2, inputs: { height: 1.2, length: 12, width: 16 } },
        { kind: 'hip', gap: 14, size: 'M', inputs: { single: 0 } },
        { kind: 'spine', gap: 20, inputs: { height: 3, width: 14 } },
        { kind: 'wedge', gap: 20, inputs: { four: 1, top: 5, height: 2.4, faceAngle: 22, width: 12 } },
        { kind: 'hip', gap: 24, size: 'L', inputs: { single: 0 } },
        { kind: 'spine', gap: 22, inputs: { height: 3.4, width: 14 } },
        { kind: 'wedge', gap: 22, inputs: { four: 0, top: 1.5, height: 2.6, faceAngle: 22, width: 14 } },
      ],
    },
    {
      name: 'jump line',
      x: 52,
      slots: [
        { kind: 'gapToRail', gap: 28 },
        { kind: 'rail', gap: 16, inputs: { box: 0, flatDown: 0, length: 10, height: 0.45 } },
        { kind: 'log', gap: 16, inputs: { length: 6, height: 0.4 } },
        { kind: 'kicker', gap: 62, size: 'M' },
        { kind: 'stepUp', gap: 20, size: 'M', inputs: { rise: 2 } },
        { kind: 'kicker', gap: 20, size: 'L' },
        { kind: 'kicker', gap: 20, size: 'XL' },
        { kind: 'spine', gap: 24, inputs: { height: 3.4, width: 14 } },
      ],
    },
  ] as { name: string; x: number; slots: Slot[] }[],
  // Between and beside the lines, by position (x, z of the kit's place): side hits toward the
  // next line over, a hut between two of them, quarter pipes on the banks facing in.
  extras: [
    { kind: 'block', x: 28, z: -275, cfg: { length: 14, width: 6, height: 3.5, rampLength: 12 } },
    { kind: 'sideHit', x: -28, z: -262, yaw: 35, inputs: { height: 1.2, width: 5 } },
    { kind: 'knoll', x: 28, z: -305, inputs: { height: 2, radius: 8, back: 0.7 } },
    { kind: 'sideHit', x: -28, z: -300, yaw: -35, inputs: { height: 1.3, width: 5 } },
    { kind: 'knoll', x: -26, z: -440, inputs: { height: 2.5, radius: 9, back: 0.7 } },
    { kind: 'sideHit', x: 26, z: -430, yaw: -30, inputs: { height: 1.4, width: 5 } },
    // The bowl across the bottom: every line ends in a wall to air out of, the centre one a corner.
    { kind: 'quarter', x: -52, z: -572, inputs: { width: 40, height: 4, radius: 4.5 } },
    { kind: 'hipQuarter', x: 6, z: -574, inputs: { left: 0, outside: 0, width: 14, angle: 45, height: 4, radius: 4.5 } },
    { kind: 'quarter', x: 52, z: -572, inputs: { width: 40, height: 4.5, radius: 5 } },
    { kind: 'quarter', x: -84, z: -290, yaw: -90, inputs: { width: 26, height: 3.5, radius: 4 } },
    { kind: 'quarter', x: 84, z: -350, yaw: 90, inputs: { width: 26, height: 3.5, radius: 4 } },
  ] as { kind: Kind | 'block'; x: number; z: number; yaw?: number; inputs?: Record<string, number>; cfg?: Record<string, number> }[],
};

// m further down its line a feature is tried at, in order, until the bot rides it clean.
const SEARCH = { sized: [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 46, 52, 60], other: [0, -4, 4, -8, 8, 12, 16, 20], least: 8 };
const SIZED: Partial<Record<string, 'kicker' | 'hip'>> = { kicker: 'kicker', hip: 'hip', stepDownHip: 'hip' };
const r2 = (v: number): number => Math.round(v * 100) / 100;

function field(): FieldConfig {
  return {
    pitch: (FLOW.hill[0]?.[1] ?? 10) * RAD,
    width: FLOW.width,
    length: FLOW.length,
    cell: FLOW.cell,
    bankWidth: FLOW.bank.width,
    bankHeight: FLOW.bank.height,
    noise: { seed: 1, amp: 0, wavelength: 50, octaves: 0 },
    patches: [{ x: 0, z: 0, yaw: 0, halfWidth: FLOW.width, edge: 1, blend: FLOW.blend, segs: FLOW.hill.map(([len, deg]) => [len, deg * RAD]) }],
  };
}

const f = field();
const baked = buildField(f);
const ground = { length: FLOW.length, width: FLOW.width, pitch: f.pitch, field: f };
const spawn = { x: 0, z: FLOW.start, heading: Math.PI };
const layoutOf = (features: FeatureSpec[], lines: LineSpec[]): Layout => ({ version: 1, name: 'flow', ground, spawn, features, lines, links: [] });
const terrainOf = (features: FeatureSpec[]): Terrain => createSlope(toSlopeConfig(layoutOf(features, [])), baked);
const bare = terrainOf([]);
const contact = createContact();
const heightAt = (x: number, z: number): number => bare.sample(x, z, contact).height;

/** One obstacle's parts at a place. Kit kinds carry their design, so the editor can re-solve them. */
function make(kind: Slot['kind'], x: number, z: number, yawDeg: number, size: Size, inputs: Record<string, number>, c: Record<string, number>): FeatureSpec[] {
  const yaw = yawDeg * RAD;
  if (kind === 'panel') {
    // A plywood wall beside the line, its face toward it, a snow ramp at its foot (as Talma's).
    return [{ kind: 'panel', cfg: { x, z, yaw, length: c.length ?? 20, height: c.height ?? 2.5, lean: (c.lean ?? 8) * RAD, side: 1, foot: c.foot ?? 0.5, ramp: { height: c.foot ?? 0.5, length: c.rampLength ?? 3 } }, meta: { type: 'wallRide' } }];
  }
  if (kind === 'block') {
    return [{ kind: 'block', cfg: { x, z, yaw, length: c.length ?? 14, width: c.width ?? 6, height: c.height ?? 3.5, ramp: { length: c.rampLength ?? 12 } }, meta: { type: 'hut' } }];
  }
  const sized = SIZED[kind];
  const speed = sized === 'hip' ? GEN.hip.sizes[size].speed : sized === 'kicker' || kind === 'stepUp' ? GEN.kicker.sizes[kind === 'stepUp' ? 'M' : size].speed : [0, 99];
  const parts = redesign({ kind, place: { x, z, yaw }, size, speed: [speed[0] ?? 0, speed[1] ?? 99], inputs: { ...inputs } }, bare, GEN, params);
  // Rails and boxes are ridden at rail speed; the bot checks them against it.
  // A spine is popped at its ridge, not at its foot.
  for (const p of parts) {
    if (p.kind === 'shape' && p.cfg.kind === 'spine') {
      const print = footprint(p, 0, 0);
      p.meta = { ...(p.meta ?? { type: 'spine' }), lip: r2((print.s0 + print.s1) / 2) };
    }
  }
  for (const p of parts) if (p.kind === 'rail' && !p.meta?.speed) p.meta = { ...(p.meta ?? { type: 'rail' }), speed: [...GEN.lines.railSpeed] as [number, number] };
  return parts;
}

/** The lowest z a set of parts reaches (their own ground, no run-in). */
function endOf(parts: FeatureSpec[]): number {
  let z = Infinity;
  for (const p of parts) for (const [, cz] of corners(footprint(p, 0, 0))) z = Math.min(z, cz);
  return z;
}

/** Rails count as passing when the bot got there no faster than they're made for, unscrubbed. */
const NO_SCRUB: [number, number] = [0, 99];
function rideLine(features: FeatureSpec[], line: LineSpec): FeatureCheck[] {
  // The bot scrubs into rails above their top speed. Here it mustn't: the ground is meant to
  // deliver rail speed on its own, so rails are ridden as they come and compared afterwards.
  const open = features.map((ft) => (ft.kind === 'rail' ? { ...ft, meta: { ...(ft.meta ?? { type: 'rail' }), speed: NO_SCRUB } } : ft));
  const out = checkLines(layoutOf(open, [line]), terrainOf(features), params)[0]?.features ?? [];
  for (const c of out) {
    const real = features[c.feature]?.meta?.speed;
    if (real) {
      c.design = [real[0], real[1]];
      c.ok = c.at >= real[0] && c.at <= real[1];
    }
  }
  return out;
}

const features: FeatureSpec[] = [];
const lines: LineSpec[] = [];
const prints: { name: string; print: Footprint }[] = [];
const problems: string[] = [];

function push(name: string, parts: FeatureSpec[]): number {
  const at = features.length;
  group(parts, at);
  for (const p of parts) {
    const print = footprint(p, 0, 1);
    for (const o of prints) if (o.name !== name && overlaps(o.print, print)) problems.push(`${name} overlaps ${o.name}`);
    prints.push({ name, print });
  }
  features.push(...parts);
  return at;
}

for (const L of FLOW.lines) {
  const line: LineSpec = { name: L.name, features: [], speed: [] };
  let cursor = FLOW.start;
  for (const s of L.slots) {
    const x = L.x + (s.dx ?? 0);
    const z = r2(cursor - s.gap);
    const label = `${L.name}: ${s.kind} ${s.size ?? ''} below z ${z.toFixed(0)}`;
    const sized = SIZED[s.kind];
    const size: Size = s.size ?? 'S';
    const build = (zz: number): FeatureSpec[] => make(s.kind, x, zz, s.yaw ?? 0, size, s.inputs ?? {}, s.cfg ?? {});
    let parts = build(z);
    if (parts.length === 0) throw new Error(`${label}: the kit built nothing here`);
    if (s.kind !== 'panel') {
      // Slide it down the line until the bot, never braking, arrives inside its design speeds
      // and comes off it clean: `gap` is the least run-in, the ground decides the rest.
      let best: { parts: FeatureSpec[]; score: number } | undefined;
      for (const extra of sized ? SEARCH.sized : SEARCH.other) {
        if (s.gap + extra < SEARCH.least) continue;
        const tryParts = build(r2(z - extra));
        if (tryParts.length === 0) continue;
        const trial: LineSpec = { ...line, features: [...line.features, features.length] };
        const got = rideLine([...features, ...tryParts], trial).at(-1);
        if (!got || got.feature !== features.length) continue;
        const score = (got.ok ? 0 : 4) + (got.how === 'clean' || got.how === 'rode' || got.how === 'railed' ? 0 : got.how === 'sketchy' || got.how === 'none' ? 1 : 8);
        if (!best || score < best.score) best = { parts: tryParts, score };
        if (score === 0) break;
      }
      if (!best) throw new Error(`${label}: the bot never got here`);
      parts = best.parts;
    }
    const at = push(label, parts);
    line.features.push(at);
    line.speed.push(0);
    cursor = endOf(parts);
  }
  lines.push(line);
}

for (const e of FLOW.extras) {
  const parts = make(e.kind, e.x, e.z, e.yaw ?? 0, 'S', e.inputs ?? {}, e.cfg ?? {});
  for (const p of parts) p.meta = { ...(p.meta ?? { type: p.kind }), fill: true };
  push(`${e.kind} at x ${e.x} z ${e.z}`, parts);
}

// The finished park, every line ridden top to bottom without braking.
let failures = 0;
for (const line of lines) {
  console.log(line.name);
  const got = rideLine(features, line);
  got.forEach((c, i) => {
    line.speed[i] = r2(c.at);
    if (failed(c)) failures++;
    const size = features[c.feature]?.meta?.size;
    console.log(`  ${c.type}${size ? ' ' + size : ''} at z ${c.z.toFixed(0)}: ${c.at.toFixed(1)} m/s (${(c.at * 3.6).toFixed(0)} km/h, design ${c.design.join('–')}) ${c.ok ? 'ok' : 'OUT'}, ${c.how}`);
  });
  if (got.length < line.features.length) {
    failures++;
    console.log(`  stopped after ${got.length} of ${line.features.length}`);
  }
}
for (const p of problems) console.log(`PROBLEM ${p}`);
console.log(`drop ${(heightAt(0, 0) - heightAt(0, -FLOW.length)).toFixed(0)} m over ${FLOW.length} m · ${features.length} parts`);
console.log(failures || problems.length ? `${failures} failed, ${problems.length} problems` : 'all passed');
if (failures || problems.length) process.exitCode = 1;

writeFileSync(new URL('../parks/flow.json', import.meta.url), JSON.stringify(layoutOf(features, lines), null, 1) + '\n');
