/**
 * Kicker kit against the sim: `npm run kit-check`. Each size is designed for a few ground
 * grades, then the real rider rides it straight — run-in speed found so it reaches the lip at
 * the design speed — once without a pop and once fully charged. Prints, design vs ride: how
 * far past the knuckle it landed and how. The design's flight model leaves out what the sim
 * does at the lip (absorb, the lip's own launch); the design corrects for it with one ride of
 * its own (vMin, no pop), and this rides the rest.
 */
import { GEN } from '../src/gen/config.ts';
import { designKicker } from '../src/gen/kit.ts';
import { rideKicker } from '../src/gen/ride.ts';
import { params } from '../src/sim/params.ts';
import { createSlope, type KickerConfig } from '../src/sim/terrain.ts';

const DEG = Math.PI / 180;

for (const deg of [12, 20]) {
  for (const size of ['S', 'M', 'L', 'XL'] as const) {
    const f = designKicker({ x: 0, z: 0, yaw: 0 }, size, deg * DEG, GEN, params);
    const k = f.cfg as KickerConfig;
    const [vMin, vMax] = f.meta!.speed!;
    const design = f.meta!.checks!;
    const rows: string[] = [];
    for (const [v, charge, d] of [[vMin, false, design[0]], [vMax, false, undefined], [vMax, true, design[3]]] as const) {
      const t = createSlope({ length: 600, width: 400, pitch: deg * DEG, kickers: [k] });
      const r = rideKicker(t, params, k.z, f.meta!.lip!, k.deckLength, v, charge);
      rows.push(`${v}m/s ${charge ? 'full pop' : 'no pop'}: ride ${r.past >= 0 ? '+' : ''}${r.past.toFixed(1)}m ${r.landing}${d ? ` (design ${d.past >= 0 ? '+' : ''}${d.past.toFixed(1)}m ${d.grade})` : ''}`);
    }
    console.log(`${deg}° ${size}: ${rows.join(' · ')}`);
  }
}
