/**
 * Hip quarter, measured: `npm run hip-quarter`. Section A runs along x from −W to 0, section B
 * turns β from the corner at (0, 0): β > 0 bends B toward the rider (an inside corner), β < 0
 * away (an outside hip), β 0 is one straight pipe. The rider rides up A toward the corner and
 * the air is judged, not the bot (which doesn't spin, so it bails most pipe airs): which
 * section it comes down on, the impact, and how its travel lines up with straight down the
 * surface there (0° = a rider who turned to face down it lands on its line).
 */
import { TICK_DT } from '../src/core/loop.ts';
import { neutralInput } from '../src/input/snapshot.ts';
import { params } from '../src/sim/params.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState } from '../src/sim/state.ts';
import { createContact, createSlope, type QuarterConfig } from '../src/sim/terrain.ts';
const D = Math.PI / 180;
const W = 12;
const Q: Omit<QuarterConfig, 'x' | 'z' | 'yaw'> = { width: W, height: 3.5, angle: 83 * D, radius: 4, deck: 3, sideTaper: 3 };
const c = createContact();
for (const beta of [0, -60, -45, -30, 30, 45, 60]) {
  const b = beta * D;
  const quarters: QuarterConfig[] = [
    { ...Q, x: -W / 2, z: 0, yaw: 0 },
    { ...Q, x: (W / 2) * Math.cos(b), z: (W / 2) * Math.sin(b), yaw: b, ...(beta === 0 ? { width: W + 0.01 } : {}) },
  ];
  const t = createSlope({ length: 400, width: 200, pitch: 10 * D, quarters });
  const rows: string[] = [];
  for (const v of [9, 12]) for (const off of [20, 35, 50]) {
    const s = createRiderState({ position: { x: -9, y: 0, z: 14 }, heading: Math.PI - off * D });
    s.position.y = t.sample(-9, 14, c).height + 0.05;
    s.mode = 'grounded' as typeof s.mode;
    s.velocity.x = v * Math.sin(off * D);
    s.velocity.z = -v * Math.cos(off * D);
    let out = 'no air';
    let air = 0;
    let top = -Infinity;
    for (let i = 0; i < 120 * 8; i++) {
      const was = s.mode;
      tick(s, neutralInput(), params, t, TICK_DT);
      if (s.mode === 'airborne') {
        air += TICK_DT;
        top = Math.max(top, s.position.y - t.sample(s.position.x, s.position.z, c).height);
      }
      // Judge the air, not the bot: where it came down and how its travel lines up with straight
      // down the surface there (0° = a rider turned to face down it lands on its line).
      const vx0 = s.velocity.x, vy0 = s.velocity.y, vz0 = s.velocity.z;
      if (was === 'airborne' && s.mode !== 'airborne' && air > 0.25) {
        const alongB = s.position.x * Math.cos(b) + s.position.z * Math.sin(b);
        const p = t.sample(s.position.x, s.position.z, c);
        const n = p.normal;
        const vn = vx0 * n.x + vy0 * n.y + vz0 * n.z;
        const tx = vx0 - vn * n.x, tz = vz0 - vn * n.z; // travel along the surface (horizontal parts)
        const fx = n.x, fz = n.z; // downhill on the surface, horizontally
        const off = Math.hypot(fx, fz) > 0.05 && Math.hypot(tx, tz) > 0.5 ? Math.acos((tx * fx + tz * fz) / Math.hypot(tx, tz) / Math.hypot(fx, fz)) / D : NaN;
        out = `${alongB > 0 ? 'B' : 'A'} ${p.surface} impact ${Math.abs(vn).toFixed(0)} off-fall ${Number.isNaN(off) ? '-' : off.toFixed(0)}° (${air.toFixed(1)} s, ${top.toFixed(1)} m)`;
        break;
      }
      if (s.mode === 'bailed') { out = `bailed (${air.toFixed(2)} s)`; break; }
    }
    rows.push(`${v}m/s ${off}°: ${out}`);
  }
  console.log(`β ${beta}°  ${rows.join(' | ')}`);
}
