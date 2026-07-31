import { readFileSync } from 'node:fs';
import { simulateTake, verifyTake, type Take } from '../src/input/recorder.ts';
import { params } from '../src/sim/params.ts';

/** Milestone 1 gate: a recorded take replays frame-identically, param edits notwithstanding. */
const path = new URL('../takes/hill-run.json', import.meta.url);
const take = JSON.parse(readFileSync(path, 'utf8')) as Take;

const failures: string[] = [];

const first = verifyTake(take);
if (!first.ok) failures.push(`replay diverged at tick ${first.divergedAt}`);

const a = simulateTake(take).hashes;
const b = simulateTake(take).hashes;
if (a.join() !== b.join()) failures.push('two consecutive replays of the same take differ');

// A tuning session mutates the live params. The take carries its own, so it must not care.
params.ground.gripEdge *= 1.7;
params.world.gravity += 3;
params.camera.distance = 12;
const after = verifyTake(take);
if (!after.ok) failures.push(`replay diverged at tick ${after.divergedAt} after a live param change`);

// The same inputs under different params must actually produce a different run,
// otherwise the check above is vacuous.
const retuned: Take = { ...take, params: { ...take.params, world: { ...take.params.world, gravity: 22 } } };
if (simulateTake(retuned).hashes.join() === a.join()) {
  failures.push('changing a take param produced an identical run — the sim is ignoring params');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

console.log(`OK ${take.frames.length} ticks replay frame-identically (final hash ${a[a.length - 1]})`);
