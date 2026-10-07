/**
 * The obstacles from docs/obstacles-plan.md, ridden: `npm run obstacle-check`. Each is designed
 * at the origin facing down −Z on a plane, then the real rider rides it straight down its axis
 * at a few speeds — run-in speed found so it reaches the takeoff at the speed asked — popping
 * fully at the takeoff or not at all. Prints what happened against each obstacle's done-when.
 */
import { TICK_DT } from '../src/core/loop.ts';
import { GEN } from '../src/gen/config.ts';
import { designHipQuarter, designBerm, designBooter, designCorner, designDrop, designEuroGap, designFunBox, designGapToRail, designHip, designJibTable, designKnoll, designLog, designMini, designMiniPipe, designStepDown, designStepDownHip, designWallRide, designWedge, groundFrame } from '../src/gen/kit.ts';
import { neutralInput } from '../src/input/snapshot.ts';
import { toSlopeConfig, type FeatureSpec, type Ground } from '../src/park/layout.ts';
import { params } from '../src/sim/params.ts';
import { createRng } from '../src/sim/rng.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState } from '../src/sim/state.ts';
import { createContact, createSlope, type Terrain } from '../src/sim/terrain.ts';

const DEG = Math.PI / 180;
const c = createContact();
const place = { x: 0, z: 0, yaw: 0 };
/** A kit design's inputs, drawn from a seed. */
const draw = (seed: number): { rng: ReturnType<typeof createRng>; inputs: Record<string, number> } => ({ rng: createRng(seed), inputs: {} });

function world(parts: FeatureSpec[], pitch: number | Ground): Terrain {
  const ground = typeof pitch === 'number' ? { length: 600, width: 300, pitch } : pitch;
  return createSlope(toSlopeConfig({ version: 1, name: '', ground, spawn: { x: 0, z: 0, heading: 0 }, features: parts, lines: [], links: [] }));
}

/**
 * Ride a berm at the origin (yaw 0) round its arc, `uT` out from it on the bank, entering at
 * about `v` m/s. Returns the % of speed kept from the start of the arc to the end of its sweep.
 */
function rideBerm(t: Terrain, b: { radius: number; sweep: number; side: number; bank: number; height: number }, v: number): string {
  const uT = 2 + b.height / Math.tan(b.bank) / 2; // halfway up the bank, past its 2 m foot
  const rho = b.radius + uT;
  const cx = b.side * b.radius;
  const s = createRiderState({ position: { x: -b.side * uT, y: 0, z: 10 }, heading: Math.PI });
  s.position.y = t.sample(s.position.x, 10, c).height + 0.05;
  s.mode = 'grounded';
  s.velocity.z = -(v - 2); // ~2 m/s more by the arc's start, 10 m down the 14° plane
  let vIn = NaN;
  for (let k = 0; k < 120 * 12; k++) {
    const i = neutralInput();
    const rx = s.position.x - cx;
    const rz = s.position.z;
    const dist = Math.hypot(rx, rz);
    const phi = Math.atan2(-rz, -b.side * rx); // 0 at the arc's start, sweeping round to `sweep`
    const speed = Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z);
    if (s.position.z < 0 && Number.isNaN(vIn)) vIn = speed;
    if (s.position.z < 0 && phi >= b.sweep) return ((speed / vIn) * 100).toFixed(0);
    if (s.mode === 'bailed') return 'bailed';
    if (s.position.z < 0) {
      const nx = rx / dist;
      const nz = rz / dist;
      const target = Math.atan2(-b.side * nz, b.side * nx); // the arc's tangent
      const err = Math.atan2(Math.sin(target - s.heading), Math.cos(target - s.heading));
      const sp = Math.hypot(s.velocity.x, s.velocity.z);
      const sf = 1 - Math.exp((-Math.log(5) * sp) / params.ground.speedFactorKnee);
      // + edge turns toward +X (heading down), so the turn's side sets the sign.
      i.lx = Math.max(-1, Math.min(1, b.side * (sp / rho / (params.ground.carveYaw * sf) + 0.25 * (dist - rho)) - 1.5 * err));
    }
    tick(s, i, params, t, TICK_DT);
  }
  return 'never round';
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
    // Board pointed the way it travels: heading π faces −Z, and less turns the nose toward +X.
    const s = createRiderState({ position: { x: 0, y: t.sample(0, start, c).height + 0.05, z: start }, heading: Math.PI - Math.atan2(vx, v0) });
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
  const mini = designMini(place, draw(1), GEN);
  for (const v of [6, 8, 10]) console.log(`mini ${v} m/s pop: ${fmt(ride(world(mini, pitch), lipZ(mini[0]!), v, 1, -40))}`);

  // Knoll — done when: popped at its crest at 8–14 m/s, lands clean.
  const knoll = designKnoll(place, draw(2), GEN);
  for (const v of [8, 11, 14]) console.log(`knoll ${v} m/s pop: ${fmt(ride(world(knoll, pitch), 0, v, true, -50))}`);

  // Log — an ollie onto it (bonk or slide) at 6 m/s.
  const log = designLog(place, draw(3), GEN);
  for (const pop of [0.3, 1]) console.log(`log 6 m/s pop ${pop}: ${fmt(ride(world(log, pitch), railStart(log[0]) + 0.8, 6, pop, railEnd(log[0]) - 20))}`);

  // Euro gap — done when: the slowest speed clears the rail; going short locks onto it.
  for (const size of ['M', 'L'] as const) {
    const eg = designEuroGap(place, size, pitch, draw(4), GEN, params);
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
  const g2r = designGapToRail(place, pitch, draw(5), GEN, params);
  if (!g2r.length) console.log('gap to rail: no fit');
  else {
    const [a = 0, b = 0] = g2r[0]!.meta?.speed ?? [];
    for (const pop of [0, 0.5, 1]) {
      console.log(`gap to rail ${((a + b) / 2).toFixed(1)} m/s pop ${pop} (lip ${(-lipZ(g2r[0]!)).toFixed(1)}, rail ${(-railStart(g2r[1])).toFixed(1)}–${(-railEnd(g2r[1])).toFixed(1)} m): ${fmt(ride(world(g2r, pitch), lipZ(g2r[0]!), (a + b) / 2, pop, railEnd(g2r[1]) - 15))}`);
    }
  }

  // Jib table — done when: popped onto the rail at rail speed, it rides to the end.
  const jt = designJibTable(place, draw(6), GEN);
  for (const [v, pop] of [[5, 0.3], [7, 0.3], [7, 1]] as const) {
    console.log(`jib table ${v} m/s pop ${pop} at rail (${(-railStart(jt[1])).toFixed(1)}–${(-railEnd(jt[1])).toFixed(1)} m): ${fmt(ride(world(jt, pitch), railStart(jt[1]) + 0.8, v, pop, railEnd(jt[1]) - 10))}`);
  }

  // Mini pipe — only on its grade. Done when: ridden down the middle it doesn't stop; ridden
  // into a wall it comes back without a bail.
  const mp = designMiniPipe(place, pitch, draw(7), GEN);
  if (!mp.length) console.log('mini pipe: not on this grade');
  else {
    const len = mp[0]!.kind === 'quarter' ? mp[0]!.cfg.width : 0;
    console.log(`mini pipe (${len.toFixed(0)} m) down the middle 6 m/s: ${fmt(ride(world(mp, pitch), -2, 6, 0, -len))}`);
    for (const across of [3, 5, 7]) console.log(`mini pipe into the wall 8 m/s, ${across} m/s across: ${fmt(ride(world(mp, pitch), -2, 8, 0, -len, across))}`);
  }
}

// Build step 3, on ground that falls away: 12° steepening to 32° from z = −18 (step-down,
// booter) or −50 (the drop, whose shelf rises 30–50 m before its edge).
{
  console.log('\n== real ground ==');
  const steepAt = (z: number): Ground => ({ length: 600, width: 300, pitch: 12 * DEG, grades: [{ z, pitch: 32 * DEG, blend: 6 }] });
  const sd = designStepDown(place, 'M', 20 * DEG, world([], steepAt(-18)), GEN, params);
  if (!sd.length) console.log('step-down: no fit');
  else {
    const [vMin = 0, vMax = 0] = sd[0]!.meta?.speed ?? [];
    for (const [v, pop] of [[vMin, 0], [vMin, 1], [vMax, 0.5], [vMax, 1]] as const) console.log(`step-down M ${v} m/s pop ${pop}: ${fmt(ride(world(sd, steepAt(-18)), lipZ(sd[0]!), v, pop, -90))}`);
  }
  const bo = designBooter(place, world([], steepAt(-18)), draw(8), GEN, params);
  if (!bo.length) console.log('booter: no fit');
  else {
    const [a = 0, b = 0] = bo[0]!.meta?.speed ?? [];
    for (const [v, pop] of [[a, 0.5], [(a + b) / 2, 0], [(a + b) / 2, 1], [b, 0.5]] as const) console.log(`booter ${v} m/s pop ${pop}: ${fmt(ride(world(bo, steepAt(-18)), lipZ(bo[0]!), v, pop, -120))}`);
  }
  const dr = designDrop(place, world([], steepAt(-50)), draw(9), GEN, params);
  if (!dr.length) console.log('drop: no fit');
  else {
    const f = dr[0]!;
    const h = f.kind === 'shape' && f.cfg.kind === 'shelf' ? f.cfg.height : 0;
    for (const [v, pop] of [[6, 0], [10, 0], [14, 0.5], [3, 0]] as const) console.log(`drop ${h} m (edge ${(-lipZ(f)).toFixed(0)} m) ${v} m/s pop ${pop}: ${fmt(ride(world(dr, steepAt(-50)), lipZ(f), v, pop, lipZ(f) - 60))}`);
  }
  // Corner: across a 13° plane at 60° off the fall line, ridden in its own frame.
  const across = { x: 0, z: 0, yaw: 60 * DEG };
  const plane = world([], 13 * DEG);
  const co = designCorner(across, 'M', plane, GEN, params);
  const k = co[0]?.kind === 'kicker' ? co[0].cfg : undefined;
  console.log(`corner M at 60°: tilt ${(((k?.tilt ?? 0) / DEG)).toFixed(1)}°`);
  const view = groundFrame(world(co, 13 * DEG), across);
  const [vMin = 0, vMax = 0] = co[0]?.meta?.speed ?? [];
  for (const [v, pop] of [[vMin, 0], [vMin, 1], [vMax, 0.5]] as const) console.log(`corner M ${v} m/s pop ${pop}: ${fmt(ride(view, lipZ(co[0]!), v, pop, -70))}`);
  // Cross-fall of the landing just past the knuckle, levelled vs the bare ground.
  const n = view.sample(0, lipZ(co[0]!) - (k?.deckLength ?? 0) - 2, c).normal;
  console.log(`corner landing cross-fall 2 m past the knuckle: ${(Math.atan(n.x / n.y) / DEG).toFixed(1)}° (ground ${((k?.tilt ?? 0) / DEG).toFixed(1)}°)`);
}

// Build step 4, on a 14° plane.
{
  console.log('\n== step 4 (14°) ==');
  const pitch = 14 * DEG;
  for (const seed of [10, 11, 12, 17]) {
    const wg = designWedge(place, draw(seed), GEN);
    const g = wg[0]!.cfg as { faces: number; height: number; top: number };
    for (const [v, pop] of [[8, 0], [8, 0.5], [11, 0.5]] as const) console.log(`${wg[0]!.meta?.type} ${g.height.toFixed(1)} m, top ${g.top.toFixed(1)} m, ${v} m/s pop ${pop}: ${fmt(ride(world(wg, pitch), lipZ(wg[0]!), v, pop, -60))}`);
  }
  const fb = designFunBox(place, draw(13), GEN);
  for (const [v, pop] of [[7, 0.3], [9, 0.3]] as const) console.log(`fun box ${v} m/s pop ${pop} at the box (${(-railStart(fb[1])).toFixed(1)}–${(-railEnd(fb[1])).toFixed(1)} m): ${fmt(ride(world(fb, pitch), railStart(fb[1]) + 0.8, v, pop, -60))}`);
  // Berm: the bank angle halfway round, just past its foot.
  const bm = designBerm(place, draw(14), GEN);
  const b = bm[0]!.cfg as { radius: number; sweep: number; side: number; bank: number; height: number };
  const bw = world(bm, pitch);
  const mid = b.sweep / 2;
  let steepest = 0;
  for (let u = 0; u < 2 + b.height / Math.tan(b.bank) + 1; u += 0.1) {
    const r = b.radius + u;
    steepest = Math.max(steepest, Math.acos(bw.sample(b.side * (b.radius - r * Math.cos(mid)), -r * Math.sin(mid), c).normal.y));
  }
  console.log(`berm r ${b.radius.toFixed(0)} m, ${(b.sweep / DEG).toFixed(0)}°, bank ${(b.bank / DEG).toFixed(0)}°: steepest ${(steepest / DEG).toFixed(0)}° from level across it halfway round (ground 14°)`);
  // Ridden round: a steering bot holds the arc halfway up the bank (feed-forward on the carve's
  // own turn rate, plus a pull back onto the line). Speed kept over the sweep, against the same
  // line on bare snow. Done when ≥ 90%.
  const flat = world([], pitch);
  for (const v of [10, 13, 16]) console.log(`  in at ${v} m/s: berm keeps ${rideBerm(bw, b, v)}% · same line on bare snow ${rideBerm(flat, b, v)}%`);
  // Wall ride turned 30° off the fall line: ridden in its own frame, drifting into the wall.
  const wplace = { x: 0, z: 0, yaw: 30 * DEG };
  const wr = designWallRide(wplace, draw(15), GEN);
  const wc = wr[0]!.cfg as { side: number; angle: number; length: number };
  const wview = groundFrame(world(wr, pitch), wplace);
  for (const v of [10, 13]) for (const across of [3, 7]) console.log(`wall ride ${(wc.angle / DEG).toFixed(0)}°, ${wc.length.toFixed(0)} m, turned 30°, ${v} m/s, ${across} m/s into it: ${fmt(ride(wview, -3, v, 0, -wc.length - 10, wc.side * across))}`);
  // Hips sized from flight, each size: slowest, middle and top speed at the low, middle and high
  // aim, popped halfway, board pointed along the aim. Then a step-down hip (M).
  const hipRuns = (hp: FeatureSpec, label: string): void => {
    const c = hp.cfg as { lipHeight: number; deckLength: number; hip?: { side: number; stepDown?: number; landingStart: number; landingEnd: number } };
    const P = GEN.hip.sizes[(hp.meta?.size ?? 'M') as 'S' | 'M' | 'L' | 'XL'];
    const toward = c.hip?.side || 1;
    const rows: string[] = [];
    for (const aim of [P.aim[0] ?? 10, ((P.aim[0] ?? 10) + (P.aim[1] ?? 30)) / 2, P.aim[1] ?? 30]) {
      for (const v of [P.speed[0] ?? 8, ((P.speed[0] ?? 8) + (P.speed[1] ?? 11)) / 2, P.speed[1] ?? 11]) {
        const r = ride(world([hp], pitch), lipZ(hp), v * Math.cos(aim * DEG), 0.5, -120, toward * v * Math.sin(aim * DEG));
        rows.push(`${aim}°/${v.toFixed(1)}: ${r.landings[0] ?? 'none'}`);
      }
    }
    console.log(`${label}: deck ${c.lipHeight.toFixed(1)} m, lip +${(c.hip?.stepDown ?? 0).toFixed(1)}, table ${c.deckLength.toFixed(1)} m, landing ${((c.hip?.landingStart ?? 0) / DEG).toFixed(0)}→${((c.hip?.landingEnd ?? 0) / DEG).toFixed(0)}° · ${rows.join(' · ')}`);
  };
  for (const size of ['S', 'M', 'L', 'XL'] as const) {
    const t0 = Date.now();
    const hp = designHip(place, size, draw(16), GEN, params, pitch);
    hipRuns(hp, `${hp.meta?.type} ${size} (${Date.now() - t0} ms)`);
  }
  const sdh = designStepDownHip(place, 'M', draw(16), GEN, params, pitch);
  hipRuns(sdh[0]!, `${sdh[0]!.meta?.type} M`);
}

// Hip quarter (inside corner), both ways round: airs up the first section toward the corner.
// The bot doesn't spin, so judge the air: does it come down on the second section's face?
{
  console.log('\n== hip quarter (10° plane) ==');
  const pitch = 10 * DEG;
  for (const seed of [20, 21, 22, 23]) {
    const hq = designHipQuarter(place, draw(seed), GEN);
    const [a, b] = hq.map((f) => f.cfg as { x: number; z: number; yaw?: number; width: number });
    const t = world(hq, pitch);
    const onA = world([hq[0]!], pitch);
    const onB = world([hq[1]!], pitch);
    const flat = createSlope({ length: 600, width: 300, pitch });
    const side = Math.sign(a!.x) || 1; // the first section's side; ride toward the corner from it
    let onFace = 0;
    let total = 0;
    for (const v of [9, 12]) for (const off of [20, 35, 50]) {
      const x0 = side * 8;
      const s = createRiderState({ position: { x: x0, y: t.sample(x0, 14, c).height + 0.05, z: 14 }, heading: Math.PI + side * off * DEG });
      s.mode = 'grounded' as typeof s.mode;
      s.velocity.x = -side * v * Math.sin(off * DEG);
      s.velocity.z = -v * Math.cos(off * DEG);
      let air = 0;
      for (let i = 0; i < 120 * 8; i++) {
        const was = s.mode;
        tick(s, neutralInput(), params, t, TICK_DT);
        if (s.mode === 'airborne') air += TICK_DT;
        if (was === 'airborne' && s.mode !== 'airborne' && air > 0.25) {
          total++;
          const hb = onB.sample(s.position.x, s.position.z, c).height - flat.sample(s.position.x, s.position.z, c).height;
          const ha = onA.sample(s.position.x, s.position.z, c).height - flat.sample(s.position.x, s.position.z, c).height;
          if (hb > ha && hb > 0.3) onFace++;
          break;
        }
        if (s.mode === 'bailed') break;
      }
    }
    console.log(`hip quarter ${b!.width.toFixed(0)} m sections, ${(Math.abs((b!.yaw ?? 0) - (a!.yaw ?? 0)) / DEG).toFixed(0)}°, first section to ${side > 0 ? '+X' : '−X'}: ${onFace} of ${total} airs come down on the second section's face`);
  }
}
