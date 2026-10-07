/**
 * Speed check for the Talma park: `node scripts/talma-check.ts`. Rides each line of
 * parks/talma-reference.json with the speed check bot (src/park/check.ts) and prints, per
 * feature, the speed it got there with against its design range and how it went.
 */
import { readFileSync } from 'node:fs';
import { checkLines, failed } from '../src/park/check.ts';
import { toSlopeConfig, type Layout } from '../src/park/layout.ts';
import { params } from '../src/sim/params.ts';
import { createSlope } from '../src/sim/terrain.ts';

const layout = JSON.parse(readFileSync(new URL('../parks/talma-reference.json', import.meta.url), 'utf8')) as Layout;
let failures = 0;
for (const line of checkLines(layout, createSlope(toSlopeConfig(layout)), params)) {
  console.log(line.name);
  for (const f of line.features) {
    if (failed(f)) failures++;
    console.log(`  ${f.type} at z ${f.z.toFixed(0)}: ${f.at.toFixed(1)} m/s (design ${f.design.join('–')}) ${f.ok ? 'ok' : 'OUT'}, ${f.how}`);
  }
}
console.log(failures ? `${failures} failed` : 'all passed');
