/**
 * Generated lines, ridden: `npm run line-check -- [seed] [line]`. A crude bot follows each
 * line's path, checks speed (L2) down to each feature's design speed, pops at kicker lips and
 * rail starts, and prints per feature the speed it was taken at and how it landed. A human
 * picks better lines; read it as a lower bound and a sanity check that a line rides.
 */
import { TICK_DT } from '../src/core/loop.ts';
import { generateLayout } from '../src/gen/generate.ts';
import { neutralInput } from '../src/input/snapshot.ts';
import { toSlopeConfig, type FeatureSpec } from '../src/park/layout.ts';
import { params } from '../src/sim/params.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState } from '../src/sim/state.ts';
import { createContact, createSlope } from '../src/sim/terrain.ts';

const seed = Number(process.argv[2] ?? 1);
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
const layout = generateLayout(seed);
const t = createSlope(toSlopeConfig(layout));
const c = createContact();

/** Where a feature is taken: the lip for jumps, the start for rails and shapes; and its heading. */
function target(f: FeatureSpec): { x: number; z: number; yaw: number; pop: boolean } {
  if (f.kind === 'rail') {
    const [a, b] = [f.cfg.points[0]!, f.cfg.points[f.cfg.points.length - 1]!];
    return { x: a[0], z: a[2], yaw: Math.atan2(b[0] - a[0], -(b[2] - a[2])), pop: true };
  }
  const cfg = f.cfg as { x: number; z: number; yaw?: number };
  const yaw = cfg.yaw ?? 0;
  const lip = f.meta?.lip ?? 0;
  const pop = f.kind === 'kicker' || f.kind === 'corner';
  return { x: cfg.x + Math.sin(yaw) * lip, z: cfg.z - Math.cos(yaw) * lip, yaw, pop };
}

layout.lines.forEach((line, li) => {
  if (only !== undefined && li !== only) return;
  const path = line.path ?? [];
  const [sx, sz] = path[0] ?? [0, -5];
  const s = createRiderState({ position: { x: sx, y: t.sample(sx, sz, c).height + 0.05, z: sz }, heading: Math.PI });
  s.velocity.z = -5;
  let pi = 0;
  let fi = 0;
  const rows: string[] = [];
  let taken: { speed: number; off: number } | null = null;
  let airborne = false;
  let airZ = 0;
  const compare: string[] = [];
  let nextCmp = 0;
  for (let i = 0; i < 120 * 400 && fi < line.features.length; i++) {
    const f = layout.features[line.features[fi]!]!;
    const tg = target(f);
    const inp = neutralInput();
    const x = s.position.x;
    const z = s.position.z;
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    // Along the feature's axis: metres to go to its lip, and how far off its line.
    const ax = Math.sin(tg.yaw);
    const az = -Math.cos(tg.yaw);
    const toGo = (tg.x - x) * ax + (tg.z - z) * az;
    const off = (x - tg.x) * -az + (z - tg.z) * ax;
    if (s.mode === 'grounded') {
      // Aim: close in, along the feature's axis; further out, a point ahead on the path.
      // Nearest path point a little way ahead of the last, then aim a few points on from it.
      let best = Infinity;
      for (let j = pi; j < Math.min(path.length, pi + 40); j++) {
        const d2 = (path[j]![0] - x) ** 2 + (path[j]![1] - z) ** 2;
        if (d2 < best) {
          best = d2;
          pi = j;
        }
      }
      const aim = path[Math.min(path.length - 1, pi + 3)];
      let aimX = aim?.[0] ?? x;
      let aimZ = aim?.[1] ?? z - 10;
      if (toGo < 45 && toGo > -2) {
        aimX = tg.x - ax * Math.max(0, toGo - 12) + ax * 6;
        aimZ = tg.z - az * Math.max(0, toGo - 12) + az * 6;
      }
      const want = Math.atan2(aimX - x, -(aimZ - z));
      const vh = Math.atan2(s.velocity.x, -s.velocity.z);
      let d = want - vh;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      inp.lx = Math.max(-0.6, Math.min(0.6, d * 2));
      const time = toGo / Math.max(1, speed);
      if (time < 0.35 && toGo > -1) inp.lx = 0;
      // Check speed down to the design speed in time for the lip.
      // Brake to the lip speed plus what climbing the takeoff will take off it.
      const lipH = 'lipHeight' in f.cfg ? f.cfg.lipHeight : 0;
      const top = Math.sqrt((line.speed[fi] ?? 99) ** 2 + 2 * params.world.gravity * lipH);
      // Brake as early as the speed needs: L2 takes ~brakeDecel off, so start that far out plus some.
      const need = (speed * speed - top * top) / (2 * params.ground.brakeDecel) + 15;
      if (toGo > 0 && toGo < need && speed > top + 0.2) inp.lt = Math.min(1, (speed - top) * 0.8);
      if (time < 0.25) inp.lt = 0;
      if (tg.pop && time < params.pop.chargeTime + 0.05 && time > 0.02) inp.rt = 1;
      if (f.kind === 'rail' && time < 0.3 && time > 0.02) inp.rt = 1;
    }
    if (process.env.SPEEDS && pi >= nextCmp && s.mode === 'grounded') {
      compare.push(`${pi}:${(speed * 3.6).toFixed(0)}/${((path[pi]?.[2] ?? 0) * 3.6).toFixed(0)}`);
      nextCmp = pi + 4;
    }
    if (process.env.TRACE && i % 15 === 0 && z < Number(process.env.TRACE) && z > Number(process.env.TRACE) - 50) console.log(`  t${(i / 120).toFixed(2)} x${x.toFixed(1)} z${z.toFixed(1)} ${(speed * 3.6).toFixed(0)}km/h ${s.mode} lx${inp.lx.toFixed(2)} lt${inp.lt.toFixed(2)} rt${inp.rt} toGo${toGo.toFixed(0)} f${fi} h${(t.sample(x, z, c).height - (process.env.G ? 0 : 0)).toFixed(1)}`);
    const was = s.mode;
    tick(s, inp, params, t, TICK_DT);
    if (!taken && toGo < 0.5 && toGo > -3) taken = { speed: Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z), off };
    if (s.mode === 'airborne') airborne = true;
    if (was !== 'airborne' && s.mode === 'airborne') airZ = s.position.z;
    const done = taken && (toGo < -40 || (airborne && was === 'airborne' && s.mode !== 'airborne') || (f.kind === 'rail' && toGo < -25));
    if (done) {
      const how = s.mode === 'bailed' || s.landing === 'bail' ? 'BAIL' : airborne ? s.landing : s.mode === 'railed' || was === 'railed' ? 'rail' : 'rode';
      rows.push(`${f.meta?.type}${f.meta?.size ? ' ' + f.meta.size : ''} ${(taken!.speed * 3.6).toFixed(0)}/${((line.speed[fi] ?? 0) * 3.6).toFixed(0)}km/h ${how}${Math.abs(taken!.off) > 2 ? ` off ${taken!.off.toFixed(0)}m` : ''}`);
      fi++;
      taken = null;
      airborne = false;
    }
    if (s.mode === 'bailed') {
      rows.push(`(bailed at z ${z.toFixed(0)}: impact ${s.impact.toFixed(1)}, ${toGo.toFixed(0)} m to the next lip, off ${off.toFixed(1)} m, airborne since z ${airZ.toFixed(0)})`);
      break;
    }
  }
  const stopped = fi < line.features.length && s.mode !== 'bailed' ? ` (stopped at x ${s.position.x.toFixed(0)} z ${s.position.z.toFixed(0)}, ${(Math.hypot(s.velocity.x, s.velocity.z) * 3.6).toFixed(0)} km/h, ${s.mode})` : '';
  if (compare.length) console.log('  ride/predicted km/h by path point:', compare.join(' '));
  console.log(`seed ${seed} ${line.name}: ${rows.join(' → ')}${fi < line.features.length ? ` [${line.features.length - fi} not reached]${stopped}` : ''}`);
});
