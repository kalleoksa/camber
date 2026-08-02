import * as THREE from 'three';
import type { RiderMode, RiderState } from '../sim/state.ts';
import type { SlopeConfig, Terrain } from '../sim/terrain.ts';
import { createContact } from '../sim/terrain.ts';
import { lerp, length, type Vec3 } from '../sim/vec3.ts';

/** Board tip angle at full edge. */
const MAX_EDGE_ROLL = 0.55;
const MAX_CROUCH = 0.28; // m of knee bend at full compress

export type RiderView = {
  position: Vec3;
  groundNormal: Vec3;
  heading: number;
  edge: number;
  stance: number;
  compress: number;
  scrub: number;
  speed: number;
  mode: RiderMode;
};

function shortestAngleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Render reads two sim states and draws between them. It never writes to either. */
export function interpolateRider(prev: RiderState, cur: RiderState, alpha: number): RiderView {
  return {
    position: lerp(prev.position, cur.position, alpha),
    groundNormal: lerp(prev.groundNormal, cur.groundNormal, alpha),
    heading: shortestAngleLerp(prev.heading, cur.heading, alpha),
    edge: prev.edge + (cur.edge - prev.edge) * alpha,
    stance: prev.stance + (cur.stance - prev.stance) * alpha,
    compress: prev.compress + (cur.compress - prev.compress) * alpha,
    scrub: cur.scrub,
    speed: length(cur.velocity),
    mode: cur.mode,
  };
}

export type SceneView = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  rider: THREE.Group;
  updateRider(view: RiderView): void;
  resize(): void;
};

function snowTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f4f8fc';
    ctx.fillRect(0, 0, size, size);
    // Groomer corduroy: fine lines across the fall line, one heavier line per tile.
    ctx.strokeStyle = '#dde7f1';
    ctx.lineWidth = 2;
    for (let i = 0; i < size; i += size / 16) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }
    ctx.strokeStyle = '#c9d8e6';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function slopeMesh(cfg: SlopeConfig, terrain: Terrain): THREE.Mesh {
  const runOut = 20;
  const geometry = new THREE.PlaneGeometry(cfg.width, cfg.length + runOut, 64, 256);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, runOut - (cfg.length + runOut) / 2);

  const position = geometry.attributes.position as THREE.BufferAttribute;
  const contact = createContact();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, terrain.sample(x, z, contact).height);
  }
  geometry.computeVertexNormals();

  const texture = snowTexture();
  texture.repeat.set(cfg.width / 4, (cfg.length + runOut) / 4);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** Side markers every 20 m — a fixed reference for reading speed and turn shape. */
function slopeMarkers(cfg: SlopeConfig, terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6);
  const material = new THREE.MeshStandardMaterial({ color: 0xe2582f, roughness: 0.7 });
  const contact = createContact();
  const x = cfg.width * 0.42;
  for (let z = 0; z > -cfg.length; z -= 20) {
    for (const side of [-x, x]) {
      const pole = new THREE.Mesh(geometry, material);
      pole.position.set(side, terrain.sample(side, z, contact).height + 0.8, z);
      group.add(pole);
    }
  }
  return group;
}

function riderRig(): { group: THREE.Group; board: THREE.Group; body: THREE.Mesh } {
  const group = new THREE.Group();

  const board = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.02, 1.55),
    new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.4 }),
  );
  deck.position.y = 0.02;
  board.add(deck);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.02, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xe2582f, roughness: 0.4 }),
  );
  nose.position.set(0, 0.02, 0.8);
  board.add(nose);
  group.add(board);

  // Placeholder capsule. Milestone 4 replaces it with the procedural rig.
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.24, 0.9, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x2f6ee2, roughness: 0.6 }),
  );
  body.castShadow = true;
  group.add(body);

  return { group, board, body };
}

export function createScene(cfg: SlopeConfig, terrain: Terrain, camera: THREE.PerspectiveCamera): SceneView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9db6cc);
  scene.fog = new THREE.Fog(0x9db6cc, 60, 320);

  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(-40, 80, 30);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbcd7f0, 0xe8eef4, 1.1));

  scene.add(slopeMesh(cfg, terrain));
  scene.add(slopeMarkers(cfg, terrain));

  const rig = riderRig();
  scene.add(rig.group);

  const up = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const roll = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);

  return {
    renderer,
    scene,
    rider: rig.group,

    updateRider(view) {
      rig.group.position.set(view.position.x, view.position.y, view.position.z);

      up.set(view.groundNormal.x, view.groundNormal.y, view.groundNormal.z).normalize();
      forward.set(Math.sin(view.heading), 0, Math.cos(view.heading));
      forward.addScaledVector(up, -forward.dot(up)).normalize();
      right.crossVectors(up, forward);

      basis.makeBasis(right, up, forward);
      rig.group.quaternion.setFromRotationMatrix(basis);
      // Toe edge tips the board toward +X down, so the roll is negative in board space.
      roll.setFromAxisAngle(zAxis, -view.edge * MAX_EDGE_ROLL);
      rig.group.quaternion.multiply(roll);

      const stand = 0.75 - view.compress * MAX_CROUCH;
      rig.body.position.set(0, stand, view.stance * 0.12);
      rig.body.rotation.x = -view.stance * 0.25;
    },

    resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    },
  };
}
