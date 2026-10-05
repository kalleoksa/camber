/**
 * Speed check for the Talma park: `node scripts/talma-check.ts`. The sim's rider rides each line
 * of parks/talma-reference.json from the top, straight down its line, never braking, popping
 * at every lip and rail start — except that rails are scrubbed into (L2) at their design speed. Per feature: the speed it got there with against the range it
 * was designed for, and how it went — landed (clean / sketchy / bail), on the rail and off it,
 * or missed.
 */
import { readFileSync } from 'node:fs';
import { TICK_DT } from '../src/core/loop.ts';
import { neutralInput } from '../src/input/snapshot.ts';
import { toSlopeConfig, type FeatureSpec, type Layout } from '../src/park/layout.ts';
import { params } from '../src/sim/params.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState } from '../src/sim/state.ts';
import { createContact, createSlope } from '../src/sim/terrain.ts';

const layout = JSON.parse(readFileSync(new URL('../parks/talma-reference.json', import.meta.url), 'utf8')) as Layout;
const t = createSlope(toSlopeConfig(layout));
const c = createContact();

/** Where a feature is taken (z), and across the slope (x). */
function target(f: FeatureSpec): { x: number; z: number } {
  if (f.kind === 'rail') {
    const p = f.cfg.points[0] ?? [0, 0, 0];
    return { x: p[0], z: p[2] };
  }
  const k = f.cfg as { x: number; z: number };
  return { x: k.x, z: k.z - (f.meta?.lip ?? 0) };
}

let failures = 0;
for (const line of layout.lines) {
  const feats = line.features.map((i) => layout.features[i]).filter((f): f is FeatureSpec => f !== undefined);
  const targets = feats.map(target);
  const x0 = targets[0]?.x ?? 0;
  const s = createRiderState({ position: { x: x0, y: t.sample(x0, layout.spawn.z, c).height + 0.05, z: layout.spawn.z }, heading: Math.PI });
  console.log(line.name);
  let fi = 0;
  let at = 0; // speed arriving at the current feature
  let railed = false;
  let flew = false;
  for (let i = 0; i < 120 * 120 && fi < feats.length && s.position.z > -layout.ground.length; i++) {
    const f = feats[fi];
    const tg = targets[fi];
    if (!f || !tg) break;
    const inp = neutralInput();
    const speed = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
    const toGo = s.position.z - tg.z;
    if (s.mode === 'grounded') {
      // Hold the line: aim 10 m ahead on it.
      const want = Math.atan2(tg.x - s.position.x, 10);
      const vh = Math.atan2(s.velocity.x, -s.velocity.z);
      inp.lx = Math.max(-0.6, Math.min(0.6, (want - vh) * 2));
      const time = toGo / Math.max(1, -s.velocity.z);
      // A rail takes a light ollie (0.1 s of charge) to clear its 0.5 m and come down on it.
      const lead = f.kind === 'rail' ? 0.12 : params.pop.chargeTime + 0.05;
      if (time < lead && time > 0.02) inp.rt = 1;
      if (time < 0.4) inp.lx = 0;
      // Rails are taken at their design speed: scrub to it on the way in (kickers: never brake).
      const top = (f.meta?.speed?.[1] ?? 99) - 1;
      if (f.kind === 'rail' && toGo > 0 && toGo < 40 && speed > top && time > 0.4) inp.lt = Math.min(1, (speed - top) * 0.8);
    }
    if (toGo > 0 && s.mode === 'grounded') at = speed; // run-in speed, not the pop
    const was = s.mode;
    tick(s, inp, params, t, TICK_DT);
    if (s.mode === 'railed') railed = true;
    if (s.mode === 'airborne' && toGo < 1) flew = true; // only off this feature, not a drop on the way
    const passed = s.position.z < tg.z - (f.kind === 'rail' ? 14 : 30);
    const landed = flew && was === 'airborne' && s.mode !== 'airborne' && f.kind !== 'rail';
    if (passed || landed || s.mode === 'bailed') {
      const design = f.meta?.speed ?? [0, 99];
      const ok = at >= design[0] && at <= design[1];
      const how = s.mode === 'bailed' ? 'BAIL' : f.kind === 'rail' ? (railed ? 'railed' : 'MISSED') : s.landing || 'rode';
      if (!ok || how === 'BAIL' || how === 'MISSED' || how === 'bail') failures++;
      console.log(`  ${f.meta?.type ?? f.kind} at z ${tg.z.toFixed(0)}: ${at.toFixed(1)} m/s (design ${design.join('–')}) ${ok ? 'ok' : 'OUT'}, ${how}`);
      if (s.mode === 'bailed') break;
      fi++;
      railed = false;
      flew = false;
    }
  }
}
console.log(failures ? `${failures} failed` : 'all passed');
