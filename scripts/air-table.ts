/**
 * The jump line, headless: ride it from the spawn, pop at each lip, and print what comes
 * out — takeoff speed, airtime, distance — then the rotation each wind-up gives on each
 * kicker, and how it lands. Run it after touching anything in `air` or the park.
 */
import { TICK_DT } from '../src/core/loop.ts';
import { neutralInput } from '../src/input/snapshot.ts';
import { params } from '../src/sim/params.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState } from '../src/sim/state.ts';
import { createContact, createSlope } from '../src/sim/terrain.ts';
import { PARK } from '../src/park/park.ts';
const t = createSlope(PARK);
const all = PARK.kickers ?? [];
const lineX = all[0]?.x ?? 0;
const kickers = all.filter((k) => Math.abs(k.x - lineX) < 1).sort((a, b) => b.z - a.z);
const lipZ = (k: (typeof kickers)[number]) => k.z - (k.lipHeight / (1 - Math.cos(k.lipAngle))) * Math.sin(k.lipAngle);
// windAt: kicker index to wind up on; wind: s of wind-up (stick against); dir ±1; flip: ly at pop
function ride(opts: { windAt?: number; wind?: number; dir?: number; flip?: number; tuck?: boolean } = {}) {
  const x = lineX;
  const s = createRiderState({ position: { x, y: t.sample(x, 0, createContact()).height + 1.5, z: 0 }, heading: Math.PI });
  const out: { kicker: number; speed: number; air: number; dist: number; rot: number; landing: string; mode: string }[] = [];
  let ki = 0;
  let cur: { k: number; v: number; z0: number; t: number; yaw0: number } | null = null;
  for (let i = 0; i < 120 * 120 && ki < kickers.length; i++) {
    const inp = neutralInput();
    const k = kickers[ki];
    if (!k) break;
    const lip = lipZ(k);
    const z = s.position.z;
    const dir = opts.dir ?? 1;
    if (s.mode === 'grounded' && !cur) {
      // keep on the line: steer x back toward the kicker centre gently
      inp.lx = Math.max(-0.3, Math.min(0.3, (s.position.x - x) * -0.3 * Math.sign(s.velocity.z || -1) * -1));
      const charge = Math.max(params.pop.chargeTime, opts.windAt === ki ? (opts.wind ?? 0) : 0) + 0.05;
      const toLip = (z - lip) / Math.max(1, -s.velocity.z);
      if (toLip < charge && toLip > 0.03) { inp.rt = 1; if (opts.windAt === ki && (opts.wind ?? 0) > 0 && toLip < (opts.wind ?? 0)) inp.lx = dir; }
      // the release tick: the pop fires here and takeoff reads the stick — send toward the spin
      if (toLip <= 0.03 && toLip > -0.2 && opts.windAt === ki) { inp.lx = (opts.wind ?? 0) > 0 ? -dir : 0; if (opts.flip) inp.ly = opts.flip; }
    } else if (cur && s.mode === 'airborne') {
      if (opts.windAt === ki && cur.t < params.air.flickWindow) { inp.lx = -dir; if (opts.flip) inp.ly = opts.flip; }
      else if (opts.windAt === ki && opts.tuck) inp.lx = -dir;
    }
    const was = s.mode;
    tick(s, inp, params, t, TICK_DT);
    if (was !== 'airborne' && s.mode === 'airborne' && s.position.z < lip + 3 && !cur) {
      cur = { k: ki, v: Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z) * 3.6, z0: s.position.z, t: 0, yaw0: s.airYaw };
    }
    if (cur && s.mode === 'airborne') cur.t += TICK_DT;
    if (cur && s.mode !== 'airborne') {
      out.push({ kicker: ki, speed: +cur.v.toFixed(0), air: +cur.t.toFixed(2), dist: +(cur.z0 - s.position.z).toFixed(1), rot: Math.round(((s.airYaw - cur.yaw0) * 180) / Math.PI), landing: s.landing, mode: s.mode });
      cur = null; ki++;
    }
  }
  return out;
}


console.table(ride());
const winds = [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5];
console.log(`spin by wind-up (s), send at the pop — ✓ clean, ~ sketchy, ✗ bail`);
for (let k = 0; k < kickers.length; k++) {
  const row = winds.map((w) => {
    const r = ride({ windAt: k, wind: w, dir: 1 })[k];
    return r ? `${w}:${r.rot}${r.landing === 'clean' ? '✓' : r.landing === 'sketchy' ? '~' : '✗'}` : '—';
  });
  console.log(`kicker ${k}  ${row.join('  ')}`);
}
