import type { Params } from '../params.ts';
import { setFromBasis } from '../quat.ts';
import * as dm from '../dmath.ts';
import type { RiderState } from '../state.ts';
import { createContact, type Terrain } from '../terrain.ts';
import { addScaled, cross, damp, length, normalize, projectOntoPlane, scale, set, vec3, wrapAngle } from '../vec3.ts';

const contact = createContact();
const forward = vec3();
const heelSide = vec3();

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

  // Coming to rest on a slope you end up along the fall line, not across it: swing the
  // heading toward downhill (the ground normal's horizontal part points there), taking
  // the nearer end so no one is spun round, and rebuild the board on the ground.
  const rate = params.bail.faceDownhill;
  const flat = Math.sqrt(n.x * n.x + n.z * n.z);
  if (rate > 0 && flat > 1e-4) {
    let target = dm.atan2(n.x, n.z);
    if (Math.abs(wrapAngle(target - state.heading)) > Math.PI / 2) target = wrapAngle(target + Math.PI);
    state.heading = wrapAngle(state.heading + wrapAngle(target - state.heading) * (1 - dm.exp(-rate * dt)));
    set(forward, dm.sin(state.heading), 0, dm.cos(state.heading));
    projectOntoPlane(forward, n);
    normalize(forward);
    cross(heelSide, n, forward);
    setFromBasis(state.spinFrame, heelSide, n, forward);
  }

  if (state.bailTime > params.bail.minTime && length(v) < params.bail.recoverSpeed) {
    state.mode = 'grounded';
    state.landing = 'none';
    state.bailTime = 0;
    state.compress = 0;
    state.absorb = 0;
    state.headingTarget = state.heading;
  }
}
