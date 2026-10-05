/**
 * Park generator check: `npm run gen-check -- [seeds]`. Generates each seed twice (the layout
 * must be byte-identical), times it, and reports the ground: slope by band, steepest spot,
 * sharpest bend (what the absorb spring has to take).
 */
import { createHash } from 'node:crypto';
import { generateLayout } from '../src/gen/generate.ts';
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
  const terrain = createSlope(toSlopeConfig(layout));
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
}
