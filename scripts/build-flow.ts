/**
 * The flow park: `node scripts/build-flow.ts` writes parks/flow.json, the game's default park.
 * One hand-laid park for testing feel, built ground first:
 *
 * - The hill is a staircase in a valley. Three lanes run down it, each a run of tiers — a long,
 *   near-flat deck ending in a tall steep face — and every tier gives back the height it takes,
 *   so the lanes stay level with the hill. The lanes' tiers are out of step, so where they meet
 *   the ground steps sideways too. The valley's sides roll up into banks to ride.
 * - Features hang on that: a kicker at a deck's edge lands on the face below it (its landing is
 *   solved over the real ground), rails, rollers and spines sit on the decks, and mounds run
 *   down between the lanes so there is no flat ground to cross.
 *
 * Every number is in FLOW below; the script only places and measures. The check bot
 * (src/park/check.ts) rides each lane top to bottom without braking: an edge kicker takes the
 * kit's size whose design speeds hold the speed the bot arrives with, and is moved back from
 * the edge until the bot lands it clean. The bot rides straight and can't ride pipe airs, so
 * the banks, the mounds and the bowl are placed, not checked.
 */
import { writeFileSync } from 'node:fs';
import { GEN } from '../src/gen/config.ts';
import { footprint, overlaps, type Footprint } from '../src/gen/footprint.ts';
import type { Size } from '../src/gen/kit.ts';
import { group, redesign, type Kind } from '../src/gen/lines.ts';
import { checkLines, failed, type FeatureCheck } from '../src/park/check.ts';
import { toSlopeConfig, type FeatureSpec, type Layout, type LineSpec } from '../src/park/layout.ts';
import * as dm from '../src/sim/dmath.ts';
import { buildField, type FieldConfig, type PatchConfig } from '../src/sim/heightfield.ts';
import { params } from '../src/sim/params.ts';
import { createRng, next } from '../src/sim/rng.ts';
import { createContact, createSlope, type Terrain } from '../src/sim/terrain.ts';

const RAD = Math.PI / 180;

type Slot = {
  kind: Kind | 'panel' | 'block';
  at?: number; // m down the deck from where it starts
  edge?: number; // a kicker: m its lip stands back from the deck's edge, at least
  dx?: number; // m across from the lane's centre
  size?: Size; // a hip's size (kickers take the size the bot's speed asks for)
  yaw?: number; // ° off the fall line
  inputs?: Record<string, number>; // the kit's inputs by name; left out, the middle of its range
  cfg?: Record<string, number>; // panel, block: their own numbers
  free?: boolean; // placed, not on the bot's line
};
type Tier = { face: number; on: Slot[] }; // face: m the tier's face drops

const FLOW = {
  length: 640, // m down the hill
  width: 250, // m across, banks included
  pitch: 8.5, // ° overall: what a rider who never brakes can hold through the features
  cell: 1, // m between heightfield nodes
  bank: { width: 62, height: 24 }, // the valley's sides: 24 m up over 62 m, steepening to ~38° at the top
  noise: { amp: 0.7, wavelength: 48, octaves: 2 }, // m of roll in the ground everywhere
  top: { length: 18, pitch: 16 }, // the drop-in
  bottom: { length: 86, pitch: 1 }, // the bowl
  start: -4, // z the rider spawns at
  // A tier: a deck at `deck`° as long as it takes to give back its face (at `facePitch`°) against
  // the hill's pitch. `blend` m is how round a deck's edge is; `edge` m how far a lane fades out sideways.
  lane: { first: -26, halfWidth: 12, edge: 14, blend: 5, deck: 3, facePitch: 32 },
  lanes: [
    {
      name: 'wall line',
      x: -42,
      tiers: [
        { face: 3, on: [{ kind: 'rail', at: 8, inputs: { box: 1, flatDown: 0, length: 10, height: 0.4 } }] },
        { face: 5, on: [{ kind: 'jibTable', at: 6, inputs: { box: 0, deck: 16, railLength: 10, railHeight: 0.4 } }] },
        { face: 4, on: [{ kind: 'panel', at: 8, dx: -4, cfg: { length: 20, height: 2.8, lean: 8, foot: 0.5, rampLength: 3 } }] },
        { face: 7, on: [{ kind: 'roller', at: 6, inputs: { height: 1.2, length: 12, width: 16 } }, { kind: 'kicker', edge: 2 }] },
        { face: 5, on: [{ kind: 'roller', at: 22, inputs: { height: 1.3, length: 14, width: 16 } }] },
        { face: 8, on: [{ kind: 'kicker', edge: 2 }] },
        { face: 6, on: [{ kind: 'roller', at: 20, inputs: { height: 1.4, length: 14, width: 16 } }] },
        { face: 8, on: [{ kind: 'kicker', edge: 2 }] },
      ],
    },
    {
      name: 'transition line',
      x: 0,
      tiers: [
        { face: 3, on: [{ kind: 'rail', at: 8, inputs: { box: 1, flatDown: 1, length: 12, height: 0.4 } }] },
        { face: 4, on: [{ kind: 'funBox', at: 10, inputs: { top: 7, height: 1.5, faceAngle: 20, width: 9 } }] },
        { face: 5, on: [{ kind: 'roller', at: 6, inputs: { height: 1.0, length: 12, width: 16 } }, { kind: 'roller', at: 22, inputs: { height: 1.2, length: 12, width: 16 } }] },
        { face: 7, on: [{ kind: 'roller', at: 8, inputs: { height: 1.2, length: 12, width: 16 } }, { kind: 'kicker', edge: 2 }] },
        // No kicker here: the deck's edge is the takeoff, a drop onto the face.
        { face: 7, on: [{ kind: 'roller', at: 22, inputs: { height: 1.4, length: 14, width: 16 } }, { kind: 'roller', at: 38, inputs: { height: 1.4, length: 14, width: 16 } }] },
        { face: 7, on: [{ kind: 'kicker', edge: 2 }] },
        { face: 6, on: [{ kind: 'kicker', edge: 2 }] },
        { face: 7, on: [{ kind: 'roller', at: 30, inputs: { height: 1.4, length: 14, width: 16 } }] },
        { face: 7, on: [{ kind: 'kicker', edge: 2 }] },
      ],
    },
    {
      name: 'jump line',
      x: 42,
      tiers: [
        { face: 3, on: [{ kind: 'rail', at: 8, inputs: { box: 1, flatDown: 0, length: 10, height: 0.4 } }] },
        { face: 4, on: [{ kind: 'rail', at: 12, inputs: { box: 0, flatDown: 0, length: 10, height: 0.45 } }] },
        { face: 5, on: [{ kind: 'kicker', edge: 2 }] },
        { face: 6, on: [{ kind: 'kicker', edge: 2 }] },
        { face: 7, on: [{ kind: 'kicker', edge: 2 }] },
        { face: 8, on: [{ kind: 'kicker', edge: 2 }] },
        { face: 8, on: [{ kind: 'kicker', edge: 2 }] },
        { face: 8, on: [{ kind: 'kicker', edge: 2 }] },
      ],
    },
  ] as { name: string; x: number; tiers: Tier[] }[],
  // Mounds down the seams between the lanes, and along the foot of each bank: a chain of domes
  // whose feet overlap, alternating size, stepping side to side — no flat ground to cross.
  mounds: [
    { x: -21, from: -60, to: -530, every: 21, sway: 6, height: [1.6, 3.2], radius: [8, 11] },
    { x: 21, from: -70, to: -530, every: 23, sway: 6, height: [1.8, 3.4], radius: [8, 11] },
    { x: -70, from: -50, to: -540, every: 27, sway: 5, height: [2, 3.6], radius: [8, 11] },
    { x: 70, from: -62, to: -540, every: 29, sway: 5, height: [2, 3.6], radius: [8, 11] },
  ],
  // By position (x, z of the kit's place). Wall panels stand on the banks, turned in off the
  // fall line; a hut sits in a seam; the bowl across the bottom ends every lane in a wall.
  extras: [
    { kind: 'panel', x: -78, z: -150, yaw: 20, cfg: { length: 16, height: 3, lean: 12, foot: 0.4, rampLength: 3 } },
    { kind: 'panel', x: 80, z: -250, yaw: -20, cfg: { length: 16, height: 3, lean: 12, foot: 0.4, rampLength: 3, side: -1 } },
    { kind: 'panel', x: -80, z: -380, yaw: 25, cfg: { length: 18, height: 3.2, lean: 12, foot: 0.4, rampLength: 3 } },
    { kind: 'block', x: 21, z: -215, yaw: 12, cfg: { length: 14, width: 6, height: 3.5, rampLength: 12 } },
    { kind: 'quarter', x: -74, z: -470, yaw: -75, inputs: { width: 26, height: 3.5, radius: 4 } },
    { kind: 'quarter', x: 74, z: -430, yaw: 75, inputs: { width: 26, height: 3.5, radius: 4 } },
    { kind: 'quarter', x: -46, z: -596, inputs: { width: 44, height: 4, radius: 4.5 } },
    { kind: 'hipQuarter', x: 6, z: -598, inputs: { left: 0, outside: 0, width: 16, angle: 45, height: 4, radius: 4.5 } },
    { kind: 'quarter', x: 48, z: -596, inputs: { width: 44, height: 4.5, radius: 5 } },
  ] as { kind: Kind | 'panel' | 'block'; x: number; z: number; yaw?: number; inputs?: Record<string, number>; cfg?: Record<string, number> }[],
};

const SIZES: Size[] = ['S', 'M', 'L', 'XL'];
// m further back from the deck's edge an edge kicker is tried at, in order, until the bot lands it clean.
const BACK = [0, 3, 6, 9, 12, 16, 20];
const r2 = (v: number): number => Math.round(v * 100) / 100;
const tan = (deg: number): number => dm.tan(deg * RAD);

/** A lane's tiers as patch segments, and where each deck starts and ends (z). */
function terraces(tiers: Tier[]): { segs: [number, number][]; decks: { start: number; edge: number }[] } {
  const L = FLOW.lane;
  const segs: [number, number][] = [];
  const decks: { start: number; edge: number }[] = [];
  let z = L.first;
  for (const t of tiers) {
    const face = t.face / tan(L.facePitch);
    // The deck gives back what the face takes against the hill's pitch.
    const deck = (face * (tan(L.facePitch) - tan(FLOW.pitch))) / (tan(FLOW.pitch) - tan(L.deck));
    segs.push([deck, L.deck * RAD], [face, L.facePitch * RAD]);
    decks.push({ start: z, edge: z - deck });
    z -= deck + face;
  }
  return { segs, decks };
}

const LANES = FLOW.lanes.map((l) => ({ ...l, ...terraces(l.tiers) }));

function field(): FieldConfig {
  const L = FLOW.lane;
  const patches: PatchConfig[] = [
    { x: 0, z: 0, yaw: 0, halfWidth: FLOW.width, edge: 1, blend: 8, segs: [[FLOW.top.length, FLOW.top.pitch * RAD]] },
    ...LANES.map((l) => ({ x: l.x, z: L.first, yaw: 0, halfWidth: L.halfWidth, edge: L.edge, blend: L.blend, segs: l.segs })),
    { x: 0, z: -(FLOW.length - FLOW.bottom.length), yaw: 0, halfWidth: FLOW.width, edge: 1, blend: 14, segs: [[FLOW.bottom.length + 40, FLOW.bottom.pitch * RAD]] },
  ];
  return { pitch: FLOW.pitch * RAD, width: FLOW.width, length: FLOW.length, cell: FLOW.cell, bankWidth: FLOW.bank.width, bankHeight: FLOW.bank.height, noise: { seed: 1, ...FLOW.noise }, patches };
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
    return [{ kind: 'panel', cfg: { x, z, yaw, length: c.length ?? 20, height: c.height ?? 2.5, lean: (c.lean ?? 8) * RAD, side: c.side === -1 ? -1 : 1, foot: c.foot ?? 0.5, ramp: { height: c.foot ?? 0.5, length: c.rampLength ?? 3 } }, meta: { type: 'wallRide' } }];
  }
  if (kind === 'block') {
    return [{ kind: 'block', cfg: { x, z, yaw, length: c.length ?? 14, width: c.width ?? 6, height: c.height ?? 3.5, ramp: { length: c.rampLength ?? 12 } }, meta: { type: 'hut' } }];
  }
  const speed = kind === 'hip' || kind === 'stepDownHip' ? GEN.hip.sizes[size].speed : kind === 'kicker' ? GEN.kicker.sizes[size].speed : [0, 99];
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

/** Adds an obstacle's parts. `clear`: it may not stand on another (mounds and banks may run into each other). */
function push(name: string, parts: FeatureSpec[], clear: boolean): number {
  const at = features.length;
  group(parts, at);
  for (const p of parts) {
    const print = footprint(p, 0, 0);
    if (clear) for (const o of prints) if (o.name !== name && overlaps(o.print, print)) problems.push(`${name} overlaps ${o.name}`);
    if (clear) prints.push({ name, print });
  }
  features.push(...parts);
  return at;
}

const lipRun = (size: Size): number => {
  const a = GEN.kicker.lipAngle * RAD;
  return (GEN.kicker.sizes[size].lip / (1 - dm.cos(a))) * dm.sin(a);
};
const good = (c: FeatureCheck): number => (c.ok ? 0 : 4) + (c.how === 'clean' || c.how === 'rode' || c.how === 'railed' || c.how === 'none' ? 0 : c.how === 'sketchy' ? 1 : 8);

// Mounds first, so the lanes are solved on the ground as it will be: domes down each seam, their size, spacing and side-step drawn from a fixed seed.
const rng = createRng(7);
for (const m of FLOW.mounds) {
  for (let z = m.from; z >= m.to; z -= m.every * (0.6 + 0.9 * next(rng))) {
    const x = r2(m.x + (next(rng) * 2 - 1) * m.sway);
    const size = next(rng);
    const [h0 = 2, h1 = 3] = m.height;
    const [r0 = 8, r1 = 11] = m.radius;
    const parts = make('knoll', x, r2(z), 0, 'S', { height: r2(h0 + (h1 - h0) * size), radius: r2(r0 + (r1 - r0) * size), back: r2(0.6 + 0.35 * next(rng)) }, {});
    for (const p of parts) p.meta = { ...(p.meta ?? { type: 'knoll' }), fill: true };
    push(`mound at x ${x} z ${z.toFixed(0)}`, parts, false);
  }
}

for (const L of LANES) {
  const line: LineSpec = { name: L.name, features: [], speed: [] };
  const arrive = (parts: FeatureSpec[]): FeatureCheck | undefined => {
    const got = rideLine([...features, ...parts], { ...line, features: [...line.features, features.length] }).at(-1);
    return got && got.feature === features.length ? got : undefined;
  };
  L.tiers.forEach((tier, ti) => {
    const deck = L.decks[ti];
    if (!deck) return;
    for (const s of tier.on) {
      const x = L.x + (s.dx ?? 0);
      const label = `${L.name} tier ${ti + 1}: ${s.kind}`;
      let parts: FeatureSpec[] = [];
      if (s.kind === 'kicker' && s.edge !== undefined) {
        // At the deck's edge, landing on the face below. Its size is the biggest whose design
        // speeds hold the speed the bot gets there with; then back from the edge until it lands clean.
        let best: { parts: FeatureSpec[]; score: number } | undefined;
        for (const back of BACK) {
          let size: Size = 'M';
          let got: FeatureCheck | undefined;
          let tryParts: FeatureSpec[] = [];
          for (let it = 0; it < 3; it++) {
            tryParts = make('kicker', x, r2(deck.edge + s.edge + back + lipRun(size)), 0, size, {}, {});
            got = arrive(tryParts);
            if (!got) break;
            const at = got.at;
            // Faster than the biggest is made for: the biggest, and the check reports it.
            const want = SIZES.filter((k) => at >= (GEN.kicker.sizes[k].speed[0] ?? 0) && at <= (GEN.kicker.sizes[k].speed[1] ?? 0)).at(-1) ?? (at > 18 ? 'XL' : undefined);
            if (!want || want === size) break;
            size = want;
          }
          if (!got) continue;
          const score = good(got);
          if (!best || score < best.score) best = { parts: tryParts, score };
          if (score === 0) break;
        }
        if (!best) {
          problems.push(`${label}: the bot never got here`);
          continue;
        }
        parts = best.parts;
      } else {
        parts = make(s.kind, x, r2(deck.start - (s.at ?? 0)), s.yaw ?? 0, s.size ?? 'S', s.inputs ?? {}, s.cfg ?? {});
        if (parts.length === 0) {
          problems.push(`${label}: the kit built nothing here`);
          continue;
        }
      }
      const at = push(label, parts, true);
      if (!s.free) {
        line.features.push(at);
        line.speed.push(0);
      }
    }
  });
  lines.push(line);
}

for (const e of FLOW.extras) {
  const parts = make(e.kind, e.x, e.z, e.yaw ?? 0, 'S', e.inputs ?? {}, e.cfg ?? {});
  for (const p of parts) p.meta = { ...(p.meta ?? { type: p.kind }), fill: true };
  push(`${e.kind} at x ${e.x} z ${e.z}`, parts, e.kind !== 'panel');
}

// The finished park, every lane ridden top to bottom without braking.
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
