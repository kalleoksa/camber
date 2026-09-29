import { readFileSync } from 'node:fs';
import { simulateTake, verifyTake, type Take } from '../src/input/recorder.ts';
import { params } from '../src/sim/params.ts';

/**
 * Milestone 1 gate: a recorded take replays frame-identically, param edits notwithstanding.
 * hill-run.json is a real ride; synthetic.json covers inputs a real ride may skip. Both the
 * sim hashes and the render-side spring hashes are checked.
 */
const names = ['hill-run.json', 'synthetic.json', 'rail.json', 'park.json'];
const takes = names.map((name) => JSON.parse(readFileSync(new URL(`../takes/${name}`, import.meta.url), 'utf8')) as Take);

const failures: string[] = [];
const baseline = takes.map((take) => simulateTake(take));

takes.forEach((take, i) => {
  const name = names[i];
  const base = baseline[i];
  if (!base) return;

  const first = verifyTake(take);
  if (!first.ok) failures.push(`${name}: ${first.stream} replay diverged at tick ${first.divergedAt}`);

  const again = simulateTake(take);
  if (again.hashes.join() !== base.hashes.join()) failures.push(`${name}: two consecutive replays differ`);

  // The render-side springs step on the sim tick, so they are as reproducible as the sim and
  // are checked the same way. This is what stops cloth from being driven per frame in M9c.
  if (again.secondaryHashes.join() !== base.secondaryHashes.join()) {
    failures.push(`${name}: two consecutive replays produced different render-side spring state`);
  }
  if (base.secondaryHashes.length !== take.frames.length) {
    failures.push(`${name}: spring stream is ${base.secondaryHashes.length} ticks for ${take.frames.length} frames`);
  }

  // The same inputs under different params must actually produce a different run,
  // otherwise the checks here are vacuous.
  const retuned: Take = { ...take, params: { ...take.params, world: { ...take.params.world, gravity: 22 } } };
  if (simulateTake(retuned).hashes.join() === base.hashes.join()) {
    failures.push(`${name}: changing a take param produced an identical run — the sim is ignoring params`);
  }

  // Restiffening the hip spring must move the springs and leave the sim untouched. Half of
  // this is the vacuity check for the spring stream; the other half is invariant 5 — a spring
  // that fed anything the sim reads would show up here as a changed sim hash.
  const stiffer: Take = { ...take, params: { ...take.params, rig: { ...take.params.rig, hipStiffness: 400 } } };
  const stiffened = simulateTake(stiffer);
  if (stiffened.secondaryHashes.join() === base.secondaryHashes.join()) {
    failures.push(`${name}: restiffening the hip spring changed nothing — the springs are ignoring params`);
  }
  if (stiffened.hashes.join() !== base.hashes.join()) {
    failures.push(`${name}: a render-side spring param changed the sim — secondary motion has leaked into it`);
  }
});

// A tuning session mutates the live params. Each take carries its own, so it must not care.
params.ground.gripEdge *= 1.7;
params.world.gravity += 3;
params.camera.distance = 12;
params.rig.hipStiffness *= 3;
takes.forEach((take, i) => {
  const after = verifyTake(take);
  if (!after.ok) {
    failures.push(`${names[i]}: ${after.stream} replay diverged at tick ${after.divergedAt} after a live param change`);
  }
});

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

takes.forEach((take, i) => {
  const base = baseline[i];
  if (!base) return;
  console.log(
    `OK ${names[i]}: ${take.frames.length} ticks replay frame-identically ` +
      `(sim ${base.hashes.at(-1)}, springs ${base.secondaryHashes.at(-1)})`,
  );
});
