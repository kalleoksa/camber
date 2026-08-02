import * as THREE from 'three';
import { quat, slerp, type Quat } from '../sim/quat.ts';
import type { LandingRead, RiderMode, RiderState } from '../sim/state.ts';
import type { SlopeConfig, Terrain } from '../sim/terrain.ts';
import { createContact } from '../sim/terrain.ts';
import { length, vec3, type Vec3 } from '../sim/vec3.ts';

/** Board tip angle at full edge. */
const MAX_EDGE_ROLL = 0.55;
const MAX_CROUCH = 0.28; // m of knee bend at full compress
/** Extra hip drop per m/s of landing impact. A placeholder until the rig lands in M4. */
const ABSORB_PER_IMPACT = 0.022;

export type RiderView = {
  position: Vec3;
  groundNormal: Vec3;
  spinFrame: Quat;
  heading: number;
  course: number; // heading of horizontal velocity — what the camera follows in the air
  edge: number;
  stance: number;
  compress: number;
  scrub: number;
  speed: number;
  mode: RiderMode;
  landing: LandingRead;
  impact: number;
  absorb: number;
  bailTime: number;
};

function shortestAngleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const view: RiderView = {
  position: vec3(),
  groundNormal: vec3(0, 1, 0),
  spinFrame: quat(),
  heading: 0,
  course: 0,
  edge: 0,
  stance: 0,
  compress: 0,
  scrub: 0,
  speed: 0,
  mode: 'airborne',
  landing: 'none',
  impact: 0,
  absorb: 0,
  bailTime: 0,
};

function lerpInto(out: Vec3, a: Vec3, b: Vec3, t: number): void {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
}

/**
 * Render reads two sim states and draws between them. It never writes to either, and it
 * reuses one view buffer — consume it before the next call.
 */
export function interpolateRider(prev: RiderState, cur: RiderState, alpha: number): RiderView {
  lerpInto(view.position, prev.position, cur.position, alpha);
  lerpInto(view.groundNormal, prev.groundNormal, cur.groundNormal, alpha);
  slerp(view.spinFrame, prev.spinFrame, cur.spinFrame, alpha);
  view.heading = shortestAngleLerp(prev.heading, cur.heading, alpha);
  view.edge = prev.edge + (cur.edge - prev.edge) * alpha;
  view.stance = prev.stance + (cur.stance - prev.stance) * alpha;
  view.compress = prev.compress + (cur.compress - prev.compress) * alpha;
  view.scrub = cur.scrub;
  view.speed = length(cur.velocity);
  view.mode = cur.mode;
  view.landing = cur.landing;
  view.impact = cur.impact;
  view.absorb = cur.absorb;
  view.bailTime = cur.bailTime;
  view.course =
    Math.abs(cur.velocity.x) + Math.abs(cur.velocity.z) > 1e-4
      ? Math.atan2(cur.velocity.x, cur.velocity.z)
      : view.heading;
  return view;
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

  const roll = new THREE.Quaternion();
  const tumble = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const tumbleAxis = new THREE.Vector3(1, 0.3, 0).normalize();

  return {
    renderer,
    scene,
    rider: rig.group,

    updateRider(view) {
      rig.group.position.set(view.position.x, view.position.y, view.position.z);

      // The sim owns board orientation now — grounded it is slaved to the terrain,
      // airborne it carries angular momentum. Render just reads it.
      const q = view.spinFrame;
      rig.group.quaternion.set(q.x, q.y, q.z, q.w);

      // Edge roll is cosmetic and only means anything on snow.
      if (view.mode === 'grounded') {
        // Local +X is the heel side (design §1), so a toe edge tips −X down.
        roll.setFromAxisAngle(zAxis, view.edge * MAX_EDGE_ROLL);
        rig.group.quaternion.multiply(roll);
      }
      if (view.mode === 'bailed') {
        tumble.setFromAxisAngle(tumbleAxis, view.bailTime * 8.0);
        rig.group.quaternion.multiply(tumble);
      }

      const absorb = view.absorb > 0 ? view.impact * ABSORB_PER_IMPACT : 0;
      const stand = 0.75 - view.compress * MAX_CROUCH - absorb;
      rig.body.position.set(0, Math.max(0.3, stand), view.stance * 0.12);
      rig.body.rotation.x = -view.stance * 0.25;
    },

    resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    },
  };
}
