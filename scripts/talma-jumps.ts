/**
 * Talma's jump lines on a built ground profile:
 *   node scripts/talma-jumps.ts [in.json] [out.json]      build the park (parks/talma-jumps.json)
 *   node scripts/talma-jumps.ts [in.json] --svg out.svg   draw the big line's side profile only
 *
 * Reads a Talma layout (default parks/talma-reference.json) and replaces its jump line with two
 * lines side by side — big M, L, M and small S, M, S, a pair at each jump — on one strip of shaped
 * earth. The rails, rollers and the other patches are kept.
 *
 * The earth (the sketch: run-in, then per jump a short bench and a steep stretch): a steep roll-in
 * at the top; per jump a near-flat bench just long enough for the takeoff and the table, the snow
 * knuckle rolling over its edge; then a steep earth landing as long as the airs reach, easing into
 * the run-in to the next jump. Bench, landing and run-in together fall as the base grade does, so the strip
 * stays with the slope beside it — no ridge, no trench. The snow kickers are the kit's, solved over
 * that earth. The roll-in's length is solved so the big line reaches the first lip at `aim`
 * straight-lining, each run-in's length (and with it its grade) so it reaches the next.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { GEN } from '../src/gen/config.ts';
import { designKicker, type Size } from '../src/gen/kit.ts';
import { checkLines } from '../src/park/check.ts';
import { toSlopeConfig, type FeatureSpec, type Layout } from '../src/park/layout.ts';
import type { PatchConfig } from '../src/sim/heightfield.ts';
import { params } from '../src/sim/params.ts';
import { createContact, createSlope, type KickerConfig, type Terrain } from '../src/sim/terrain.ts';

const RAD = Math.PI / 180;
const args = process.argv.slice(2);
const svgAt = args.indexOf('--svg');
const svg = svgAt >= 0 ? args[svgAt + 1] : undefined;
const files = args.filter((_, i) => svgAt < 0 || (i !== svgAt && i !== svgAt + 1));
const input = files[0] ?? new URL('../parks/talma-reference.json', import.meta.url).pathname;
const output = files[1] ?? new URL('../parks/talma-jumps.json', import.meta.url).pathname;

const PAIRS: { big: Size; small: Size }[] = [
  { big: 'M', small: 'S' },
  { big: 'L', small: 'M' },
  { big: 'M', small: 'S' },
];
const LINES = { big: 19.5, small: 26 }; // m across: the big line on the lift side, the small one beside it toward the rails
const DECK_WIDTH = { big: 7, small: 5 }; // m of table, each fading over DECK_TAPER: neither rider crosses the other's table
const DECK_TAPER = 2;
const TOP = { pitch: 20, blend: 6, spawn: -2, shortest: 10, longest: 100 }; // °, m, z of the start, m
const EARTH = {
  bench: 2, // ° of a bench: near flat
  approach: 4, // m of bench before a takeoff's transition starts
  landing: 20, // ° of the earth under a landing: steep right past the knuckle, as the sketch draws it
  clear: 4, // m of earth landing past where the fastest air comes down
  longest: 120, // m a run-in (the stretch from a landing to the next bench) may run to reach the next jump's speed
  runin: 6, // m of run-in at the least
  halfWidth: 9, // m full height either side of the strip's middle: both tables and their fades
  edge: 4, // m the strip's sides fade over: clear of rail line 1's first rail (x ≈ 36.3)
  blend: 4, // m the grades are eased over
};
const MARGIN = 1; // m/s under the big size's fastest: run-ins built a little fast — speed can be checked, never added
const BOTTOM = { after: 40, runout: 35 }; // m of park past the strip's end; the bottom patch's last stretch
const SOLVE_LENGTH = 900; // m of park while solving

const layout = JSON.parse(readFileSync(input, 'utf8')) as Layout;
const field = layout.ground.field;
if (!field) throw new Error('needs a heightfield ground');
const base = field.pitch;
const tanBase = Math.tan(base);
const strip = (DECK_WIDTH.small / 2 + DECK_TAPER + LINES.small + LINES.big - DECK_WIDTH.big / 2 - DECK_TAPER) / 2;
const keep = layout.features.filter((f) => f.kind !== 'kicker'); // the old jump line's kickers go

/** The speed the big line is built for at a pair's lip: a little under the top of its size's range. */
const aim = (p: (typeof PAIRS)[number]): number => (GEN.kicker.sizes[p.big].speed[1] ?? 0) - MARGIN;

// The big kickers on plain ground: how long a bench each needs, how far its fastest air reaches.
const plain = PAIRS.map((p) => designKicker({ x: 0, z: 0, yaw: 0 }, p.big, base, GEN, params));
const benches = plain.map((f) => EARTH.approach + (f.meta?.lip ?? 0) + (f.cfg as KickerConfig).deckLength);
const landing = plain.map((f) => Math.max(...(f.meta?.checks ?? []).map((c) => c.past)) + EARTH.clear);

/** Lengths solved: the roll-in, and each run-in (the stretch after jump k's landing). */
type Plan = { top: number; steep: number[] };

/** What bench k and its landing hold up against the base grade, m: the run-in after them gives it back. */
const held = (k: number): number => (benches[k] ?? 0) * (tanBase - Math.tan(EARTH.bench * RAD)) + (landing[k] ?? 0) * (tanBase - Math.tan(EARTH.landing * RAD));
/** The run-in `length` m long after jump k: its grade, so bench, landing and run-in fall as the base grade does. */
const steepGrade = (k: number, length: number): number => Math.atan(tanBase + held(k) / length);
/** The shortest run-in after jump k: not under EARTH.runin, nor so short it would have to be flatter than a bench. */
const shortestRunin = (k: number): number => Math.max(EARTH.runin, -held(k) / (tanBase - Math.tan(EARTH.bench * RAD)));

/** The strip as a patch, and where each bench ends (the big table's end, the earth's edge), m along it. */
function stripPatch(plan: Plan): { patch: PatchConfig; edges: number[] } {
  const segs: [number, number][] = [];
  const edges: number[] = [];
  let s = 0;
  PAIRS.forEach((_, k) => {
    const b = benches[k] ?? 20;
    const ld = landing[k] ?? 20;
    const st = plan.steep[k] ?? 20;
    segs.push([b, EARTH.bench * RAD], [ld, EARTH.landing * RAD], [st, steepGrade(k, st)]);
    edges.push(s + b);
    s += b + ld + st;
  });
  return { patch: { x: strip, z: -plan.top, yaw: 0, halfWidth: EARTH.halfWidth, edge: EARTH.edge, blend: EARTH.blend, segs }, edges };
}

const kickerAt = (size: Size, x: number, z: number, ground: Terrain): FeatureSpec => designKicker({ x, z, yaw: 0 }, size, EARTH.bench * RAD, GEN, params, ground);
const lipOf = (f: FeatureSpec): number => (f.cfg as KickerConfig).z - (f.meta?.lip ?? 0);
const endOf = (f: FeatureSpec): number => lipOf(f) - (f.cfg as KickerConfig).deckLength;

/** A pair: the big one's table ending on the earth's edge at `edgeZ`, the small one's lip level with the big one's. */
function pair(p: (typeof PAIRS)[number], edgeZ: number, ground: Terrain): [FeatureSpec, FeatureSpec] {
  let z = edgeZ + 15;
  let big = kickerAt(p.big, LINES.big, z, ground);
  for (let i = 0; i < 3 && Math.abs(endOf(big) - edgeZ) > 0.05; i++) {
    z += edgeZ - endOf(big);
    big = kickerAt(p.big, LINES.big, z, ground);
  }
  let zs = lipOf(big) + 6;
  let small = kickerAt(p.small, LINES.small, zs, ground);
  for (let i = 0; i < 3 && Math.abs(lipOf(small) - lipOf(big)) > 0.05; i++) {
    zs += lipOf(big) - lipOf(small);
    small = kickerAt(p.small, LINES.small, zs, ground);
  }
  Object.assign(big.cfg, { deckWidth: DECK_WIDTH.big, deckTaper: DECK_TAPER });
  Object.assign(small.cfg, { deckWidth: DECK_WIDTH.small, deckTaper: DECK_TAPER });
  if (big.meta) big.meta.type = `kicker ${p.big}`;
  if (small.meta) small.meta.type = `kicker ${p.small}`;
  return [big, small];
}

/** The park on this plan, `length` m long. */
function build(plan: Plan, length = SOLVE_LENGTH): Layout {
  const { patch, edges } = stripPatch(plan);
  // The top full-width patch becomes the roll-in; the bottom one moves to the new end; the old
  // jump line's narrow patches within the strip's reach go, the strip in the first one's place.
  const wide = field.patches.filter((p) => p.halfWidth >= 60);
  const first = wide[0] ?? (field.patches[0] as PatchConfig);
  const topOne = wide.reduce((a, p) => (p.z > a.z ? p : a), first);
  const bottomOne = wide.reduce((a, p) => (p.z < a.z ? p : a), first);
  const reach = EARTH.halfWidth + EARTH.edge;
  const narrowHere = (p: PatchConfig): boolean => p.halfWidth < 20 && Math.abs(p.x - strip) < reach;
  const patches: PatchConfig[] = [];
  let placed = false;
  for (const p of field.patches) {
    if (p === topOne) patches.push({ ...p, z: 0, blend: TOP.blend, segs: [[plan.top, TOP.pitch * RAD]] });
    else if (p === bottomOne) patches.push({ ...p, z: -(length - BOTTOM.runout) });
    else if (narrowHere(p)) {
      if (!placed) patches.push(patch);
      placed = true;
    } else patches.push({ ...p });
  }
  if (!placed) patches.splice(1, 0, patch);
  const next: Layout = { ...layout, ground: { ...layout.ground, length, field: { ...field, length, patches } }, features: [...keep], lines: [], links: [] };
  const ground = createSlope(toSlopeConfig({ ...next, features: [] }));
  const big: number[] = [];
  const small: number[] = [];
  PAIRS.forEach((p, k) => {
    const [b, s] = pair(p, -plan.top - (edges[k] ?? 0), ground);
    big.push(next.features.push(b) - 1);
    small.push(next.features.push(s) - 1);
  });
  next.lines = [
    { name: 'big line', features: big, speed: PAIRS.map(aim) },
    { name: 'small line', features: small, speed: PAIRS.map(aim) },
    ...layout.lines
      .filter((l) => l.name !== 'jump line' && l.name !== 'big line' && l.name !== 'small line')
      .map((l) => ({ ...l, features: l.features.map((i) => layout.features[i]).filter((f): f is FeatureSpec => !!f && f.kind !== 'kicker').map((f) => next.features.indexOf(f)) })),
  ];
  next.spawn = { ...layout.spawn, x: LINES.big, z: TOP.spawn };
  return next;
}

/**
 * Speed at each of the big line's lips, riding straight down it from the start over the snow as
 * it is: from height lost, less friction and drag, as the generator reckons it (no friction in
 * the air, which is short). Smooth in the lengths, so a bisection settles.
 */
function arrivals(l: Layout): number[] {
  const t = createSlope(toSlopeConfig(l));
  const c = createContact();
  const g = params.world.gravity;
  const lips = (l.lines.find((n) => n.name === 'big line')?.features ?? []).map((i) => lipOf(l.features[i] as FeatureSpec));
  const out: number[] = [];
  let v = 2;
  let z = l.spawn.z;
  let h = t.sample(LINES.big, z, c).height;
  for (const zLip of lips) {
    for (; z > zLip; z -= 0.5) {
      const p = t.sample(LINES.big, z - 0.5, c);
      const v2 = v * v + 2 * g * (h - p.height) - 2 * (params.ground.friction * g * p.normal.y + params.ground.drag * v * v) * 0.5;
      v = Math.sqrt(Math.min(params.world.terminalSpeed ** 2, Math.max(0, v2)));
      h = p.height;
    }
    out.push(v);
  }
  return out;
}

/** Bisect `set(x)` over [lo, hi] for the arrival at pair k to reach `target`; more x, more speed. */
function solve(k: number, target: number, lo: number, hi: number, set: (x: number) => void, plan: Plan): 'ok' | 'fast' | 'slow' {
  const at = (x: number): number => {
    set(x);
    return arrivals(build(plan))[k] ?? 0;
  };
  if (at(lo) >= target) {
    set(lo);
    return 'fast';
  }
  if (at(hi) <= target) {
    set(hi);
    return 'slow';
  }
  let a = lo;
  let b = hi;
  for (let i = 0; i < 14; i++) {
    const m = (a + b) / 2;
    if (at(m) < target) a = m;
    else b = m;
  }
  set((a + b) / 2);
  return 'ok';
}

// Solve: the roll-in for the first jump, each steep stretch for the jump after it.
const plan: Plan = { top: 30, steep: PAIRS.map((_, k) => shortestRunin(k)) };
// Twice over per round: each kicker is solved over the earth after it, so a later stretch moves an
// earlier lip a little. Then the speed check bot rides it: the reckoning flies the airs as if
// riding the snow, the sim loses speed into each landing, so what the bot falls short by is added
// to the next round's targets (`bias`). The round the bot rides best is kept: big-line lips within
// 1.5 m/s under their aim (never over the size's top), every landing clean.
let status: string[] = [];
const bias = PAIRS.map(() => 0);
let best: { plan: Plan; status: string[]; score: number } | undefined;
const scratch = createSlope; // the bot rides each round's park
for (let round = 0; round < 4; round++) {
  for (let pass = 0; pass < 2; pass++) {
    status = [solve(0, aim(PAIRS[0] as (typeof PAIRS)[number]) + (bias[0] ?? 0), TOP.shortest, TOP.longest, (x) => (plan.top = x), plan)];
    for (let k = 1; k < PAIRS.length; k++) {
      status.push(solve(k, aim(PAIRS[k] as (typeof PAIRS)[number]) + (bias[k] ?? 0), shortestRunin(k - 1), EARTH.longest, (x) => (plan.steep[k - 1] = x), plan));
    }
  }
  const trial = build(plan);
  const reckoned = arrivals(trial);
  const checks = checkLines(trial, scratch(toSlopeConfig(trial)), params);
  const bot = checks.find((c) => c.name === 'big line')?.features ?? [];
  const small = checks.find((c) => c.name === 'small line')?.features ?? [];
  let score = 3 * (2 * PAIRS.length - bot.length - small.length);
  PAIRS.forEach((p, k) => {
    const b = bot[k];
    const sm = small[k];
    const want = aim(p);
    const top = GEN.kicker.sizes[p.big].speed[1] ?? 0;
    // Too slow counts double: a lip you can't clear is worse than one you check speed for.
    if (b) score += Math.max(0, 2 * (want - 1.5 - b.at), b.at - top) + (b.how === 'clean' ? 0 : b.how === 'sketchy' ? 1 : 3);
    if (sm) score += Math.max(0, (GEN.kicker.sizes[p.small].speed[0] ?? 0) - sm.at) + (sm.how === 'clean' ? 0 : sm.how === 'sketchy' ? 1 : 3);
    if (b) bias[k] = Math.max(-4, Math.min(4, (bias[k] ?? 0) + ((reckoned[k] ?? b.at) - b.at) * 0.6));
  });
  console.log(`round ${round + 1}: big ${bot.map((f) => `${f.at.toFixed(1)} ${f.how}`).join(' / ')} · small ${small.map((f) => `${f.at.toFixed(1)} ${f.how}`).join(' / ')} · score ${score.toFixed(1)}`);
  if (!best || score < best.score) best = { plan: { top: plan.top, steep: [...plan.steep] }, status: [...status], score };
}
if (best) {
  plan.top = best.plan.top;
  plan.steep = best.plan.steep;
  status = best.status;
}
const { patch } = stripPatch(plan);
let total = 0;
for (const [len] of patch.segs) total += len;
const length = Math.ceil((plan.top + total + BOTTOM.after) / 10) * 10;
const park = build(plan, length);
park.name = 'talma-jumps';
const speeds = arrivals(park);

if (svg) {
  writeFileSync(svg, profileSvg(park));
  console.log(`wrote ${svg}`);
} else {
  writeFileSync(output, JSON.stringify(park, null, 1) + '\n');
  for (const line of checkLines(park, createSlope(toSlopeConfig(park)), params)) {
    console.log(line.name);
    for (const f of line.features) console.log(`  ${f.type} at z ${f.z.toFixed(0)}: ${f.at.toFixed(1)} m/s (design ${f.design.join('–')}) ${f.ok ? 'ok' : 'OUT'}, ${f.how}`);
  }
  console.log(`wrote ${output}`);
}
console.log(`park ${length} m; roll-in ${plan.top.toFixed(0)} m at ${TOP.pitch}°`);
PAIRS.forEach((p, k) => {
  const st = plan.steep[k] ?? 0;
  console.log(`jump ${k + 1} (${p.big} + ${p.small}): bench ${benches[k]?.toFixed(0)} m at ${EARTH.bench}°, landing ${landing[k]?.toFixed(0)} m at ${EARTH.landing}°, run-in ${st.toFixed(0)} m at ${(steepGrade(k, st) / RAD).toFixed(1)}° · lip ≈ ${speeds[k]?.toFixed(1)} m/s (aim ${aim(p)}) ${status[k]}`);
});

/**
 * The big line's side profile, as the sketch draws it: the earth solid, the snow dashed where it
 * stands above it, with each stretch's length and grade, each kicker's lip, table and knuckle, and
 * the speed the line reaches each lip at. Heights drawn ×2, as marked.
 */
function profileSvg(l: Layout): string {
  const t = createSlope(toSlopeConfig(l));
  const g = createSlope(toSlopeConfig({ ...l, features: [] }));
  const c = createContact();
  const x = LINES.big;
  const z0 = l.spawn.z;
  const z1 = -(plan.top + total + 10);
  const pts: { s: number; earth: number; snow: number }[] = [];
  for (let z = z0; z >= z1; z -= 0.25) pts.push({ s: z0 - z, earth: g.sample(x, z, c).height, snow: t.sample(x, z, c).height });
  const VEX = 2; // vertical exaggeration
  const W = 1800;
  const pad = 60;
  const sMax = z0 - z1;
  const sx = (W - 2 * pad) / sMax;
  const hTop = Math.max(...pts.map((p) => p.snow));
  const hBot = Math.min(...pts.map((p) => p.earth));
  const H = Math.ceil((hTop - hBot) * sx * VEX + 2 * pad + 160);
  const X = (s: number): number => pad + s * sx;
  const Y = (h: number): number => pad + 90 + (hTop - h) * sx * VEX;
  const path = (key: 'earth' | 'snow', only?: (p: (typeof pts)[number]) => boolean): string => {
    let d = '';
    let pen = false;
    for (const p of pts) {
      if (only && !only(p)) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${X(p.s).toFixed(1)},${Y(p[key]).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const marks: string[] = [];
  const label = (s: number, h: number, str: string, dy: number, size = 13, weight = 400): void => {
    marks.push(`<text x="${X(s).toFixed(1)}" y="${(Y(h) + dy).toFixed(1)}" text-anchor="middle" font-size="${size}" font-weight="${weight}">${str}</text>`);
  };
  const earthAt = (s: number): number => g.sample(x, z0 - s, c).height;
  // Stretches of earth, with length and grade; a tick where each starts.
  const segs: { from: number; len: number; deg: number; name: string }[] = [{ from: 0, len: plan.top + z0, deg: TOP.pitch, name: 'roll-in' }];
  let s = plan.top + z0;
  const n = patch.segs.length;
  patch.segs.forEach(([len, pitch], i) => {
    const j = Math.floor(i / 3) + 1;
    segs.push({ from: s, len, deg: pitch / RAD, name: i % 3 === 0 ? `bench ${j}` : i % 3 === 1 ? `landing ${j}` : i === n - 1 ? 'on down' : `run-in ${j + 1}` });
    s += len;
  });
  segs.forEach((sg, i) => {
    const h = earthAt(sg.from);
    marks.push(`<line x1="${X(sg.from).toFixed(1)}" y1="${(Y(h) + 6).toFixed(1)}" x2="${X(sg.from).toFixed(1)}" y2="${(Y(h) + 62).toFixed(1)}" stroke="#b6c0ca"/>`);
    const mid = sg.from + sg.len / 2;
    // Short stretches side by side: their labels are staggered so they don't collide.
    const dy = 30 + (i % 3) * 32;
    label(mid, earthAt(mid), sg.name, dy, 12, 600);
    label(mid, earthAt(mid), `${sg.len.toFixed(0)} m · ${sg.deg.toFixed(1)}°`, dy + 15, 12);
  });
  // Kickers: lip, table, knuckle, and the speed at the lip.
  const big = (l.lines.find((nm) => nm.name === 'big line')?.features ?? []).map((i) => l.features[i] as FeatureSpec);
  big.forEach((f, k) => {
    const kc = f.cfg as KickerConfig;
    const lipS = z0 - lipOf(f);
    const top = t.sample(x, lipOf(f), c).height;
    label(lipS, top, `${PAIRS[k]?.big} (small line: ${PAIRS[k]?.small} beside it)`, -62, 14, 700);
    label(lipS, top, `lip ${kc.lipHeight.toFixed(1)} m at ${(kc.lipAngle / RAD).toFixed(0)}° · table ${kc.deckLength.toFixed(1)} m · knuckle ${(kc.knuckleHeight ?? kc.lipHeight).toFixed(1)} m`, -44, 12);
    label(lipS, top, `≈ ${speeds[k]?.toFixed(1)} m/s at the lip (built for ${aim(PAIRS[k] as (typeof PAIRS)[number])})`, -28, 12);
  });
  // Distance along the line.
  const axisY = H - 24;
  for (let d = 0; d <= sMax; d += 50) {
    marks.push(`<line x1="${X(d)}" y1="${axisY - 5}" x2="${X(d)}" y2="${axisY}" stroke="#7a8794"/>`);
    marks.push(`<text x="${X(d)}" y="${axisY + 14}" text-anchor="middle" font-size="11" fill="#5b6773">${d} m</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" fill="#1b2430">
<rect width="100%" height="100%" fill="#f7f9fb"/>
<text x="${pad}" y="32" font-size="18" font-weight="700">Talma jump line: big line side profile</text>
<text x="${pad}" y="54" font-size="13" fill="#5b6773">Earth solid, snow dashed. Heights drawn ×${VEX}; lengths and angles are true. Base grade ${(base / RAD).toFixed(1)}°; ${(hTop - hBot).toFixed(0)} m of drop over ${sMax.toFixed(0)} m. Speeds: straight-lining, reckoned.</text>
<path d="${path('earth')}" fill="none" stroke="#1b2430" stroke-width="2.5"/>
<path d="${path('snow', (p) => p.snow - p.earth > 0.05)}" fill="none" stroke="#1b2430" stroke-width="1.6" stroke-dasharray="6 4"/>
${marks.join('\n')}
</svg>`;
}
