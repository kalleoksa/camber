/**
 * The obstacles from docs/obstacles-plan.md, ridden: `npm run obstacle-check`. Each is designed
 * at the origin facing down −Z on a plane, then the real rider rides it straight down its axis
 * at a few speeds — run-in speed found so it reaches the takeoff at the speed asked — popping
 * fully at the takeoff or not at all. Prints what happened against each obstacle's done-when.
 */
import { TICK_DT } from '../src/core/loop.ts';
import { GEN } from '../src/gen/config.ts';
import { designEuroGap, designGapToRail, designJibTable, designKnoll, designLog, designMini, designMiniPipe } from '../src/gen/kit.ts';
import { neutralInput } from '../src/input/snapshot.ts';
import { toSlopeConfig, type FeatureSpec } from '../src/park/layout.ts';
import { params } from '../src/sim/params.ts';
import { createRng } from '../src/sim/rng.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState } from '../src/sim/state.ts';
import { createContact, createSlope, type Terrain } from '../src/sim/terrain.ts';

const DEG = Math.PI / 180;
const c = createContact();
const place = { x: 0, z: 0, yaw: 0 };

function world(parts: FeatureSpec[], pitch: number): Terrain {
  return createSlope(toSlopeConfig({ version: 1, name: '', ground: { length: 600, width: 300, pitch }, spawn: { x: 0, z: 0, heading: 0 }, features: parts, lines: [], links: [] }));
}

type Run = { at: number; modes: string; landings: string[]; touch: number[]; railTime: number; end: number; airs: number; shortest: number };

/**
 * Ride down −Z from a few metres above `popZ` so the speed 1 m before it is `target`; pop fully
 * at `popZ` or not. Runs to `endZ`, a stop, or 20 s. `vx`: sideways speed at the start, for
 * riding into a wall. `pop`: how much of a full charge (0 none, 1 full). Landings and
 * touchdowns are counted from the first takeoff on.
 */
function ride(t: Terrain, popZ: number, target: number, pop: number, endZ: number, vx = 0): Run {
  const start = popZ + 6;
  let v0 = target;
  let out: Run = { at: 0, modes: '', landings: [], touch: [], railTime: 0, end: 0, airs: 0, shortest: 0 };
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = createRiderState({ position: { x: 0, y: t.sample(0, start, c).height + 0.05, z: start }, heading: Math.PI });
    s.mode = 'grounded';
    s.velocity.z = -v0;
    s.velocity.x = vx;
    let at = 0;
    const modes: string[] = [];
    const landings: string[] = [];
    const touch: number[] = [];
    let railTime = 0;
    let airs = 0;
    let shortest = Infinity;
    let airTime = 0;
    for (let i = 0; i < 120 * 20; i++) {
      const inp = neutralInput();
      const toPop = (s.position.z - popZ) / Math.max(1, -s.velocity.z);
      if (pop > 0 && s.mode === 'grounded' && toPop < params.pop.chargeTime * pop + 0.05 && toPop > 0.02) inp.rt = 1;
      const was = s.mode;
      const z0 = s.position.z;
      tick(s, inp, params, t, TICK_DT);
      if (z0 >= popZ + 1 && s.position.z < popZ + 1 && at === 0) at = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
      if (s.mode !== was) modes.push(s.mode);
      if (s.mode === 'airborne') airTime += TICK_DT;
      if (was === 'airborne' && s.mode !== 'airborne') {
        airs++;
        shortest = Math.min(shortest, airTime);
        airTime = 0;
      }
      if (was === 'airborne' && s.mode !== 'airborne') {
        landings.push(s.landing);
        touch.push(popZ - s.position.z);
      }
      if (s.mode === 'railed') railTime += TICK_DT;
      const speed = Math.hypot(s.velocity.x, s.velocity.z);
      if (s.position.z < endZ || (i > 240 && speed < 0.3) || s.mode === 'bailed') break;
    }
    out = { at, modes: modes.length > 8 ? `${modes.slice(0, 4).join('>')}>…` : modes.join('>'), landings, touch, railTime, end: Math.hypot(s.velocity.x, s.velocity.z), airs, shortest };
    const err = target - at;
    if (Math.abs(err) < 0.15 || at === 0) break;
    v0 = Math.max(0.5, v0 + err);
  }
  return out;
}

const fmt = (r: Run): string => {
  const landings = r.landings.length > 4 ? `${r.airs} airs, shortest ${r.shortest.toFixed(2)} s, ${r.landings.filter((l) => l === 'bail').length} bails` : r.landings.map((l, i) => `${l} +${(r.touch[i] ?? 0).toFixed(1)}m`).join(', ');
  return `at ${r.at.toFixed(1)} m/s · ${r.modes || 'grounded'} · ${landings || 'no air'}${r.railTime > 0 ? ` · railed ${r.railTime.toFixed(2)} s` : ''} · out ${r.end.toFixed(1)} m/s`;
};

const lipZ = (f: FeatureSpec): number => -(f.meta?.lip ?? 0);
const railStart = (f: FeatureSpec | undefined): number => (f?.kind === 'rail' ? (f.cfg.points[0]?.[2] ?? 0) : 0);
const railEnd = (f: FeatureSpec | undefined): number => (f?.kind === 'rail' ? (f.cfg.points[f.cfg.points.length - 1]?.[2] ?? 0) : 0);

for (const deg of [12, 20]) {
  const pitch = deg * DEG;
  console.log(`\n== ${deg}° ==`);

  // Mini kicker — done when: popped at 6–10 m/s, lands clean 3–8 m past the lip.
  const mini = designMini(place, createRng(1), GEN);
  for (const v of [6, 8, 10]) console.log(`mini ${v} m/s pop: ${fmt(ride(world(mini, pitch), lipZ(mini[0]!), v, 1, -40))}`);

  // Knoll — done when: popped at its crest at 8–14 m/s, lands clean.
  const knoll = designKnoll(place, createRng(2), GEN);
  for (const v of [8, 11, 14]) console.log(`knoll ${v} m/s pop: ${fmt(ride(world(knoll, pitch), 0, v, true, -50))}`);

  // Log — an ollie onto it (bonk or slide) at 6 m/s.
  const log = designLog(place, createRng(3), GEN);
  for (const pop of [0.3, 1]) console.log(`log 6 m/s pop ${pop}: ${fmt(ride(world(log, pitch), railStart(log[0]) + 0.8, 6, pop, railEnd(log[0]) - 20))}`);

  // Euro gap — done when: the slowest speed clears the rail; going short locks onto it.
  for (const size of ['M', 'L'] as const) {
    const eg = designEuroGap(place, size, pitch, createRng(4), GEN, params);
    if (!eg.length) {
      console.log(`euro gap ${size}: no fit`);
      continue;
    }
    const [vMin = 0, vMax = 0] = eg[0]!.meta?.speed ?? [];
    for (const [v, pop] of [[vMin, 0], [vMin, 0.5], [vMin, 1], [vMax, 0.5], [vMax, 1], [vMin * 0.7, 0.5]] as const) {
      console.log(`euro gap ${size} ${v.toFixed(1)} m/s pop ${pop}: ${fmt(ride(world(eg, pitch), lipZ(eg[0]!), v, pop, -80))}`);
    }
  }

  // Gap to rail — done when: at mid design speed, popped, it locks on near the rail's start.
  const g2r = designGapToRail(place, pitch, createRng(5), GEN, params);
  if (!g2r.length) console.log('gap to rail: no fit');
  else {
    const [a = 0, b = 0] = g2r[0]!.meta?.speed ?? [];
    for (const pop of [0, 0.5, 1]) {
      console.log(`gap to rail ${((a + b) / 2).toFixed(1)} m/s pop ${pop} (lip ${(-lipZ(g2r[0]!)).toFixed(1)}, rail ${(-railStart(g2r[1])).toFixed(1)}–${(-railEnd(g2r[1])).toFixed(1)} m): ${fmt(ride(world(g2r, pitch), lipZ(g2r[0]!), (a + b) / 2, pop, railEnd(g2r[1]) - 15))}`);
    }
  }

  // Jib table — done when: popped onto the rail at rail speed, it rides to the end.
  const jt = designJibTable(place, createRng(6), GEN);
  for (const [v, pop] of [[5, 0.3], [7, 0.3], [7, 1]] as const) {
    console.log(`jib table ${v} m/s pop ${pop} at rail (${(-railStart(jt[1])).toFixed(1)}–${(-railEnd(jt[1])).toFixed(1)} m): ${fmt(ride(world(jt, pitch), railStart(jt[1]) + 0.8, v, pop, railEnd(jt[1]) - 10))}`);
  }

  // Mini pipe — only on its grade. Done when: ridden down the middle it doesn't stop; ridden
  // into a wall it comes back without a bail.
  const mp = designMiniPipe(place, pitch, createRng(7), GEN);
  if (!mp.length) console.log('mini pipe: not on this grade');
  else {
    const len = mp[0]!.kind === 'quarter' ? mp[0]!.cfg.width : 0;
    console.log(`mini pipe (${len.toFixed(0)} m) down the middle 6 m/s: ${fmt(ride(world(mp, pitch), -2, 6, 0, -len))}`);
    for (const across of [3, 5, 7]) console.log(`mini pipe into the wall 8 m/s, ${across} m/s across: ${fmt(ride(world(mp, pitch), -2, 8, 0, -len, across))}`);
  }
}
