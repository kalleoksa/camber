import type { InputSnapshot } from '../../input/snapshot.ts';
import type { Params } from '../params.ts';
import type { RiderState } from '../state.ts';
import { createContact, type Terrain } from '../terrain.ts';
import {
  addScaled,
  clampLength,
  cross,
  damp,
  dot,
  normalize,
  projectOntoPlane,
  set,
  vec3,
  wrapAngle,
} from '../vec3.ts';

const contact = createContact();
const forward = vec3();
const right = vec3();

/**
 * ln 5, so `speedFactor` reaches 0.8 exactly at `ground.speedFactorKnee` — that is what
 * the parameter means, not a tunable of its own.
 */
const KNEE_AT_80 = Math.log(5);

/** Rises fast, then plateaus, and is 0 at a standstill: you cannot turn without speed. */
function speedFactor(speed: number, knee: number): number {
  if (knee <= 0) return 1;
  return 1 - Math.exp((-KNEE_AT_80 * speed) / knee);
}

export function stepGrounded(
  state: RiderState,
  input: InputSnapshot,
  params: Params,
  terrain: Terrain,
  dt: number,
): void {
  const p = state.position;
  const v = state.velocity;
  const g = params.ground;

  terrain.sample(p.x, p.z, contact);
  damp(state.groundNormal, contact.normal, g.normalSmoothing, dt);
  const n = contact.normal;

  // Tangential component of gravity on the contact plane: g*(down − n*(down·n)).
  const gravity = params.world.gravity;
  v.x += gravity * (n.x * n.y) * dt;
  v.y += gravity * (n.y * n.y - 1) * dt;
  v.z += gravity * (n.z * n.y) * dt;
  projectOntoPlane(v, n);

  // Board basis in the contact plane. right is board +X, the toe side.
  set(forward, Math.sin(state.heading), 0, Math.cos(state.heading));
  projectOntoPlane(forward, n);
  normalize(forward);
  cross(right, n, forward);

  let vf = dot(v, forward);
  let vl = dot(v, right);

  const edgeMag = Math.min(Math.abs(state.edge), 1);
  const stanceMag = Math.min(Math.abs(state.stance), 1);

  // The one curve carving lives on: flat base skids, a set edge locks.
  let grip = g.gripFlat + (g.gripEdge - g.gripFlat) * Math.pow(edgeMag, g.gripCurve);
  grip *= 1 - stanceMag * g.stanceGripLoss;
  grip *= 1 - input.lt * g.brakeGripLoss;

  const speedBefore = Math.sqrt(vf * vf + vl * vl);
  const vlAfter = vl * Math.exp(-Math.max(grip, 0) * dt);
  const scrubbed = Math.abs(vl) - Math.abs(vlAfter);

  // Invariant 2: the edge *rotates* the velocity vector toward the board. Holding the
  // speed constant while the lateral component shrinks is exactly that rotation.
  // `carveHold` blends between it and the friction-cone version that just eats the
  // lateral component — at 1.0 a carve is free, at 0.0 it is a skid.
  const vfRotated = Math.sign(vf) * Math.sqrt(Math.max(0, speedBefore * speedBefore - vlAfter * vlAfter));
  vf += (vfRotated - vf) * g.carveHold;
  vl = vlAfter;
  state.scrub = scrubbed / dt;

  let speed = Math.sqrt(vf * vf + vl * vl);
  if (speed > 0) {
    const drag = (g.drag * speed * speed + input.lt * g.brakeDecel) * dt;
    const carveCost = g.edgeDrag * edgeMag * scrubbed;
    const keep = Math.max(0, speed - drag - carveCost) / speed;
    vf *= keep;
    vl *= keep;
    speed *= keep;
  }

  v.x = forward.x * vf + right.x * vl;
  v.y = forward.y * vf + right.y * vl;
  v.z = forward.z * vf + right.z * vl;
  clampLength(v, params.world.terminalSpeed);

  // Carve rotation. Nose or tail press moves the effective pivot along the board, which
  // reads as a tighter, twitchier turn.
  let yaw = state.edge * g.carveYaw * speedFactor(speed, g.speedFactorKnee) * (1 + stanceMag * g.stanceYawGain);
  if (speed < g.pivotSpeed) {
    // Low-authority skid pivot so a stopped rider isn't stuck facing the wrong way.
    yaw += state.edge * g.pivotYaw * (1 - speed / g.pivotSpeed);
  }
  state.heading = wrapAngle(state.heading + yaw * dt);

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
}
