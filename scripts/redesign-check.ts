/**
 * `npm run redesign-check -- [seeds]`: every generated feature, built again from its
 * `meta.design` (src/gen/lines.ts `redesign`), must come out exactly as generated — the
 * property the park editor leans on when it changes an input and re-solves.
 */
import { GEN } from '../src/gen/config.ts';
import { generateLayout } from '../src/gen/generate.ts';
import { redesign } from '../src/gen/lines.ts';
import type { FeatureSpec } from '../src/park/layout.ts';
import { params } from '../src/sim/params.ts';
import { createSlope } from '../src/sim/terrain.ts';

const [from, to] = (process.argv[2] ?? '1-3').split('-').map(Number) as [number, number?];
const strip = (f: FeatureSpec): string => JSON.stringify({ kind: f.kind, cfg: f.cfg, type: f.meta?.type, lip: f.meta?.lip, speed: f.meta?.speed });
let bad = 0;
for (let seed = from; seed <= (to ?? from); seed++) {
  const layout = generateLayout(seed);
  const field = layout.ground.field;
  if (!field) continue;
  const ground = createSlope({ length: field.length, width: field.width, pitch: field.pitch, field });
  let checked = 0;
  layout.features.forEach((f, i) => {
    const design = f.meta?.design;
    if (!design) return;
    checked++;
    const again = redesign(design, ground, GEN, params);
    // The generated parts: this one and the rest of its group, in order.
    const group = f.meta?.group;
    const parts = group === undefined ? [f] : layout.features.filter((g) => g.meta?.group === group);
    const same = again.length === parts.length && again.every((g, k) => strip(g) === strip(parts[k] as FeatureSpec));
    if (!same) {
      bad++;
      console.log(`seed ${seed} feature ${i} (${design.kind}): differs`);
    }
  });
  const missing = layout.features.filter((f) => !f.meta?.design && f.meta?.group === undefined).length;
  console.log(`seed ${seed}: ${checked} designs rebuilt${missing ? `, ${missing} features without one` : ''}`);
}
console.log(bad ? `${bad} differ` : 'all identical');
