import type { Params } from '../params.ts';
import type { RiderState } from '../state.ts';
import { createContact, type Terrain } from '../terrain.ts';
import { addScaled, damp, length, projectOntoPlane, scale } from '../vec3.ts';

const contact = createContact();

/**
 * The one state where the rider is not a controller (§3). No input is read — you are
 * along for the ride until it settles. The tumble itself is render-side; here the rider
 * is a sliding body that sheds speed hard.
 */
export function stepBailed(state: RiderState, params: Params, terrain: Terrain, dt: number): void {
  const p = state.position;
  const v = state.velocity;

  terrain.sample(p.x, p.z, contact);
  const n = contact.normal;
  damp(state.groundNormal, n, params.ground.normalSmoothing, dt);

  const gravity = params.world.gravity;
  v.x += gravity * (n.x * n.y) * dt;
  v.y += gravity * (n.y * n.y - 1) * dt;
  v.z += gravity * (n.z * n.y) * dt;
  projectOntoPlane(v, n);

  const speed = length(v);
  if (speed > 0) {
    scale(v, Math.max(0, speed - params.bail.drag * dt) / speed);
  }

  addScaled(p, v, dt);
  terrain.sample(p.x, p.z, contact);
  p.y = contact.height;
  state.clearance = 0;
  state.scrub = 0;
  state.bailTime += dt;

  if (state.bailTime > params.bail.minTime && length(v) < params.bail.recoverSpeed) {
    state.mode = 'grounded';
    state.landing = 'none';
    state.bailTime = 0;
    state.compress = 0;
    state.absorb = 0;
  }
}
