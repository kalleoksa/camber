import { readFileSync } from 'node:fs';
import { simulateTake, verifyTake, type Take } from '../src/input/recorder.ts';
import { params } from '../src/sim/params.ts';

/**
 * Milestone 1 gate: a recorded take replays frame-identically, param edits notwithstanding.
 * hill-run.json is a real ride recorded in a browser on another machine — it passing here
 * is the cross-machine check. synthetic.json covers inputs a real ride may skip.
 */
const names = ['hill-run.json', 'synthetic.json'];
const takes = names.map((name) => JSON.parse(readFileSync(new URL(`../takes/${name}`, import.meta.url), 'utf8')) as Take);

const failures: string[] = [];
const baseline = takes.map((take) => simulateTake(take).hashes);

takes.forEach((take, i) => {
  const name = names[i];
  const first = verifyTake(take);
  if (!first.ok) failures.push(`${name}: replay diverged at tick ${first.divergedAt}`);
  if (simulateTake(take).hashes.join() !== baseline[i]?.join()) {
    failures.push(`${name}: two consecutive replays of the same take differ`);
  }

  // The same inputs under different params must actually produce a different run,
  // otherwise the checks here are vacuous.
  const retuned: Take = { ...take, params: { ...take.params, world: { ...take.params.world, gravity: 22 } } };
  if (simulateTake(retuned).hashes.join() === baseline[i]?.join()) {
    failures.push(`${name}: changing a take param produced an identical run — the sim is ignoring params`);
  }
});

// A tuning session mutates the live params. Each take carries its own, so it must not care.
params.ground.gripEdge *= 1.7;
params.world.gravity += 3;
params.camera.distance = 12;
takes.forEach((take, i) => {
  const after = verifyTake(take);
  if (!after.ok) failures.push(`${names[i]}: replay diverged at tick ${after.divergedAt} after a live param change`);
});

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

takes.forEach((take, i) => {
  const hashes = baseline[i] ?? [];
  console.log(`OK ${names[i]}: ${take.frames.length} ticks replay frame-identically (final hash ${hashes[hashes.length - 1]})`);
});
