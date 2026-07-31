import type { Params } from '../params.ts';
import type { RiderState } from '../state.ts';
import { createContact, type Terrain } from '../terrain.ts';
import { addScaled, clampLength, damp, projectOntoPlane } from '../vec3.ts';

const contact = createContact();

/**
 * Milestone 1: ballistic flight and a bare touchdown. Rotation, grabs and the landing
 * test come in milestones 3 and 4 — landing here is unconditional.
 */
export function stepAirborne(state: RiderState, params: Params, terrain: Terrain, dt: number): void {
  const p = state.position;
  const v = state.velocity;

  v.y -= params.world.gravity * dt;
  clampLength(v, params.world.terminalSpeed);
  addScaled(p, v, dt);
  state.airTime += dt;

  terrain.sample(p.x, p.z, contact);
  state.clearance = p.y - contact.height;
  damp(state.groundNormal, contact.normal, params.ground.normalSmoothing, dt);

  if (state.clearance > 0) return;

  p.y = contact.height;
  state.clearance = 0;
  state.mode = 'grounded';
  state.airTime = 0;
  projectOntoPlane(v, contact.normal);
}
