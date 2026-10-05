import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * The edit camera: orbits a point on the snow. Drag turns, right-drag or two fingers pan,
 * wheel or pinch zooms; WASD moves the point along the snow, Shift faster. An orbit rather than
 * a free fly: placing and dragging features is done looking at one spot, and it works the same
 * on a touch screen.
 */
export type EditCamera = {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Look at (x, y, z) from `distance` m, keeping the current direction. */
  frame(x: number, y: number, z: number, distance: number): void;
  /** `heightAt`: the snow, so the point stays on it as WASD moves it. */
  update(dt: number, keys: ReadonlySet<string>, heightAt: (x: number, z: number) => number): void;
  setEnabled(on: boolean): void;
};

const PAN_SPEED = 25; // m/s with WASD, 3× with Shift

export function createEditCamera(element: HTMLElement): EditCamera {
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2000);
  camera.position.set(0, 60, 40);
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49; // never under the snow
  controls.screenSpacePanning = false; // pan along the ground, not the screen
  controls.enabled = false;
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();

  return {
    camera,
    controls,
    frame(x, y, z, distance) {
      const dir = forward.subVectors(camera.position, controls.target).normalize();
      controls.target.set(x, y, z);
      camera.position.copy(controls.target).addScaledVector(dir, distance);
    },
    update(dt, keys, heightAt) {
      const w = element.clientWidth || innerWidth;
      const h = element.clientHeight || innerHeight;
      if (camera.aspect !== w / h) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.set(-forward.z, 0, forward.x);
      const ax = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const az = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      if (ax !== 0 || az !== 0) {
        const speed = PAN_SPEED * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1) * dt;
        move.copy(forward).multiplyScalar(az).addScaledVector(right, ax).normalize().multiplyScalar(speed);
        move.y = heightAt(controls.target.x + move.x, controls.target.z + move.z) - controls.target.y;
        camera.position.add(move);
        controls.target.add(move);
      }
      controls.update();
    },
    setEnabled(on) {
      controls.enabled = on;
    },
  };
}
