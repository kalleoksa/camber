/**
 * The jump section's lanes, headless: ride a route — a lane letter per row, L / M / R, then
 * one more for the corner (e.g. "RMLMRL") — steering onto each kicker, centring the stick for
 * the pop, and print per jump: horizontal speed at takeoff, airtime, where it landed past the
 * knuckle (− is short, on the rise) and how. The steering is a crude bot: a human plans a lane
 * switch earlier, so read switches as a lower bound. `npm run lanes -- LLLLLL,RMLMRL`.
 */
import { TICK_DT } from '../src/core/loop.ts';
import { neutralInput } from '../src/input/snapshot.ts';
import { params } from '../src/sim/params.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState } from '../src/sim/state.ts';
import { createContact, createSlope } from '../src/sim/terrain.ts';
import { kickerSpan } from '../src/park/sochi.ts';
import { PARK } from '../src/park/park.ts';
const t = createSlope(PARK);
const jumps = (PARK.kickers ?? []).filter((k) => k.knuckleHeight !== undefined);
const mid = jumps[0]!.x;
const laneOf = (x: number) => (x < mid - 15 ? 'L' : x > mid + 15 ? 'R' : 'M');
const lipZ = (k: (typeof jumps)[number]) => k.z - (k.lipHeight / (1 - Math.cos(k.lipAngle))) * Math.sin(k.lipAngle);
// route: a lane letter per row, e.g. "MMMMM" or "LMRML"
function ride(route: string) {
  const byRow: (typeof jumps)[number][][] = [];
  for (const k of jumps.slice().sort((a, b) => b.z - a.z)) {
    const kn = k.z - kickerSpan(k).deck;
    const row = byRow.find((r) => Math.abs(r[0]!.z - kickerSpan(r[0]!).deck - kn) < 3);
    if (row) row.push(k); else byRow.push([k]);
  }
  byRow.sort((a, b) => (b[0]!.z - kickerSpan(b[0]!).deck) - (a[0]!.z - kickerSpan(a[0]!).deck));
  const plan: { x: number; z: number; lipHeight: number; lipAngle: number; corner?: boolean }[] = byRow.map((r, i) => r.find((k) => laneOf(k.x) === route[i])!);
  if (route.length > byRow.length) {
    const c = (PARK.corners ?? []).find((c) => laneOf(c.x) === route[byRow.length]);
    if (c) plan.push({ ...c, corner: true });
  }
  const first = plan[0]!;
  const s = createRiderState({ position: { x: first.x, y: t.sample(first.x, 0, createContact()).height + 1.5, z: 0 }, heading: Math.PI });
  const out: string[] = [];
  let ri = 0, cur: { v: number; t: number } | null = null;
  for (let i = 0; i < 120 * 140 && ri < plan.length; i++) {
    const k = plan[ri]!; const lip = lipZ(k); const z = s.position.z;
    const inp = neutralInput();
    if (s.mode === 'grounded' && !cur) {
      // steer to the kicker's line: aim point a few metres ahead on the way, straight on the ramp
      const dx = s.position.x - k.x;
      const dz = z - lip;
      // line up on a point 14 m before the lip, then ride straight over it
      const want = dz > 16 ? Math.atan2(-dx, Math.max(6, dz - 14)) : Math.max(-0.15, Math.min(0.15, -dx * 0.05));
      const vh = Math.atan2(s.velocity.x, -s.velocity.z);
      inp.lx = Math.max(-1, Math.min(1, (want - vh) * 3));
      const toLip = dz / Math.max(1, -s.velocity.z);
      if (toLip < 0.35) inp.lx = 0; // a stick at the pop sends a spin: centre it for the takeoff
      if (toLip < params.pop.chargeTime + 0.05 && toLip > 0.03) inp.rt = 1;
    }
    const was = s.mode;
    tick(s, inp, params, t, TICK_DT);
    if (was !== 'airborne' && s.mode === 'airborne' && s.position.z < lip + 3 && !cur) cur = { v: Math.hypot(s.velocity.x, s.velocity.z) * 3.6, t: 0 };
    if (cur && s.mode === 'airborne') cur.t += TICK_DT;
    if (cur && s.mode !== 'airborne') {
      const past = k.corner ? 0 : (k.z - kickerSpan(k as never).deck) - s.position.z;
      out.push(`${route[ri]}${ri}: ${cur.v.toFixed(0)}km/h ${cur.t.toFixed(1)}s ${past >= 0 ? '+' : ''}${past.toFixed(0)}m ${s.landing === 'clean' ? '✓' : s.landing === 'sketchy' ? '~' : '✗'}${Math.abs(s.position.x - k.x) > 4 ? ` off ${(s.position.x - k.x).toFixed(0)}m` : ''}${s.landing !== 'clean' ? ` imp ${s.impact.toFixed(1)} vx ${s.velocity.x.toFixed(1)}` : ''}`);
      cur = null; ri++;
    }
    if (!cur && s.mode === 'grounded' && s.position.z < lipZ(k) - 5 && ri < plan.length && was === 'grounded' && i > 0 && plan[ri] === k) { out.push(`${route[ri]}${ri}: missed (${(s.position.x - k.x).toFixed(0)}m off, ${(Math.hypot(s.velocity.x, s.velocity.z) * 3.6).toFixed(0)} km/h)`); ri++; }
  }
  return out.join(' | ');
}
for (const route of (process.argv[2] ?? 'MMMMMM,LLLLLL,RRRRRR,RMLMRL,LMRMLR').split(',')) console.log(route.padEnd(6), ride(route));
