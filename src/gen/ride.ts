import * as dm from '../sim/dmath.ts';
import { TICK_DT } from '../core/loop.ts';
import { neutralInput } from '../input/snapshot.ts';
import type { Params } from '../sim/params.ts';
import { tick } from '../sim/rider.ts';
import { createRiderState } from '../sim/state.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';

/**
 * The real rider over a kicker facing straight down −Z at x = 0: started a few metres up its
 * run-in at a speed found (a few tries) so it reaches the lip at `target`, popped fully or not
 * at all, ridden until it lands. `past` is metres beyond the knuckle (negative: short of it).
 */
export function rideKicker(
  t: Terrain,
  params: Params,
  kz: number,
  lip: number,
  deckLength: number,
  target: number,
  charge: boolean,
): { lipSpeed: number; past: number; landing: string } {
  const c = createContact();
  const lipZ = kz - lip;
  const start = kz + 8;
  let v0 = target;
  let out = { lipSpeed: 0, past: 0, landing: '' };
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = createRiderState({ position: { x: 0, y: t.sample(0, start, c).height + 0.05, z: start }, heading: Math.PI });
    s.velocity.z = -v0;
    let flying = false;
    let lipSpeed = 0;
    for (let i = 0; i < 120 * 20; i++) {
      const inp = neutralInput();
      const toLip = (s.position.z - lipZ) / Math.max(1, -s.velocity.z);
      if (charge && s.mode === 'grounded' && toLip < params.pop.chargeTime + 0.05 && toLip > 0.02) inp.rt = 1;
      const was = s.mode;
      tick(s, inp, params, t, TICK_DT);
      if (was === 'grounded' && s.mode === 'airborne' && !flying && Math.abs(s.position.z - lipZ) < 3) {
        flying = true;
        lipSpeed = Math.sqrt(s.velocity.x * s.velocity.x + s.velocity.y * s.velocity.y + s.velocity.z * s.velocity.z);
      }
      if (flying && s.mode !== 'airborne') {
        out = { lipSpeed, past: lipZ - deckLength - s.position.z, landing: s.landing };
        break;
      }
    }
    // Correct the run-in speed by the miss at the lip (a full pop adds ~1.5 m/s there) and go again.
    const err = target - (charge ? Math.max(0, out.lipSpeed - 1.5) : out.lipSpeed);
    if (Math.abs(err) < 0.15) break;
    v0 = Math.max(0.5, v0 + err);
  }
  return out;
}

/**
 * The real rider off a takeoff facing down −Z at x = 0, starting `lip` m up from (0, kz − lip):
 * reaching the lip at about `target`, popped with `charge` of a full charge (0: no pop). Returns
 * the air as [m past the lip, height above the terrain under it, rad below horizontal it's
 * travelling at] every tick from takeoff to touchdown, empty if it never left the snow.
 */
export function rideArc(t: Terrain, params: Params, kz: number, lip: number, target: number, charge: number): [number, number, number][] {
  const c = createContact();
  const lipZ = kz - lip;
  const start = lipZ + 6;
  let v0 = target;
  let arc: [number, number, number][] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = createRiderState({ position: { x: 0, y: t.sample(0, start, c).height + 0.05, z: start }, heading: Math.PI });
    s.mode = 'grounded' as typeof s.mode;
    s.velocity.z = -v0;
    let at = 0;
    arc = [];
    for (let i = 0; i < 120 * 8; i++) {
      const inp = neutralInput();
      const toLip = (s.position.z - lipZ) / Math.max(1, -s.velocity.z);
      if (charge > 0 && s.mode === 'grounded' && toLip < params.pop.chargeTime * charge + 0.05 && toLip > 0.02) inp.rt = 1;
      const z0 = s.position.z;
      tick(s, inp, params, t, TICK_DT);
      if (z0 >= lipZ + 1 && s.position.z < lipZ + 1) at = Math.sqrt(s.velocity.x * s.velocity.x + s.velocity.y * s.velocity.y + s.velocity.z * s.velocity.z);
      if (s.mode === 'airborne' && Math.abs(s.position.z - lipZ) < 3 + arc.length) arc.push([lipZ - s.position.z, s.position.y - t.sample(s.position.x, s.position.z, c).height, dm.atan2(-s.velocity.y, Math.sqrt(s.velocity.x * s.velocity.x + s.velocity.z * s.velocity.z))]);
      else if (arc.length > 0) break;
    }
    const err = target - at;
    if (Math.abs(err) < 0.15 || at === 0) break;
    v0 = Math.max(0.5, v0 + err);
  }
  return arc;
}
