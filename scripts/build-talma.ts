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
import { designBerm, designHipQuarter, designKicker, designWallRide, type ArcCheck } from '../src/gen/kit.ts';
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
  terrace: { start: -40, count: 10, deck: 25, deckPitch: 2, dropPitch: 30, blend: 2, edge: 6 },
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
  // Rail lines, one rail per terrace (index), segments in m along the rail: 'down' follows a
  // drop (its angle searched so the rail stays near `rail.height` above the snow), 'flat'
  // follows a deck. The rainbow sits mid-deck between two snow ramps.
  rail: { height: 0.5, band: [0.4, 0.6], downAngle: [24, 40], dropAngle: 30 }, // dropAngle: ° a drop shaped to a rail is built at
  rail1: [
    { terrace: 1, segs: [['down', 7]] }, // straight down rail
    { terrace: 3, segs: [['flat', 3], ['down', 5]] }, // flat-down, kinked at the deck edge
    { terrace: 5, rainbow: { length: 6, rise: 0.65, ramp: 0.5, end: 0.3 } },
  ],
  rail2: [
    { terrace: 2, segs: [['down', 6], ['flat', 1.75]] }, // down rail with a flat end
    { terrace: 4, segs: [['down', 4], ['flat', 2], ['down', 5]] }, // down-flat-down
    { terrace: 6, segs: [['flat', 3], ['down', 5], ['flat', 3]] }, // flat-down-flat
  ],
  // Wall and bank line, below the jump line (it ends at z −234), on its x. z where each starts.
  lower: {
    wall: { z: -248, length: 24, height: 3, angle: 75, radius: 2.5 }, // on the lifts' side (−X)
    berm: { z: -280, radius: 16, sweep: 35, bank: 38, height: 3, gap: 6 }, // two, an S: toward −X, then back — centred on the line, so you come out where you went in
    hipQuarter: { z: -342, width: 12, angle: 45, height: 3.5, radius: 4, corner: 3 }, // corner m to +X of the jump line: out of the S (~2 m left) or straight down it, you ride up the first section near the corner
  },
} as const;

type RailPlan = { terrace: number; segs?: readonly (readonly ['down' | 'flat', number])[]; rainbow?: { length: number; rise: number; ramp: number; end: number } };

/**
 * One rail line's terraces. Every terrace is `period` m long and drops what the base grade
 * does over it, so decks line up across lines. A plain terrace is a deck at `deckPitch` then a
 * drop at `dropPitch`; one carrying a rail has its drop shaped to the rail instead — its
 * 'down' segments at `rail.dropAngle`, a bench for a 'flat' between them — and its deck takes
 * whatever height is left.
 */
function lineTerraces(plans: readonly RailPlan[]): { segs: [number, number][]; deckLength: number[]; dropLength: number[] } {
  const t = TALMA.terrace;
  const base = dm.tan(TALMA.pitch * RAD);
  const plainDrop = (t.deck * (base - dm.tan(t.deckPitch * RAD))) / (dm.tan(t.dropPitch * RAD) - base);
  const period = t.deck + plainDrop;
  const segs: [number, number][] = [];
  const deckLength: number[] = [];
  const dropLength: number[] = [];
  for (let i = 0; i < t.count; i++) {
    const plan = plans.find((p) => p.terrace === i);
    const shaped = plan?.segs?.some(([k]) => k === 'down');
    if (!plan || !shaped) {
      segs.push([t.deck, t.deckPitch * RAD], [plainDrop, t.dropPitch * RAD]);
      deckLength.push(t.deck);
      dropLength.push(plainDrop);
      continue;
    }
    // The drop: from the first 'down' to the last, flats between them as benches.
    const parts = plan.segs ?? [];
    const first = parts.findIndex(([k]) => k === 'down');
    let last = first;
    parts.forEach(([k], j) => (k === 'down' ? (last = j) : 0));
    const drop: [number, number][] = [];
    for (let j = first; j <= last; j++) {
      const [k, len] = parts[j] ?? ['flat', 0];
      const ang = (k === 'down' ? TALMA.rail.dropAngle : t.deckPitch) * RAD;
      drop.push([len * dm.cos(ang), ang]);
    }
    let dropRun = 0;
    let dropFall = 0;
    for (const [len, ang] of drop) {
      dropRun += len;
      dropFall += len * dm.tan(ang);
    }
    const deck = period - dropRun;
    const deckPitch = dm.atan2(period * base - dropFall, deck);
    segs.push([deck, deckPitch], ...drop);
    deckLength.push(deck);
    dropLength.push(dropRun);
  }
  return { segs, deckLength, dropLength };
}

const LINE1 = lineTerraces(TALMA.rail1);
const LINE2 = lineTerraces(TALMA.rail2);

function field(): FieldConfig {
  const T = TALMA;
  const t = T.terrace;
  const half = (T.x.rail2 - T.x.rail1) / 2 - t.edge / 2;
  const patches: PatchConfig[] = [
    { x: 0, z: 0, yaw: 0, halfWidth: T.width, edge: 1, blend: 10, segs: [[T.top.length, T.top.pitch * RAD]] },
    { x: T.x.rail1, z: t.start, yaw: 0, halfWidth: half, edge: t.edge, blend: t.blend, segs: LINE1.segs },
    { x: T.x.rail2, z: t.start, yaw: 0, halfWidth: half, edge: t.edge, blend: t.blend, segs: LINE2.segs },
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

/** Where the deck of terrace `i` starts (z, downhill negative); the same on every line. */
export function terraceAt(i: number): { deck: number } {
  const t = TALMA.terrace;
  const base = dm.tan(TALMA.pitch * RAD);
  const plainDrop = (t.deck * (base - dm.tan(t.deckPitch * RAD))) / (dm.tan(t.dropPitch * RAD) - base);
  return { deck: t.start - i * (t.deck + plainDrop) };
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
    const lz = lips[next];
    // Charge and release just before the lip, as scripts/talma-check.ts does.
    const time = lz === undefined ? 99 : (s.position.z - lz) / Math.max(1, -s.velocity.z);
    if (s.mode === 'grounded' && time < params.pop.chargeTime + 0.05 && time > 0.02) inp.rt = 1;
    const was = s.mode;
    const z0 = s.position.z;
    const speed = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
    if (lz !== undefined && z0 > lz && s.mode === 'grounded') out.lip[next] = speed; // the last run-in speed short of the lip, not the pop
    tick(s, inp, params, t, TICK_DT);
    if (z0 > at && s.position.z <= at) out.at = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
    if (lz !== undefined && was === 'grounded' && s.mode === 'airborne' && s.position.z < lz + 3) flying = next++;
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


/**
 * A rail from segments over its terrace: every start (from the deck's middle to the drop's foot)
 * and every down angle is tried; kept is the one whose height above the snow, sampled every
 * 0.25 m, strays least from `rail.height`. Points carry their height above the snow there.
 */
function placeRail(features: FeatureSpec[], x: number, plan: RailPlan, terr: ReturnType<typeof lineTerraces>): { spec: FeatureSpec; low: number; high: number } {
  const t = terrainOf(features);
  const c = createContact();
  const h = (z: number): number => t.sample(x, z, c).height;
  const dropZ = terraceAt(plan.terrace).deck - (terr.deckLength[plan.terrace] ?? 0);
  const dropRun = terr.dropLength[plan.terrace] ?? 0;
  const R = TALMA.rail;
  let best: { pts: [number, number, number][]; err: number; low: number; high: number } | undefined;
  for (let z0 = dropZ + 12; z0 >= dropZ - dropRun; z0 -= 0.25) {
    for (let a = R.downAngle[0]; a <= R.downAngle[1]; a += 1) {
      const pts: [number, number, number][] = [[x, 0, z0]];
      let y = h(z0) + R.height;
      let z = z0;
      let low = Infinity;
      let high = -Infinity;
      for (const [kind, len] of plan.segs ?? []) {
        const ang = kind === 'down' ? a * RAD : dm.atan2(h(z) - h(z - len), len); // a flat follows the snow under it
        const dz = len * dm.cos(ang);
        const dy = len * dm.sin(ang);
        for (let u = 0.25; u <= dz; u += 0.25) {
          const above = y - dy * (u / dz) - h(z - u);
          low = Math.min(low, above);
          high = Math.max(high, above);
        }
        z -= dz;
        y -= dy;
        pts.push([x, 0, z]);
      }
      const err = Math.max(R.height - low, high - R.height);
      if (!best || err < best.err) {
        // Heights above the snow at each point, as RailConfig wants them.
        let wy = h(z0) + R.height;
        let wz = z0;
        const out: [number, number, number][] = [[x, R.height, z0]];
        for (const [kind, len] of plan.segs ?? []) {
          const ang = kind === 'down' ? a * RAD : dm.atan2(h(z) - h(z - len), len); // a flat follows the snow under it
          wz -= len * dm.cos(ang);
          wy -= len * dm.sin(ang);
          out.push([x, r2(wy - h(wz)), r2(wz)]);
        }
        out[0] = [x, R.height, r2(z0)];
        best = { pts: out, err, low, high };
      }
    }
  }
  if (!best) throw new Error('no rail');
  return { spec: { kind: 'rail', cfg: { points: best.pts }, meta: { type: 'rail', speed: [...GEN.lines.railSpeed] as [number, number] } }, low: best.low, high: best.high };
}

/** A rainbow mid-deck: an arc from ramp to ramp, the ramps (rollers) built first so its ends sit on them. */
function placeRainbow(x: number, plan: RailPlan, terr: ReturnType<typeof lineTerraces>): FeatureSpec[] {
  const rb = plan.rainbow;
  if (!rb) return [];
  const deck = terraceAt(plan.terrace).deck;
  const mid = deck - (terr.deckLength[plan.terrace] ?? 0) / 2;
  const top = mid + rb.length / 2;
  const bottom = mid - rb.length / 2;
  const ramp = (zc: number): FeatureSpec => ({ kind: 'shape', cfg: { kind: 'roller', x, z: zc + 2, yaw: 0, height: rb.ramp, length: 4, width: 2.5, taper: 1 } });
  const ramps = [ramp(top), ramp(bottom)];
  const t = terrainOf([...features, ...ramps]);
  const c = createContact();
  const h = (z: number): number => t.sample(x, z, c).height;
  // The arc in the world: from end to end at ramp height plus `end`, rising `rise` in the middle.
  const y0 = h(top) + rb.end;
  const y1 = h(bottom) + rb.end;
  const pts: [number, number, number][] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const z = top - rb.length * u;
    const y = y0 + (y1 - y0) * u + rb.rise * dm.sin(Math.PI * u);
    pts.push([x, r2(y - h(z)), r2(z)]);
  }
  return [...ramps, { kind: 'rail', cfg: { points: pts }, meta: { type: 'rainbow', speed: [...GEN.lines.railSpeed] as [number, number] } }];
}

// Rail lines: built after the jumps (nothing overlaps), each rail measured on the terrain as built.
const railLines: LineSpec[] = [];
const railReport: string[] = [];
for (const [name, x, plans, terr] of [
  ['rail line 1', TALMA.x.rail1, TALMA.rail1, LINE1],
  ['rail line 2', TALMA.x.rail2, TALMA.rail2, LINE2],
] as [string, number, readonly RailPlan[], ReturnType<typeof lineTerraces>][]) {
  const line: LineSpec = { name, features: [], speed: [] };
  for (const plan of plans) {
    if (plan.rainbow) {
      const parts = placeRainbow(x, plan, terr);
      features.push(...parts);
      line.features.push(features.length - 1);
      railReport.push(`${name} terrace ${plan.terrace}: rainbow ${plan.rainbow.length} m, rise ${plan.rainbow.rise} m on ${plan.rainbow.ramp} m ramps`);
    } else {
      const r = placeRail(features, x, plan, terr);
      features.push(r.spec);
      line.features.push(features.length - 1);
      const segs = (plan.segs ?? []).map(([k, l]) => `${k} ${l}`).join(' / ');
      railReport.push(`${name} terrace ${plan.terrace}: ${segs} — ${r.low.toFixed(2)}–${r.high.toFixed(2)} m above the snow`);
    }
    line.speed.push(0);
  }
  railLines.push(line);
}

// Wall and bank line, on the open lower hill below the jump line: a wall ride on the lifts'
// side, an S of two berms, and a hip quarter at the bottom — milestone 6's features in one
// line ridden straight off the end of the jumps. Fixed sizes through the generator's own kit.
const LOWER = TALMA.lower;
const fixed = (inputs: Record<string, number>) => ({ inputs });
const lowerStart = features.length;
features.push(...designWallRide({ x: TALMA.x.jump, z: LOWER.wall.z, yaw: 0 }, fixed({ left: 1, length: LOWER.wall.length, height: LOWER.wall.height, angle: LOWER.wall.angle, radius: LOWER.wall.radius }), GEN));
// The berms: the first turns toward the lifts (−X), the second back again. Where the first's
// arc ends and which way it then heads (yaw = −sweep), the second starts, `gap` m on.
const bermIn = { left: 1, radius: LOWER.berm.radius, sweep: LOWER.berm.sweep, bank: LOWER.berm.bank, height: LOWER.berm.height };
const phi = LOWER.berm.sweep * RAD;
// The S shifts you 2·r(1 − cos φ) + gap·sin φ toward −X: start half that to +X of the line so
// it's centred on it, and you leave the second berm as far left of the line as you entered right.
const shift = 2 * LOWER.berm.radius * (1 - dm.cos(phi)) + LOWER.berm.gap * dm.sin(phi);
const b1x = TALMA.x.jump + shift / 2;
const b1z = LOWER.berm.z;
const endX = b1x - LOWER.berm.radius * (1 - dm.cos(phi)) - LOWER.berm.gap * dm.sin(phi);
const endZ = b1z - LOWER.berm.radius * dm.sin(phi) - LOWER.berm.gap * dm.cos(phi);
features.push(...designBerm({ x: b1x, z: b1z, yaw: 0 }, fixed(bermIn), GEN));
features.push(...designBerm({ x: endX, z: endZ, yaw: -phi }, fixed({ ...bermIn, left: 0 }), GEN));
// Back on the fall line after the second berm, and into the hip quarter's first section near
// its corner: an inside corner, the bowl corner that transfers.
features.push(...designHipQuarter({ x: TALMA.x.jump + LOWER.hipQuarter.corner, z: LOWER.hipQuarter.z, yaw: 0 }, fixed({ left: 0, outside: 0, width: LOWER.hipQuarter.width, angle: LOWER.hipQuarter.angle, height: LOWER.hipQuarter.height, radius: LOWER.hipQuarter.radius }), GEN));
// The line the check bot rides ends at the hip quarter's first section: the air across to the
// second is a transfer it can't ride (it doesn't turn to meet the face, and bails most pipe airs).
const lowerIdx = features.slice(lowerStart, -1).map((_, i) => lowerStart + i);
const lowerLine: LineSpec = { name: 'wall and bank line', features: lowerIdx, speed: lowerIdx.map(() => 0) };

const layout: Layout = { version: 1, name: 'talma', ground, spawn, features, lines: [jumpLine, ...railLines, lowerLine], links: [] };

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
for (const r of railReport) console.log(r);
