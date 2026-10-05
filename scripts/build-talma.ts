/**
 * The Talma-style reference park (docs/talma-reference-park.md), built as a layout:
 * `node scripts/build-talma.ts` writes parks/talma-reference.json, which the game loads as its
 * default park. Every number is in TALMA below; the script only places and solves. Left to
 * right as you ride down (+X is the rider's right): groomed run, lifts, jump line, rail line 1,
 * rail line 2.
 */
import { writeFileSync } from 'node:fs';
import { TICK_DT } from '../src/core/loop.ts';
import { GEN, type GenConfig } from '../src/gen/config.ts';
import { fly, launch, popRange } from '../src/gen/flight.ts';
import { footprint } from '../src/gen/footprint.ts';
import { designKicker, type ArcCheck } from '../src/gen/kit.ts';
import { neutralInput } from '../src/input/snapshot.ts';
import { toSlopeConfig, type FeatureSpec, type Layout, type LineSpec } from '../src/park/layout.ts';
import * as dm from '../src/sim/dmath.ts';
import type { FieldConfig, PatchConfig } from '../src/sim/heightfield.ts';
import { params } from '../src/sim/params.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState } from '../src/sim/state.ts';
import { createContact, createSlope, type KickerConfig } from '../src/sim/terrain.ts';

const RAD = Math.PI / 180;

const TALMA = {
  length: 400, // m down the hill
  width: 110, // m across, banks included
  pitch: 9, // ° base grade: the jump line and the groomed run ride on it
  cell: 1, // m between heightfield nodes: terrace knuckles need it fine
  bank: { width: 10, height: 3 },
  top: { length: 30, pitch: 4 }, // flatter strip at the start, full width
  bottom: { length: 35, pitch: 3 }, // run-out at the bottom, full width
  x: { groomed: -30, lifts: -8, jump: 3, rail1: 22.5, rail2: 37.5 }, // m, line centres
  // Rail lines: terraces — near-flat decks, steep drops. Each drop is as long as it takes to
  // give back what its deck saves against the base grade, so the terraces end level with it.
  terrace: { start: -40, count: 10, deck: 25, deckPitch: 2, dropPitch: 30, blend: 4, halfWidth: 13, edge: 8 },
  // Jump line: split kickers, the big takeoff on the lifts' side and the small one touching it
  // on the rails' side, landing on one shared landing. Lips (m) from the doc; tables are solved.
  jumps: [
    { big: 1.5, small: 0.8 },
    { big: 1.8, small: 1.0 },
    { big: 2.2, small: 1.0 },
  ],
  firstDeck: 2, // terrace whose deck the first lip sits at the start of; decks line up across lines
  spacing: 35, // m at least from one landing's end to the next lip (doc: 25–40)
  bigWidth: 5, // m of takeoff
  smallWidth: 3.5,
  // Design speeds round the speed a rider carries to the lip without braking: the big takeoff
  // from that −3 to +0.5 m/s; the small one is for riders who scrub, 2.5–6 m/s under it.
  bigRange: [-3, 0.5],
  smallRange: [-6, -2.5],
  smallClear: 1, // m the slowest small air (no pop) clears the knuckle by
};

function field(): FieldConfig {
  const T = TALMA;
  const base = dm.tan(T.pitch * RAD);
  const t = T.terrace;
  const deckGrade = dm.tan(t.deckPitch * RAD);
  const dropGrade = dm.tan(t.dropPitch * RAD);
  const drop = (t.deck * (base - deckGrade)) / (dropGrade - base);
  const segs: [number, number][] = [];
  for (let i = 0; i < t.count; i++) segs.push([t.deck, t.deckPitch * RAD], [drop, t.dropPitch * RAD]);
  const patches: PatchConfig[] = [
    { x: 0, z: 0, yaw: 0, halfWidth: T.width, edge: 1, blend: 10, segs: [[T.top.length, T.top.pitch * RAD]] },
    { x: (T.x.rail1 + T.x.rail2) / 2, z: t.start, yaw: 0, halfWidth: t.halfWidth, edge: t.edge, blend: t.blend, segs },
    { x: 0, z: -(T.length - T.bottom.length), yaw: 0, halfWidth: T.width, edge: 1, blend: 10, segs: [[T.bottom.length + 40, T.bottom.pitch * RAD]] },
  ];
  return {
    pitch: T.pitch * RAD,
    width: T.width,
    length: T.length,
    cell: T.cell,
    bankWidth: T.bank.width,
    bankHeight: T.bank.height,
    noise: { seed: 1, amp: 0, wavelength: 50, octaves: 0 },
    patches,
  };
}

/** Where the deck of terrace `i` starts, and the drop after it (z, downhill negative). */
export function terraceAt(i: number): { deck: number; drop: number; dropLength: number } {
  const t = TALMA.terrace;
  const base = dm.tan(TALMA.pitch * RAD);
  const dropLength = (t.deck * (base - dm.tan(t.deckPitch * RAD))) / (dm.tan(t.dropPitch * RAD) - base);
  const deck = t.start - i * (t.deck + dropLength);
  return { deck, drop: deck - t.deck, dropLength };
}

const f = field();
const ground = { length: TALMA.length, width: TALMA.width, pitch: f.pitch, field: f };
const spawn = { x: TALMA.x.jump, z: -5, heading: Math.PI };
const g = params.world.gravity;
const [popMin, popMax] = popRange(params);
const popMid = (popMin + popMax) / 2;
const RUN_IN = (h: number): number => (h / (1 - dm.cos(GEN.kicker.lipAngle * RAD))) * dm.sin(GEN.kicker.lipAngle * RAD);

/** The park so far, as terrain. */
const terrainOf = (features: FeatureSpec[]) =>
  createSlope(toSlopeConfig({ version: 1, name: 'talma', ground, spawn, features, lines: [], links: [] }));

/**
 * The sim's rider from the spawn straight down x, never braking, popping (full charge) at
 * each lip in `lips`: the speed it takes off each one at, how it lands, and its speed passing `at`.
 */
function ride(features: FeatureSpec[], x: number, lips: number[], at: number): { lip: number[]; landing: string[]; at: number } {
  const t = terrainOf(features);
  const c = createContact();
  const s = createRiderState({ position: { x, y: t.sample(x, spawn.z, c).height + 0.05, z: spawn.z }, heading: Math.PI });
  const out = { lip: lips.map(() => 0), landing: lips.map(() => ''), at: 0 };
  let next = 0;
  let flying = -1;
  for (let i = 0; i < 120 * 90 && s.position.z > -TALMA.length; i++) {
    const inp = neutralInput();
    const v = Math.max(1, -s.velocity.z);
    const lz = lips[next];
    if (lz !== undefined && s.mode === 'grounded' && (s.position.z - lz) / v < params.pop.chargeTime + 0.05 && s.position.z > lz) inp.rt = 1;
    const was = s.mode;
    const z0 = s.position.z;
    const before = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z); // the pop is not run-in speed
    tick(s, inp, params, t, TICK_DT);
    if (z0 > at && s.position.z <= at) out.at = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
    if (lz !== undefined && was === 'grounded' && s.mode === 'airborne' && Math.abs(s.position.z - lz) < 3) {
      out.lip[next] = before;
      flying = next++;
    }
    if (flying >= 0 && was === 'airborne' && s.mode !== 'airborne') {
      out.landing[flying] = s.landing;
      flying = -1;
    }
  }
  return out;
}

/** The kicker config with one size preset replaced, so designKicker builds the doc's lip at our speeds. */
function withSize(lip: number, speed: [number, number]): GenConfig {
  return { ...GEN, kicker: { ...GEN.kicker, sizes: { ...GEN.kicker.sizes, S: { lip, speed } } } } as GenConfig;
}

/**
 * The small takeoff of a split: the big one's landing (same knuckle line, height, angle and
 * radii), its own lower lip, as close to the knuckle as lets its slowest air (no pop) clear it.
 */
function smallTakeoff(features: FeatureSpec[], big: KickerConfig, docLip: number, speed: [number, number]): FeatureSpec {
  const W = TALMA;
  let lip = docLip;
  let runIn = RUN_IN(lip);
  const bigRunIn = RUN_IN(big.lipHeight);
  const knuckleZ = big.z - bigRunIn - big.deckLength; // where the shared landing starts
  const x = big.x + (W.bigWidth + W.smallWidth) / 2;
  const build = (deck: number): KickerConfig => ({
    x,
    z: knuckleZ + runIn + deck,
    width: W.smallWidth,
    lipHeight: lip,
    lipAngle: big.lipAngle,
    deckLength: deck,
    knuckleHeight: big.knuckleHeight,
    sideTaper: big.sideTaper,
    deckWidth: W.smallWidth + 2,
    deckTaper: big.deckTaper,
    landingAngle: big.landingAngle,
    knuckleRadius: big.knuckleRadius,
    runoutRadius: big.runoutRadius,
  });
  const air = (kc: KickerConfig, v: number, pop: number) => {
    const t = terrainOf([...features, { kind: 'kicker', cfg: kc }]);
    const lz = kc.z - runIn + 0.02;
    const l = launch(t, x, lz, 0, -1, v, pop);
    const fl = fly(t, params, x, l.y, lz, l.vx, l.vy, l.vz, 6, false);
    return { grade: fl.grade, impact: fl.impact, past: knuckleZ - fl.z };
  };
  // Longest gap whose slowest air still clears the knuckle; if none does, a higher lip.
  let deck = 0;
  for (; lip <= big.lipHeight && deck === 0; lip = r2(lip + 0.1)) {
    runIn = RUN_IN(lip);
    for (let d = 1; d <= big.deckLength; d += 0.25) {
      if (air(build(d), speed[0], popMin).past < W.smallClear) break;
      deck = d;
    }
    if (deck > 0) break;
  }
  if (deck === 0) throw new Error(`no small takeoff clears the knuckle at ${speed[0]} m/s`);
  const cfg = build(deck);
  const checks: ArcCheck[] = [];
  for (const [v, pop] of [
    [speed[0], popMin],
    [(speed[0] + speed[1]) / 2, popMid],
    [speed[1], popMid],
    [speed[1], popMax],
  ] as [number, number][]) {
    const a = air(cfg, v, pop);
    checks.push({ speed: v, pop, grade: a.grade, impact: a.impact, past: a.past });
  }
  return { kind: 'kicker', cfg, meta: { type: 'kicker', size: 'split-small', speed, lip: runIn, checks } };
}

function terraceDecks(): number[] {
  const out: number[] = [];
  for (let i = 0; i < TALMA.terrace.count; i++) out.push(terraceAt(i).deck);
  return out;
}

// The jump line, one split at a time, top down: each sized to the speed the line delivers to it.
const features: FeatureSpec[] = [];
const jumpLine: LineSpec = { name: 'jump line', features: [], speed: [] };
const decks = terraceDecks();
let deckIndex = TALMA.firstDeck;
const bigLips: number[] = [];
const r2 = (v: number): number => Math.round(v * 100) / 100;
for (const j of TALMA.jumps) {
  const lipZ = decks[deckIndex];
  if (lipZ === undefined) throw new Error('ran out of terraces for the jump line');
  const kz = lipZ + RUN_IN(j.big);
  // Design round a guess at the lip speed, ride it, re-centre on what the rider really carries.
  let vLip = ride(features, TALMA.x.jump, bigLips, lipZ).at;
  let big: FeatureSpec | undefined;
  let small: FeatureSpec | undefined;
  for (let it = 0; it < 4; it++) {
    const bigSpeed: [number, number] = [r2(vLip + TALMA.bigRange[0]), r2(vLip + TALMA.bigRange[1])];
    const smallSpeed: [number, number] = [r2(Math.max(5, vLip + TALMA.smallRange[0])), r2(Math.max(6, vLip + TALMA.smallRange[1]))];
    big = designKicker({ x: TALMA.x.jump, z: kz, yaw: 0 }, 'S', TALMA.pitch * RAD, withSize(j.big, bigSpeed), params);
    if (big.kind !== 'kicker') throw new Error('designKicker');
    big.meta = { ...(big.meta ?? { type: 'kicker' }), size: 'split-big' };
    small = smallTakeoff(features, big.cfg, j.small, smallSpeed);
    const v = ride([...features, big, small], TALMA.x.jump, [...bigLips, lipZ], -TALMA.length).lip[bigLips.length] ?? vLip;
    if (Math.abs(v - vLip) < 0.2) break;
    vLip = v;
  }
  if (!big || big.kind !== 'kicker' || !small) throw new Error('no split');
  features.push(big, small);
  bigLips.push(lipZ);
  jumpLine.features.push(features.length - 2);
  jumpLine.speed.push(r2(vLip));
  // Next lip: the first deck at least `spacing` below this landing's end.
  const end = big.cfg.z - footprint(big, 0, 0).s1;
  while ((decks[deckIndex] ?? -Infinity) > end - TALMA.spacing) deckIndex++;
}

const layout: Layout = { version: 1, name: 'talma', ground, spawn, features, lines: [jumpLine], links: [] };

writeFileSync(new URL('../parks/talma-reference.json', import.meta.url), JSON.stringify(layout, null, 1) + '\n');

// Report: each split as designed, and the line ridden without braking.
const check = ride(features, TALMA.x.jump, bigLips, -TALMA.length);
features.forEach((ft, i) => {
  if (ft.kind !== 'kicker') return;
  const k = ft.cfg;
  const m = ft.meta;
  console.log(
    `#${i} ${m?.size} lip ${k.lipHeight} m, gap ${k.deckLength.toFixed(1)} m, knuckle ${(k.knuckleHeight ?? 0).toFixed(2)} m, landing ${(((k.landingAngle ?? 0) / RAD) + TALMA.pitch).toFixed(1)}°, speed ${m?.speed?.join('–')} m/s`,
  );
  for (const c of m?.checks ?? []) console.log(`    ${c.speed.toFixed(1)} m/s pop ${c.pop.toFixed(1)}: ${c.grade}, impact ${c.impact.toFixed(1)}, ${c.past.toFixed(1)} m past the knuckle`);
});
bigLips.forEach((z, i) => {
  const ft = features[jumpLine.features[i] ?? 0];
  const sp = ft?.meta?.speed ?? [0, 0];
  const v = check.lip[i] ?? 0;
  console.log(`jump ${i + 1} lip z ${z.toFixed(1)}: no-brake ${v.toFixed(1)} m/s (design ${sp.join('–')}) ${v >= sp[0] && v <= sp[1] ? 'ok' : 'OUT'}, landed ${check.landing[i] || '-'}`);
});
