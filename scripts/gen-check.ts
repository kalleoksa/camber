/**
 * Park generator check: `npm run gen-check -- [seeds]`. Generates each seed twice (the layout
 * must be byte-identical), times it, and reports the ground: slope by band, steepest spot,
 * sharpest bend (what the absorb spring has to take), and straight-line speed from the speed map.
 */
import { createHash } from 'node:crypto';
import { GEN } from '../src/gen/config.ts';
import { generateLayout } from '../src/gen/generate.ts';
import { computeSpeedMap } from '../src/gen/speedmap.ts';
import { params } from '../src/sim/params.ts';
import { toSlopeConfig } from '../src/park/layout.ts';
import { createContact, createSlope } from '../src/sim/terrain.ts';

const seeds = (process.argv[2] ?? '1-5').split('-').map(Number);
const [from = 1, to = from] = seeds;
const DEG = 180 / Math.PI;
const BANDS: [string, number, number][] = [['flat 0-5', 0, 5], ['5-10', 5, 10], ['cruise 10-20', 10, 20], ['run-in 20-25', 20, 25], ['25-30', 25, 30], ['steep 30-35', 30, 35], ['>35', 35, 90]];

for (let seed = from; seed <= to; seed++) {
  const t0 = performance.now();
  const layout = generateLayout(seed);
  const genMs = performance.now() - t0;
  const hash = createHash('sha1').update(JSON.stringify(layout)).digest('hex').slice(0, 10);
  const again = createHash('sha1').update(JSON.stringify(generateLayout(seed))).digest('hex').slice(0, 10);
  const t1 = performance.now();
  // Ground only: the features would count their own faces as steep spots.
  const terrain = createSlope(toSlopeConfig({ ...layout, features: [] }));
  const bakeMs = performance.now() - t1;
  const c = createContact();
  const count = BANDS.map(() => 0);
  let n = 0;
  let steepest = 0;
  let bend = 0; // 1/m: largest change of slope angle per metre along the fall line
  const w = layout.ground.width / 2 - 25; // inside the banks
  for (let z = -10; z > -layout.ground.length + 10; z -= 2) {
    for (let x = -w; x <= w; x += 4) {
      const a = Math.acos(terrain.sample(x, z, c).normal.y) * DEG;
      const b = Math.acos(terrain.sample(x, z - 1, c).normal.y) * DEG;
      bend = Math.max(bend, Math.abs(b - a) / DEG);
      steepest = Math.max(steepest, a);
      const i = BANDS.findIndex(([, lo, hi]) => a >= lo && a < hi);
      count[i]!++;
      n++;
    }
  }
  const patches = layout.ground.field?.patches.length ?? 0;
  console.log(`seed ${seed}: ${hash} ${hash === again ? 'same twice' : `DIFFERS (${again})`} · gen ${genMs.toFixed(0)} ms, bake ${bakeMs.toFixed(0)} ms · ${patches} band patches · base ${(layout.ground.pitch * DEG).toFixed(1)}°`);
  console.log(`  ${BANDS.map(([name], i) => `${name}: ${((100 * count[i]!) / n).toFixed(0)}%`).join(' · ')}`);
  console.log(`  steepest ${steepest.toFixed(1)}° · sharpest bend radius ${(1 / bend).toFixed(0)} m`);
  // Walls: anywhere the finished park rises more than 0.5 m in 0.5 m going down the hill
  // (not a quarter pipe's face) — a hidden step that stops a rider dead. Drops (a gap jump's
  // lip back) are by design and not counted.
  const world = createSlope(toSlopeConfig(layout));
  let walls = 0;
  const wallAt: string[] = [];
  for (let z = -2; z > -layout.ground.length; z -= 0.5) {
    for (let x = -w; x <= w; x += 2) {
      const a = world.sample(x, z, c);
      if (a.surface === 'quarter') continue;
      if (world.sample(x, z - 0.5, c).height - a.height > 0.5) {
        walls++;
        if (wallAt.length < 4) wallAt.push(`${x.toFixed(0)},${z.toFixed(0)}`);
      }
    }
  }
  console.log(`  features ${layout.features.length} · lines ${layout.lines.map((l) => l.features.length).join('/')} · walls ${walls}${wallAt.length ? ` (at ${wallAt.join(' ')})` : ''}`);
  // Restart: a rider back on their feet after a fall, from standing, straight down the fall
  // line on the finished park — metres until 30 km/h, or stuck (never gets there in 150 m).
  {
    const g = params.world.gravity;
    const reach: number[] = [];
    let stuck = 0;
    for (let z = -30; z > -layout.ground.length + 60; z -= 40) {
      for (let x = -w + 10; x <= w - 10; x += 30) {
        let px = x;
        let pz = z;
        let v = 0.5;
        let d = 0;
        let h = world.sample(px, pz, c).height;
        while (v < 30 / 3.6 && d < 150 && v > 0) {
          const n = world.sample(px, pz, c).normal;
          const k = Math.hypot(n.x, n.z) || 1;
          px += (n.x / k) * 1;
          pz += (n.z / k) * 1;
          d += 1;
          const p = world.sample(px, pz, c);
          v = Math.sqrt(Math.max(0, v * v + 2 * g * (h - p.height) - 2 * (params.ground.friction * g * p.normal.y + params.ground.drag * v * v)));
          h = p.height;
        }
        if (v >= 30 / 3.6) reach.push(d);
        else stuck++;
      }
    }
    reach.sort((a, b) => a - b);
    const n = reach.length + stuck;
    console.log(`  restart from standing: 30 km/h after median ${reach[reach.length >> 1] ?? '-'} m (slowest quarter ${reach[Math.floor(reach.length * 0.75)] ?? '-'} m) · stuck ${((100 * stuck) / n).toFixed(0)}% of ${n} spots`);
  }
  const field = layout.ground.field;
  if (field) {
    const map = computeSpeedMap(terrain, params, { width: field.width, length: field.length, ...GEN.speedMap });
    const kmh = Array.from(map.speed, (v) => v * 3.6).sort((a, b) => a - b);
    const share = (f: (v: number) => boolean): string => `${((100 * kmh.filter(f).length) / kmh.length).toFixed(0)}%`;
    const terminal = params.world.terminalSpeed * 3.6 - 1;
    console.log(`  straight-line speed: median ${kmh[kmh.length >> 1]?.toFixed(0)} km/h · stalled ${share((v) => v < 5)} · jump range 40–70 ${share((v) => v >= 40 && v < 70)} · at terminal ${share((v) => v >= terminal)}`);
  }
}
