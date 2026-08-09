import { readFileSync } from 'node:fs';
import { simulateTake, verifyTake, type Take } from '../src/input/recorder.ts';
import { params } from '../src/sim/params.ts';

/** Milestone 1 gate: a recorded take replays frame-identically, param edits notwithstanding. */
const path = new URL('../takes/hill-run.json', import.meta.url);
const take = JSON.parse(readFileSync(path, 'utf8')) as Take;

const failures: string[] = [];

const first = verifyTake(take);
if (!first.ok) failures.push(`${first.stream} replay diverged at tick ${first.divergedAt}`);

const a = simulateTake(take).hashes;
const b = simulateTake(take).hashes;
if (a.join() !== b.join()) failures.push('two consecutive replays of the same take differ');

// The render-side springs step on the sim tick, so they are as reproducible as the sim and
// are checked the same way. This is what stops cloth from being driven per frame in M9c.
const springsA = simulateTake(take).secondaryHashes;
const springsB = simulateTake(take).secondaryHashes;
if (springsA.join() !== springsB.join()) {
  failures.push('two consecutive replays produced different render-side spring state');
}
if (springsA.length !== take.frames.length) {
  failures.push(`spring stream is ${springsA.length} ticks for ${take.frames.length} frames`);
}

// A tuning session mutates the live params. The take carries its own, so it must not care.
params.ground.gripEdge *= 1.7;
params.world.gravity += 3;
params.camera.distance = 12;
params.rig.hipStiffness *= 3;
const after = verifyTake(take);
if (!after.ok) {
  failures.push(`${after.stream} replay diverged at tick ${after.divergedAt} after a live param change`);
}

// The same inputs under different params must actually produce a different run,
// otherwise the check above is vacuous.
const retuned: Take = { ...take, params: { ...take.params, world: { ...take.params.world, gravity: 22 } } };
if (simulateTake(retuned).hashes.join() === a.join()) {
  failures.push('changing a take param produced an identical run — the sim is ignoring params');
}

// Restiffening the hip spring must move the springs and leave the sim untouched. Half of
// this is the vacuity check for the spring stream; the other half is invariant 5 — a spring
// that fed anything the sim reads would show up here as a changed sim hash.
const stiffer: Take = { ...take, params: { ...take.params, rig: { ...take.params.rig, hipStiffness: 400 } } };
const stiffened = simulateTake(stiffer);
if (stiffened.secondaryHashes.join() === springsA.join()) {
  failures.push('restiffening the hip spring changed nothing — the springs are ignoring params');
}
if (stiffened.hashes.join() !== a.join()) {
  failures.push('a render-side spring param changed the sim — secondary motion has leaked into it');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

console.log(
  `OK ${take.frames.length} ticks replay frame-identically ` +
    `(sim ${a[a.length - 1]}, springs ${springsA[springsA.length - 1]})`,
);
