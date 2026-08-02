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

  const desired = (view: RiderView, p: Params): void => {
    // Rise along the contact normal, not world up, so the slope stays in frame.
    up.set(view.groundNormal.x, view.groundNormal.y, view.groundNormal.z).normalize();
    forward.set(Math.sin(view.heading), 0, Math.cos(view.heading));
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

  const frame = (view: RiderView, p: Params): void => {
    camera.lookAt(look);
    // Roll with the rider, into the turn: a toe-edge carve banks right, so the horizon
    // lifts on the right. rotateZ is counter-clockwise from behind, hence the negation.
    camera.rotateZ(-view.edge * p.camera.rollGain);
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
      frame(view, p);
    },
    snap(view, p) {
      desired(view, p);
      camera.position.copy(target);
      frame(view, p);
    },
  };
}
