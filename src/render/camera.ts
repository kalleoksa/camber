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
  let roll = 0;

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

    target
      .set(view.position.x, view.position.y, view.position.z)
      .addScaledVector(forward, -p.camera.distance)
      .addScaledVector(up, p.camera.height);
    look
      .set(view.position.x, view.position.y, view.position.z)
      .addScaledVector(forward, p.camera.lookAhead)
      .addScaledVector(up, 1.0);
  };

  const rollTarget = (view: RiderView, p: Params): number =>
    (view.mode === 'grounded' || view.mode === 'walled') ? -view.edge * p.camera.rollGain : 0;

  const frame = (view: RiderView, p: Params): void => {
    camera.lookAt(look);
    // Roll with the rider, into the turn: a toe-edge carve banks right, so the horizon
    // lifts on the right. rotateZ is counter-clockwise from behind, hence the negation.
    // Smoothed, so takeoff and touchdown don't pop the horizon.
    camera.rotateZ(roll);
    const fov = p.camera.fovBase + view.speed * p.camera.fovSpeedGain;
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
      camera.position.lerp(target, t);
      roll += (rollTarget(view, p) - roll) * t;
      frame(view, p);
    },
    snap(view, p) {
      desired(view, p);
      camera.position.copy(target);
      roll = rollTarget(view, p);
      frame(view, p);
    },
  };
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
