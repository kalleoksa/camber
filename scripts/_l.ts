import { generateLayout } from '../src/gen/generate.ts';
for (const seed of [1, 2, 3]) {
  const t0 = performance.now();
  const l = generateLayout(seed);
  console.log(`seed ${seed}: ${l.features.length} features, ${(performance.now() - t0).toFixed(0)} ms, ${l.ground.field!.patches.length} patches`);
  for (const line of l.lines) console.log(`  ${line.name}: ` + line.features.map((i, j) => { const f = l.features[i]!; const m = f.meta!; return `${m.type}${m.size ? ' ' + m.size : ''}${m.hero ? '*' : ''} @${(-(f.cfg as { z?: number }).z! || 0).toFixed(0)}m ${(line.speed[j]! * 3.6).toFixed(0)}km/h${m.speed ? ` [${(m.speed[0] * 3.6).toFixed(0)}-${(m.speed[1] * 3.6).toFixed(0)}]` : ''}`; }).join(' → '));
}
