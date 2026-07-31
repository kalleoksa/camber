import type { Params } from '../params.ts';
import type { RiderState } from '../state.ts';
import { createContact, type Terrain } from '../terrain.ts';
import { addScaled, clampLength, damp, length, projectOntoPlane, scale } from '../vec3.ts';

const contact = createContact();

/**
 * Milestone 1: contact, slope acceleration, drag. No edge grip and no carve yaw yet —
 * those are milestone 2 and they are where the feel actually lives.
 */
export function stepGrounded(state: RiderState, params: Params, terrain: Terrain, dt: number): void {
  const p = state.position;
  const v = state.velocity;

  terrain.sample(p.x, p.z, contact);
  damp(state.groundNormal, contact.normal, params.ground.normalSmoothing, dt);

  // Tangential component of gravity on the contact plane: g*(down - n*(down·n)).
  const n = contact.normal;
  const g = params.world.gravity;
  v.x += g * (n.x * n.y) * dt;
  v.y += g * (n.y * n.y - 1) * dt;
  v.z += g * (n.z * n.y) * dt;

  // Quadratic base drag, applied to speed so direction is untouched.
  const speed = length(v);
  if (speed > 0) {
    const loss = params.ground.drag * speed * speed * dt;
    scale(v, Math.max(0, speed - loss) / speed);
  }

  projectOntoPlane(v, n);
  clampLength(v, params.world.terminalSpeed);
  addScaled(p, v, dt);

  terrain.sample(p.x, p.z, contact);
  state.clearance = p.y - contact.height;
  if (state.clearance > params.air.detachClearance) {
    state.mode = 'airborne';
    state.airTime = 0;
    return;
  }

  p.y = contact.height;
  state.clearance = 0;
  projectOntoPlane(v, contact.normal);

  // Heading follows the direction of travel until the carve model owns it.
  if (length(v) > params.ground.pivotSpeed) state.heading = Math.atan2(v.x, v.z);
}
