import * as dm from '../sim/dmath.ts';
import type { Params } from '../sim/params.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';

/**
 * A rider's flight off a takeoff, without the rider: a point under gravity (the sim has no air
 * drag) from a start position and velocity until it meets the terrain. Graded as the sim
 * grades a landing on impact — the speed into the surface against `land.impactSketchy` and
 * `land.impactBail` — and on landing flat. Spin and board angle aren't modelled: a straight
 * air, which is what a jump is designed for.
 */
export type Grade = 'clean' | 'sketchy' | 'bail';

export type Flight = {
  points: number[]; // x, y, z every step, for drawing
  x: number; // touchdown
  y: number;
  z: number;
  airtime: number; // s
  impact: number; // m/s into the surface at touchdown
  descent: number; // rad below horizontal the flight comes in at
  grade: Grade;
};

const DT = 1 / 120; // the sim's tick

export function fly(
  terrain: Terrain,
  params: Params,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  maxTime = 6,
  keepPoints = true,
): Flight {
  const c = createContact();
  const g = params.world.gravity;
  const points: number[] = [];
  let t = 0;
  let px = x;
  let py = y;
  let pz = z;
  // Leave the takeoff first: the start sits on its surface.
  while (t < maxTime) {
    vy -= g * DT;
    px += vx * DT;
    py += vy * DT;
    pz += vz * DT;
    t += DT;
    if (keepPoints && Math.round(t / DT) % 3 === 0) points.push(px, py, pz);
    if (t > 0.05 && py <= terrain.sample(px, pz, c).height) break;
  }
  const n = c.normal;
  const impact = Math.max(0, -(vx * n.x + vy * n.y + vz * n.z));
  const grade: Grade = impact >= params.land.impactBail ? 'bail' : impact >= params.land.impactSketchy ? 'sketchy' : 'clean';
  const descent = dm.atan2(-vy, Math.sqrt(vx * vx + vz * vz));
  return { points, x: px, y: terrain.sample(px, pz, c).height, z: pz, airtime: t, impact, descent, grade };
}

/**
 * Launch velocity off a lip: `speed` along the surface, plus `pop` along its normal. The lip's
 * direction is the terrain's own slope there, read just before the lip along `dirX/dirZ`.
 */
export function launch(
  terrain: Terrain,
  lipX: number,
  lipZ: number,
  dirX: number,
  dirZ: number,
  speed: number,
  pop: number,
): { y: number; vx: number; vy: number; vz: number } {
  const c = createContact();
  const step = 0.3;
  const yLip = terrain.sample(lipX, lipZ, c).height;
  const yBack = terrain.sample(lipX - dirX * step, lipZ - dirZ * step, c).height;
  // Unit tangent along the takeoff at the lip, and the normal in the same vertical plane.
  const rise = (yLip - yBack) / step;
  const len = Math.sqrt(1 + rise * rise);
  const th = 1 / len;
  const tv = rise / len;
  return {
    y: yLip,
    vx: dirX * (speed * th - pop * tv),
    vy: speed * tv + pop * th,
    vz: dirZ * (speed * th - pop * tv),
  };
}

/** Pop range the sim can give: an uncharged ollie to a full one. */
export function popRange(params: Params): [number, number] {
  return [params.pop.base, params.pop.base + params.pop.charged];
}
