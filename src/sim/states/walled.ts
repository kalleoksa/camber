import type { InputSnapshot } from '../../input/snapshot.ts';
import type { Params } from '../params.ts';
import { axisZ, setFromBasis } from '../quat.ts';
import type { RiderState } from '../state.ts';
import type { Terrain } from '../terrain.ts';
import { cross, damp, set, vec3 } from '../vec3.ts';
import type { Panel } from '../walls.ts';
import * as dm from '../dmath.ts';
import { chargePop, popBias, popTakeoff, rideOff } from './grounded.ts';

// Module scratch, reused — the tick path doesn't allocate (invariant 7).
const N = vec3(); // the face's normal, out of the ridden side
const F = vec3(); // board forward, along the travel on the face
const heel = vec3();
const fwd = vec3();

function normalOf(p: Panel): void {
  set(N, p.nx, p.ny, p.nz);
}

/**
 * A built face (docs/walls-plan.md): ridden on the board's base, the rider held on the face the
 * way a rail holds them on its line. Gravity pulls down the face at `panel.gravityScale`, the
 * face and the air bleed speed, the left stick steers the run on the face, RT pops off it.
 * Off the end, over the top, down off the foot or too slow, it lets go into the air.
 */
export function stepPanel(state: RiderState, input: InputSnapshot, params: Params, terrain: Terrain, dt: number): void {
  const w = params.panel;
  const pnl = terrain.panels[state.panelIndex];
  if (!pnl) {
    leave(state);
    rideOff(state, input, params, 0);
    return;
  }
  normalOf(pnl);
  const v = state.velocity;
  const p = state.position;

  // Gravity in the face's plane, scaled: what's left of it pulls you down the face.
  const g = params.world.gravity * w.gravityScale;
  // −g·up, less its part along the normal.
  const gn = -g * N.y;
  v.x += (0 - gn * N.x) * dt;
  v.y += (-g - gn * N.y) * dt;
  v.z += (0 - gn * N.z) * dt;

  // The left stick steers the run on the face: the velocity turns about the normal.
  const turn = -state.edge * w.steerRate * dt;
  if (turn !== 0) {
    const c = dm.cos(turn);
    const s = dm.sin(turn);
    // Rodrigues about N, for a vector already in the plane: v cos + (N × v) sin.
    const cx = N.y * v.z - N.z * v.y;
    const cy = N.z * v.x - N.x * v.z;
    const cz = N.x * v.y - N.y * v.x;
    v.x = v.x * c + cx * s;
    v.y = v.y * c + cy * s;
    v.z = v.z * c + cz * s;
  }

  // The face and the air take speed off.
  let speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (speed > 0) {
    const keep = Math.max(0, speed - (w.friction + params.ground.drag * speed * speed) * dt) / speed;
    v.x *= keep;
    v.y *= keep;
    v.z *= keep;
    speed *= keep;
  }

  // Pop off: along the face's normal, blended toward up so a plain pop comes down the right way.
  if (chargePop(state, input, params, dt)) {
    const impulse = (params.pop.base + params.pop.charged * state.compress) * popBias(state.stance, params) * w.popScale;
    let dx = N.x;
    let dy = N.y + w.popUp;
    let dz = N.z;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= l;
    dy /= l;
    dz /= l;
    v.x += dx * impulse;
    v.y += dy * impulse;
    v.z += dz * impulse;
    state.charge = 0;
    leave(state);
    popTakeoff(state, input, params);
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    return;
  }

  // Move, then put the board back on the face.
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;
  const rx = p.x - pnl.x0;
  const ry = p.y - pnl.y0;
  const rz = p.z - pnl.z0;
  const along = rx * pnl.ax + ry * pnl.ay + rz * pnl.az;
  const up = rx * pnl.ex + ry * pnl.ey + rz * pnl.ez;
  p.x = pnl.x0 + pnl.ax * along + pnl.ex * up + N.x * w.rideHeight;
  p.y = pnl.y0 + pnl.ay * along + pnl.ey * up + N.y * w.rideHeight;
  p.z = pnl.z0 + pnl.az * along + pnl.ez * up + N.z * w.rideHeight;
  const vn = v.x * N.x + v.y * N.y + v.z * N.z;
  v.x -= N.x * vn;
  v.y -= N.y * vn;
  v.z -= N.z * vn;

  // Board on its base against the face, nose along the travel.
  if (speed > 0.3) set(F, v.x / speed, v.y / speed, v.z / speed);
  else {
    axisZ(F, state.spinFrame);
    const fn = F.x * N.x + F.y * N.y + F.z * N.z;
    set(F, F.x - N.x * fn, F.y - N.y * fn, F.z - N.z * fn);
    const fl = Math.sqrt(F.x * F.x + F.y * F.y + F.z * F.z) || 1;
    set(F, F.x / fl, F.y / fl, F.z / fl);
  }
  cross(heel, N, F);
  setFromBasis(state.spinFrame, heel, N, F);
  state.heading = dm.atan2(F.x, F.z);
  damp(state.groundNormal, N, params.ground.normalSmoothing, dt);
  state.clearance = 0;
  state.scrub = 0;

  // Ways off: the end, the top, the foot, or too slow to stay on — all into the air, a step off
  // the face so the next tick doesn't catch it again.
  const offEnd = along < 0 || along > pnl.length;
  const overTop = up > pnl.height;
  const offFoot = up < 0 && v.x * pnl.ex + v.y * pnl.ey + v.z * pnl.ez < 0;
  const tooSlow = speed < w.minSpeed * w.exitFraction;
  if (offEnd || overTop || offFoot || tooSlow) {
    const away = w.leaveSpeed;
    v.x += N.x * away;
    v.y += N.y * away;
    v.z += N.z * away;
    leave(state);
    // Not popped: the rider rolls off the face onto the snow — the board comes back level, nose
    // still along the travel. Over the top it's an air off the face and keeps its attitude.
    if (!overTop) level(state);
    rideOff(state, input, params, 0);
  }
}

/** The board level (up = world up), nose along its current heading in the horizontal. */
function level(state: RiderState): void {
  axisZ(F, state.spinFrame);
  const l = Math.sqrt(F.x * F.x + F.z * F.z) || 1;
  set(F, F.x / l, 0, F.z / l);
  set(N, 0, 1, 0);
  cross(heel, N, F);
  setFromBasis(state.spinFrame, heel, N, F);
}

function leave(state: RiderState): void {
  state.panelIndex = -1;
}

/**
 * Onto a built face, from the air or the snow (riding up its ramp): close to the face, inside it,
 * moving into it or along it, travelling within `panel.captureAngle` of its run, fast enough, and
 * the board pointing along the travel (judged like a landing's heading, not its roll: the rig
 * rolls onto the face). Square into it, misaligned, or too slow and still going into it: a bonk —
 * off it and down. Returns true when the rider's state changed.
 */
export function tryPanel(state: RiderState, params: Params, terrain: Terrain): boolean {
  const w = params.panel;
  const p = state.position;
  const v = state.velocity;
  for (let i = 0; i < terrain.panels.length; i++) {
    const pnl = terrain.panels[i];
    if (!pnl) continue;
    const rx = p.x - pnl.x0;
    const ry = p.y - pnl.y0;
    const rz = p.z - pnl.z0;
    const d = rx * pnl.nx + ry * pnl.ny + rz * pnl.nz;
    if (d > w.captureDist || d < -w.thickness) continue;
    const along = rx * pnl.ax + ry * pnl.ay + rz * pnl.az;
    const up = rx * pnl.ex + ry * pnl.ey + rz * pnl.ez;
    if (along < 0 || along > pnl.length || up < -w.captureDist || up > pnl.height) continue;
    const vn = v.x * pnl.nx + v.y * pnl.ny + v.z * pnl.nz;
    if (vn > 0 && d > 0) continue; // moving away from the face, on its ridden side
    // Travel in the face's plane, against its run.
    const px = v.x - pnl.nx * vn;
    const py = v.y - pnl.ny * vn;
    const pz = v.z - pnl.nz * vn;
    const inPlane = Math.sqrt(px * px + py * py + pz * pz);
    const run = Math.abs(px * pnl.ax + py * pnl.ay + pz * pnl.az);
    const glancing = inPlane > 1e-6 && run >= inPlane * dm.cos(w.captureAngle);
    // Board heading against the travel, folded to the nearer end (switch is legal).
    axisZ(fwd, state.spinFrame);
    const bf = Math.abs(fwd.x * px + fwd.y * py + fwd.z * pz) / ((Math.sqrt(fwd.x * fwd.x + fwd.y * fwd.y + fwd.z * fwd.z) || 1) * (inPlane || 1));
    const lined = bf >= dm.cos(params.land.sketchy);
    if (d >= 0 && glancing && lined && inPlane >= w.minSpeed) {
      state.impact = Math.abs(vn);
      // The speed into the face turns up it, as a transition turns it: that's what carries a
      // wallride up the wall. Without it you'd only slide along the foot.
      const climb = vn < 0 ? -vn * w.climb : 0;
      v.x = px + pnl.ex * climb;
      v.y = py + pnl.ey * climb;
      v.z = pz + pnl.ez * climb;
      p.x = pnl.x0 + pnl.ax * along + pnl.ex * Math.max(0, up) + pnl.nx * w.rideHeight;
      p.y = pnl.y0 + pnl.ay * along + pnl.ey * Math.max(0, up) + pnl.ny * w.rideHeight;
      p.z = pnl.z0 + pnl.az * along + pnl.ez * Math.max(0, up) + pnl.nz * w.rideHeight;
      state.mode = 'walled';
      state.panelIndex = i;
      state.railIndex = -1;
      state.landing = 'none';
      state.spinRate = 0;
      state.airTime = 0;
      state.popWindow = 0;
      state.grip = 0;
      state.grabHeld = false;
      state.tweak = 0;
      state.shifty = 0;
      state.airPitch = 0;
      return true;
    }
    if (vn < 0 || d < 0) {
      // Into the face and not a wallride. Softly: pushed off it, carrying on along it. Hard
      // (`panel.bonkSpeed` into it): bounce off and go down.
      if (-vn < w.bonkSpeed) {
        v.x -= pnl.nx * vn;
        v.y -= pnl.ny * vn;
        v.z -= pnl.nz * vn;
        p.x += pnl.nx * (w.captureDist - d);
        p.y += pnl.ny * (w.captureDist - d);
        p.z += pnl.nz * (w.captureDist - d);
        return false;
      }
      v.x -= pnl.nx * vn * (1 + w.bonkRestitution);
      v.y -= pnl.ny * vn * (1 + w.bonkRestitution);
      v.z -= pnl.nz * vn * (1 + w.bonkRestitution);
      p.x += pnl.nx * (w.captureDist - d);
      p.y += pnl.ny * (w.captureDist - d);
      p.z += pnl.nz * (w.captureDist - d);
      state.panelIndex = -1;
      state.mode = 'bailed';
      state.landing = 'bail';
      state.bailTime = 0;
      return true;
    }
  }
  return false;
}
