import * as THREE from 'three';
import type { Params } from '../sim/params.ts';
import type { RiderView } from './scene.ts';

export type ChaseCamera = {
  camera: THREE.PerspectiveCamera;
  update(view: RiderView, params: Params, dt: number): void;
  snap(view: RiderView, params: Params): void;
};

export function createChaseCamera(params: Params): ChaseCamera {
  const camera = new THREE.PerspectiveCamera(params.camera.fovBase, innerWidth / innerHeight, 0.1, 1000);
  const target = new THREE.Vector3();
  const look = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  const aimPoint = new THREE.Vector3(); // where the camera actually looks: trails `look`
  let roll = 0;
  let feel = 0; // 0..1 speed feel, eased
  let shakeTime = 0;
  const rest = new THREE.Vector3(); // the camera's position without the judder, so it never feeds the spring

  const desired = (view: RiderView, p: Params): void => {
    // Rise along the contact normal, not world up, so the slope stays in frame.
    up.set(view.groundNormal.x, view.groundNormal.y, view.groundNormal.z).normalize();
    // Follow the direction of travel, not the board: in the air the board spins, and a
    // switch rider's heading points back up the hill. Near a standstill travel is noise,
    // so fade toward the board, folded onto whichever end is nearer the travel direction.
    let board = view.heading;
    if (Math.abs(wrap(board - view.course)) > Math.PI / 2) board += Math.PI;
    const follow = Math.min(view.speed / p.camera.followSpeed, 1);
    const aim = board + wrap(view.course - board) * follow;
    forward.set(Math.sin(aim), 0, Math.cos(aim));
    forward.addScaledVector(up, -forward.dot(up)).normalize();

    const f = speedFeel(view, p);
    target
      .set(view.position.x, view.position.y, view.position.z)
      .addScaledVector(forward, -p.camera.distance * (1 - f * p.camera.speedCloser))
      .addScaledVector(up, p.camera.height * (1 - f * p.camera.speedLower));
    look
      .set(view.position.x, view.position.y, view.position.z)
      .addScaledVector(forward, p.camera.lookAhead)
      .addScaledVector(up, 1.0);
  };

  const rollTarget = (view: RiderView, p: Params): number =>
    // Edge is the board's, so riding switch it leans the other way for the same turn.
    view.mode === 'grounded' || view.mode === 'walled' ? -view.edge * (view.switchRide ? -1 : 1) * p.camera.rollGain : 0;

  const frame = (view: RiderView, p: Params): void => {
    camera.lookAt(aimPoint);
    // Roll with the rider, into the turn: a toe-edge carve banks right, so the horizon
    // lifts on the right. rotateZ is counter-clockwise from behind, hence the negation.
    // Smoothed, so takeoff and touchdown don't pop the horizon.
    camera.rotateZ(roll);
    const fov = p.camera.fovBase + view.speed * p.camera.fovSpeedGain + feel * p.camera.speedFov;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  };

  return {
    camera,
    update(view, p, dt) {
      desired(view, p);
      const t = 1 - Math.exp(-p.camera.springStiffness * dt);
      camera.position.copy(rest).lerp(target, t);
      rest.copy(camera.position);
      // The aim trails the rider too, so turns and landings move them in frame instead of
      // pinning them dead centre — most of what reads as loose rather than locked.
      aimPoint.lerp(look, 1 - Math.exp(-p.camera.lookStiffness * dt));
      roll += (rollTarget(view, p) - roll) * t;
      // Speed feel eased, so takeoffs and landings don't snap the FOV.
      feel += (speedFeel(view, p) - feel) * t;
      // Judder on the snow: two detuned sines along the camera's own up and right, scaled by
      // feel² so it only shows when you are really moving. Render time; the camera isn't replayed.
      shakeTime += dt;
      const onSnow = view.mode === 'grounded' ? 1 : 0;
      const amp = p.camera.shake * feel * feel * onSnow;
      const w = 2 * Math.PI * p.camera.shakeRate;
      camera.position.y += amp * (Math.sin(w * shakeTime) * 0.6 + Math.sin(w * 1.73 * shakeTime + 1.3) * 0.4);
      frame(view, p);
      camera.translateX(amp * 0.6 * Math.sin(w * 1.31 * shakeTime + 0.7));
    },
    snap(view, p) {
      desired(view, p);
      camera.position.copy(target);
      rest.copy(target);
      aimPoint.copy(look);
      roll = rollTarget(view, p);
      feel = speedFeel(view, p);
      frame(view, p);
    },
  };
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** 0..1, how fast this reads: from `speedFrom` to `speedFull`, eased in. */
function speedFeel(view: RiderView, p: Params): number {
  const t = (view.speed - p.camera.speedFrom) / Math.max(p.camera.speedFull - p.camera.speedFrom, 1e-3);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
