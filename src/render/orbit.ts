import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RiderView } from './scene.ts';

export type PoseOrbit = {
  setEnabled(on: boolean): void;
  update(view: RiderView): void;
};

/**
 * Free look for pose mode only. A method has to be judged from the side, and the chase
 * camera cannot show you that. Not used in play — the chase spring owns the camera there.
 */
export function createPoseOrbit(camera: THREE.PerspectiveCamera, element: HTMLElement): PoseOrbit {
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.enabled = false;
  let framed = false;

  return {
    setEnabled(on) {
      controls.enabled = on;
      if (!on) framed = false;
    },
    update(view) {
      if (!framed) {
        // Open on a side-on view, which is how you read a method.
        controls.target.set(view.position.x, view.position.y + 0.9, view.position.z);
        camera.position.set(view.position.x - 3.4, view.position.y + 1.6, view.position.z + 1.2);
        framed = true;
      }
      controls.target.set(view.position.x, view.position.y + 0.9, view.position.z);
      controls.update();
    },
  };
}
