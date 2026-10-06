/**
 * Talma's jump lines on a built ground profile: `node scripts/talma-jumps.ts [in.json] [out.json]`.
 * Reads a Talma layout (default parks/talma-reference.json), replaces its jump line with two
 * lines side by side — big M, L, M and small S, M, S, a pair at each step — on one earth
 * corridor, and writes parks/talma-jumps.json (?park=talma-jumps). The rails, rollers and the
 * other patches are kept as they are.
 *
 * Each pair stands on an earth step, level with the base grade overall: a bench under the run-in,
 * takeoffs and tables, flatter than the base grade so it rises above it, then an earth drop at
 * EARTH.drop that gives that rise back — two thirds of the big kicker's landing (twice its snow
 * knuckle) — and a short run-out on the base grade. The snow kickers are the kit's, solved over
 * that ground: the big one's table ends on the earth's edge, the small one's lip is level with the
 * big one's. A bench's length sets its grade (the longer, the nearer the base grade, the faster
 * the lip), and is solved so a rider straight-lining from the start arrives at the pair's lips at
 * the speed both sizes work at — the overlap of their ranges, the two averaged. Where even a flat
 * bench (the shortest) is too fast — a smaller jump after a bigger one — the line asks riders to
 * check speed there. The speed check bot rides the result; what it falls short of the reckoning
 * by is fed back over a few rounds and the best kept. The park grows to fit.
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
const input = process.argv[2] ?? new URL('../parks/talma-reference.json', import.meta.url).pathname;
const output = process.argv[3] ?? new URL('../parks/talma-jumps.json', import.meta.url).pathname;

const PAIRS: { big: Size; small: Size }[] = [
  { big: 'M', small: 'S' },
  { big: 'L', small: 'M' },
  { big: 'M', small: 'S' },
];
const LINES = { big: 12, small: 18.5 }; // m across: the big line on the lift side, the small one beside it toward the rails — far enough from both for the corridor's banks
const DECK_WIDTH = { big: 7, small: 5 }; // m of table, each fading over DECK_TAPER: neither rider crosses the other's table
const DECK_TAPER = 2;
const EARTH = {
  start: -40, // m: where the corridor's first bench starts
  drop: 20, // ° the earth falls at under a landing
  share: 2 / 3, // of the big kicker's landing fall the earth gives (as a multiple of its snow knuckle: share / (1 − share))
  approach: 25, // m of bench before a takeoff, at the least
  longest: 400, // m a bench may run to reach its speed
  runout: 12, // m on the base grade after each drop, before the next bench
  halfWidth: 9, // m full height either side of the corridor's middle: both tables and their fades
  edge: 12, // m its sides fade over: banks of ~30° at the tallest step, ending short of the lift (x ≈ −8) and the rail lines (x ≈ 36)
  blend: 3, // m the grades are eased over
};
const SOLVE_LENGTH = 1200; // m of park while solving: room for any bench tried
const BOTTOM = { after: 40, runout: 35 }; // m of park past the corridor's end; the bottom patch's last stretch

const layout = JSON.parse(readFileSync(input, 'utf8')) as Layout;
const field = layout.ground.field;
if (!field) throw new Error('needs a heightfield ground');
const base = field.pitch;
const tanBase = Math.tan(base);
const corridor = (DECK_WIDTH.small / 2 + DECK_TAPER + LINES.small + LINES.big - DECK_WIDTH.big / 2 - DECK_TAPER) / 2;
const keep = layout.features.filter((f) => f.kind !== 'kicker'); // the old jump line's kickers go

/** The speed both sizes of a pair work at: the middle of the overlap of their ranges. */
const overlap = (p: (typeof PAIRS)[number]): number => {
  const a = GEN.kicker.sizes[p.big].speed;
  const b = GEN.kicker.sizes[p.small].speed;
  return (Math.max(a[0] ?? 0, b[0] ?? 0) + Math.min(a[1] ?? 0, b[1] ?? 0)) / 2;
};

// Each earth drop: twice the knuckle the kit gives the big kicker on plain ground.
const plain = PAIRS.map((p) => designKicker({ x: 0, z: 0, yaw: 0 }, p.big, base, GEN, params));
const drops = plain.map((f) => {
  const k = f.cfg as KickerConfig;
  return ((k.knuckleHeight ?? k.lipHeight) * EARTH.share) / (1 - EARTH.share);
});
// A bench's least length: room for the approach, the big kicker's transition and its table, and
// no shorter than a flat bench that rises as far as the drop falls (shorter would be uphill:
// a slower rider would stop on it).
const shortest = plain.map((f, k) => Math.max(EARTH.approach + (f.meta?.lip ?? 0) + (f.cfg as KickerConfig).deckLength, (drops[k] ?? 0) / tanBase));

/** A bench `length` m long that rises as far as step `k`'s drop falls: its grade. */
const gradeOf = (k: number, length: number): number => Math.atan(tanBase - (drops[k] ?? 0) / length);

type Step = { length: number };

/** The corridor patch, and where each step's earth edge (the big table's end) is, m along it. */
function corridorPatch(steps: Step[]): { patch: PatchConfig; edges: number[] } {
  const segs: [number, number][] = [];
  const edges: number[] = [];
  let s = 0;
  steps.forEach((st, k) => {
    segs.push([st.length, gradeOf(k, st.length)]);
    s += st.length;
    edges.push(s);
    const drop = (drops[k] ?? 0) / (Math.tan(EARTH.drop * RAD) - tanBase);
    segs.push([drop, EARTH.drop * RAD], [EARTH.runout, base]);
    s += drop + EARTH.runout;
  });
  return { patch: { x: corridor, z: EARTH.start, yaw: 0, halfWidth: EARTH.halfWidth, edge: EARTH.edge, blend: EARTH.blend, segs }, edges };
}

/** A kicker of `size` at `x`, its transition starting at `z`, solved over `ground`. */
const kickerAt = (size: Size, x: number, z: number, ground: Terrain): FeatureSpec => designKicker({ x, z, yaw: 0 }, size, EARTH.drop * RAD, GEN, params, ground);
const lipOf = (f: FeatureSpec): number => (f.cfg as KickerConfig).z - (f.meta?.lip ?? 0);
const endOf = (f: FeatureSpec): number => lipOf(f) - (f.cfg as KickerConfig).deckLength;

/** A pair: the big one's table ending at `edgeZ`, the small one's lip level with the big one's. */
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

/** The park with these steps, `length` m long: corridor, kickers, lines. */
function build(steps: Step[], length = SOLVE_LENGTH): Layout {
  const { patch, edges } = corridorPatch(steps);
  // The bottom run-out (the lowest full-width patch) moves to the new end.
  const bottom = field.patches.reduce((b, p, i) => (p.halfWidth >= 60 && p.z < (field.patches[b]?.z ?? 0) ? i : b), -1);
  const patches = field.patches.map((p, i) => (i === bottom ? { ...p, z: -(length - BOTTOM.runout) } : { ...p }));
  // The old jump line's patches — the narrow ones within the corridor's reach, banks included — go;
  // the corridor takes the first one's place.
  const reach = EARTH.halfWidth + EARTH.edge;
  const old = patches.findIndex((p) => p.halfWidth < 20 && Math.abs(p.x - corridor) < reach);
  const kept = patches.filter((p) => !(p.halfWidth < 20 && Math.abs(p.x - corridor) < reach));
  patches.length = 0;
  patches.push(...kept);
  patches.splice(old >= 0 ? old : 1, 0, patch);
  const next: Layout = { ...layout, ground: { ...layout.ground, length, field: { ...field, length, patches } }, features: [...keep], lines: [], links: [] };
  const ground = createSlope(toSlopeConfig({ ...next, features: [] }));
  const big: number[] = [];
  const small: number[] = [];
  steps.forEach((_, k) => {
    const p = PAIRS[k];
    if (!p) return;
    const [b, s] = pair(p, EARTH.start - (edges[k] ?? 0), ground);
    big.push(next.features.push(b) - 1);
    small.push(next.features.push(s) - 1);
  });
  next.lines = [
    { name: 'big line', features: big, speed: PAIRS.map(overlap) },
    { name: 'small line', features: small, speed: PAIRS.map(overlap) },
    // The rail lines as they were, by the rails' new places.
    ...layout.lines
      .filter((l) => l.name !== 'jump line')
      .map((l) => ({ ...l, features: l.features.map((i) => layout.features[i]).filter((f): f is FeatureSpec => !!f && f.kind !== 'kicker').map((f) => next.features.indexOf(f)) })),
  ];
  next.spawn = { ...layout.spawn, x: LINES.big };
  return next;
}

/**
 * Speed at each pair's lips, riding straight down each line from the start over the snow as it
 * is (kickers and all, flown or not: no friction in the air, but it is short): speed from height
 * lost, less friction and drag, as the generator reckons it. Smooth in the grades, unlike a bot
 * ride, so a bisection on it settles; the bot checks the result. Per pair: the big kicker's, moved
 * toward the small one's by half the gap — the two averaged.
 */
function arrivals(l: Layout): number[] {
  const t = createSlope(toSlopeConfig(l));
  const c = createContact();
  const g = params.world.gravity;
  const ride = (x: number, to: number[]): number[] => {
    const out: number[] = [];
    let v = 2; // a push off at the start
    let z = l.spawn.z;
    let h = t.sample(x, z, c).height;
    const step = 0.5;
    for (const zLip of to) {
      for (; z > zLip; z -= step) {
        const p = t.sample(x, z - step, c);
        const v2 = v * v + 2 * g * (h - p.height) - 2 * (params.ground.friction * g * p.normal.y + params.ground.drag * v * v) * step;
        v = Math.sqrt(Math.min(params.world.terminalSpeed ** 2, Math.max(0, v2)));
        h = p.height;
      }
      out.push(v);
    }
    return out;
  };
  const lips = (name: string): number[] => (l.lines.find((n) => n.name === name)?.features ?? []).map((i) => lipOf(l.features[i] as FeatureSpec));
  const big = ride(LINES.big, lips('big line'));
  const small = ride(LINES.small, lips('small line'));
  return big.map((v, k) => (v + (small[k] ?? v)) / 2);
}

// Solve each bench's length from the top on the reckoning (smooth, so a bisection settles), then
// ride it with the bot; what the bot falls short of the reckoning by is added to the next round's
// targets. Each round is scored on both lines — m/s outside each pair's overlap, every landing
// that isn't clean, every pair never reached — and the best kept: the rides couple (a sketchy
// landing slows the next pair).
const steps: Step[] = PAIRS.map((_, k) => ({ length: shortest[k] ?? 40 }));
const bias = PAIRS.map(() => 0);
const slowest = new Set<number>(); // pairs that ask for a speed check
let best: { steps: Step[]; score: number } | undefined;
for (let round = 0; round < 4; round++) {
  slowest.clear();
  for (let k = 0; k < PAIRS.length; k++) {
    const target = overlap(PAIRS[k] as (typeof PAIRS)[number]) + (bias[k] ?? 0);
    const st = steps[k] as Step;
    const at = (length: number): number => {
      st.length = length;
      return arrivals(build(steps))[k] ?? 0;
    };
    const lo = shortest[k] ?? 40;
    const hi = EARTH.longest;
    if (at(lo) >= target) {
      st.length = lo;
      slowest.add(k);
      continue;
    }
    if (at(hi) <= target) {
      st.length = hi;
      continue;
    }
    let a = lo;
    let b = hi;
    for (let it = 0; it < 14; it++) {
      const m = (a + b) / 2;
      if (at(m) < target) a = m;
      else b = m;
    }
    st.length = (a + b) / 2;
  }
  const solved = build(steps);
  const model = arrivals(solved);
  const checks = checkLines(solved, createSlope(toSlopeConfig(solved)), params);
  const bot = checks.find((c) => c.name === 'big line')?.features ?? [];
  const botSmall = checks.find((c) => c.name === 'small line')?.features ?? [];
  let score = 3 * (2 * PAIRS.length - bot.length - botSmall.length);
  PAIRS.forEach((p, k) => {
    const a = GEN.kicker.sizes[p.big].speed;
    const b = GEN.kicker.sizes[p.small].speed;
    const lo = Math.max(a[0] ?? 0, b[0] ?? 0);
    const hi = Math.min(a[1] ?? 0, b[1] ?? 0);
    // A pair that asks for a speed check is scored on its landings only: the bot doesn't check speed.
    for (const f of [bot[k], botSmall[k]]) if (f) score += (slowest.has(k) ? 0 : Math.max(0, lo - f.at, f.at - hi)) + (f.how === 'clean' ? 0 : f.how === 'sketchy' ? 1 : 3);
    const big = bot[k]?.at;
    const small = botSmall[k]?.at;
    if (big !== undefined) bias[k] = Math.max(-2, Math.min(2, (bias[k] ?? 0) + ((model[k] ?? big) - (small === undefined ? big : (big + small) / 2)) * 0.6));
  });
  console.log(`round ${round + 1}: bot ${bot.map((f) => f.at.toFixed(1)).join(' / ')} · small ${botSmall.map((f) => f.at.toFixed(1)).join(' / ')} · score ${score.toFixed(1)}`);
  if (!best || score < best.score) best = { steps: steps.map((st) => ({ ...st })), score };
}
if (best) best.steps.forEach((st, k) => Object.assign(steps[k] as Step, st));
const { patch, edges } = corridorPatch(steps);
let total = 0;
for (const [len] of patch.segs) total += len;
const park = build(steps, Math.ceil((-EARTH.start + total + BOTTOM.after) / 10) * 10);
park.name = 'talma-jumps';
writeFileSync(output, JSON.stringify(park, null, 1) + '\n');

// Report.
console.log(`park ${park.ground.length} m long; corridor x ${corridor.toFixed(1)} ± ${EARTH.halfWidth} (+${EARTH.edge} fade), ${total.toFixed(0)} m from z ${EARTH.start}`);
steps.forEach((st, k) => {
  const p = PAIRS[k];
  console.log(`step ${k + 1} (${p?.big} + ${p?.small}): bench ${st.length.toFixed(0)} m at ${(gradeOf(k, st.length) / RAD).toFixed(1)}°, earth drop ${drops[k]?.toFixed(1)} m, edge z ${(EARTH.start - (edges[k] ?? 0)).toFixed(0)}, target ${overlap(p as (typeof PAIRS)[number])} m/s${slowest.has(k) ? ' — too fast even flat: check speed' : ''}`);
});
for (const line of checkLines(park, createSlope(toSlopeConfig(park)), params)) {
  console.log(line.name);
  for (const f of line.features) console.log(`  ${f.type} at z ${f.z.toFixed(0)}: ${f.at.toFixed(1)} m/s (design ${f.design.join('–')}) ${f.ok ? 'ok' : 'OUT'}, ${f.how}`);
}
console.log(`wrote ${output}`);
