import * as THREE from 'three';
import { quat, slerp, type Quat } from '../sim/quat.ts';
import type { Params } from '../sim/params.ts';
import type { LandingRead, RiderMode, RiderState } from '../sim/state.ts';
import type { SlopeConfig, Terrain } from '../sim/terrain.ts';
import { createContact } from '../sim/terrain.ts';
import { length, vec3, type Vec3 } from '../sim/vec3.ts';
import { boardAttitude } from '../sim/grabs.ts';
import { BODY_KEYS, grabBody } from './poses.ts';
import { butterAmount } from '../sim/states/grounded.ts';
import { BOARD_HALF, createRig, edgePoint, gripWeight, mirrorDrivers, neutralDrivers, smoothstep, type RigDrivers } from './rig.ts';
import type { Secondary } from './secondary.ts';

/**
 * The hip spring moved to `secondary.ts` and is stepped on the sim tick, which is what makes
 * it replay-identical. The tumble angle stays here because it is cosmetic and unhashed — but
 * it is still integrated, so it needs the real frame dt, clamped so a hitch makes the rider
 * lag rather than spin.
 */
const MAX_FRAME_DT = 1 / 30;

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
  grabEdge: number;
  grabT: number;
  grabFront: boolean;
  grabSwitch: boolean;
  switchRide: boolean;
  grip: number;
  tweak: number;
  shifty: number;
  balance: number;
  slide: number;
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
  grabEdge: 0,
  grabT: 0.5,
  grabFront: true,
  grabSwitch: false,
  switchRide: false,
  grip: 0,
  tweak: 0,
  shifty: 0,
  balance: 0,
  slide: 0,
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
  view.grabEdge = prev.grabEdge + (cur.grabEdge - prev.grabEdge) * alpha;
  view.grabT = prev.grabT + (cur.grabT - prev.grabT) * alpha;
  view.grabFront = cur.grabFront;
  view.grabSwitch = cur.grabSwitch;
  view.switchRide = cur.switchRide;
  view.grip = prev.grip + (cur.grip - prev.grip) * alpha;
  view.tweak = prev.tweak + (cur.tweak - prev.tweak) * alpha;
  view.shifty = prev.shifty + (cur.shifty - prev.shifty) * alpha;
  view.balance = prev.balance + (cur.balance - prev.balance) * alpha;
  view.slide = cur.slide;
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
  /** Drivers the rig is currently posed with. Pose mode writes here directly. */
  drivers: RigDrivers;
  /** Per-hand shoulder-to-hand distance over arm reach; above 1 the grab is out of reach. */
  strain: { front: number; back: number };
  /** How far each hand falls short of its grab point, m. 0 when it reaches. */
  shortfall: { front: number; back: number };
  /** Hip-to-foot distance per leg. The knee angle it implies is what boardPitch tunes. */
  legSpan: { front: number; back: number };
  /** `secondary` carries the tick-stepped springs; `dt` is only for the unhashed tumble. */
  updateRider(
    view: RiderView,
    params: Params,
    poseMode: boolean,
    secondary: Secondary,
    dt: number,
  ): void;
  /**
   * Strip the world back to the rider alone — no terrain, no markers, no fog, flat
   * background. Posing against a slope makes the board's attitude hard to read against a
   * moving horizon and invites reading a flat board as resting on the ground.
   */
  setStage(clean: boolean): void;
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

/**
 * Grid columns across the slope: ~0.75 m cells, fine enough that a kicker's transition and
 * side taper read as curves, and 0.1 m across a wall so its face is a face and not a ramp.
 * Walls run down the fall line, so only X needs the extra columns.
 */
function gridColumns(cfg: SlopeConfig): number[] {
  const half = cfg.width / 2;
  const xs: number[] = [];
  const coarse = Math.round(cfg.width / 0.75);
  for (let i = 0; i <= coarse; i++) xs.push(-half + (cfg.width * i) / coarse);
  for (const w of cfg.walls ?? []) {
    const span = w.radius + w.top + 2 * w.height + 1;
    const from = Math.min(w.x, w.x + w.side * span) - 0.5;
    const to = Math.max(w.x, w.x + w.side * span) + 0.5;
    for (let x = from; x <= to; x += 0.1) xs.push(x);
  }
  xs.sort((p, q) => p - q);
  return xs.filter((x, i) => Math.abs(x) <= half && (i === 0 || x - (xs[i - 1] ?? -Infinity) > 0.02));
}

/** Grid rows down the slope, likewise: 0.1 m across a quarter pipe's face, which runs across X. */
function gridRows(cfg: SlopeConfig, runOut: number): number[] {
  const zs: number[] = [];
  const coarse = Math.round((cfg.length + runOut) / 0.75);
  for (let j = 0; j <= coarse; j++) zs.push(runOut - ((cfg.length + runOut) * j) / coarse);
  for (const q of cfg.quarters ?? []) {
    const span = q.radius + q.deck + 2 * q.height + 1;
    for (let z = q.z + 0.5; z >= q.z - span; z -= 0.1) zs.push(z);
  }
  zs.sort((p, q) => q - p);
  return zs.filter((z, j) => j === 0 || (zs[j - 1] ?? Infinity) - z > 0.02);
}

function slopeMesh(cfg: SlopeConfig, terrain: Terrain): THREE.Mesh {
  const runOut = 20;
  const xs = gridColumns(cfg);
  const zs = gridRows(cfg, runOut);
  const rows = zs.length - 1;
  const cols = xs.length;
  const positions = new Float32Array(cols * (rows + 1) * 3);
  const uvs = new Float32Array(cols * (rows + 1) * 2);
  const contact = createContact();
  for (let j = 0; j <= rows; j++) {
    const z = zs[j] ?? 0;
    for (let i = 0; i < cols; i++) {
      const x = xs[i] ?? 0;
      const k = j * cols + i;
      positions[k * 3] = x;
      positions[k * 3 + 1] = terrain.sample(x, z, contact).height;
      positions[k * 3 + 2] = z;
      // World-scaled: one texture tile per 4 m, whatever the cell size.
      uvs[k * 2] = x / 4;
      uvs[k * 2 + 1] = z / 4;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + cols;
      index.push(a, a + 1, b, a + 1, b + 1, b); // counter-clockwise seen from above
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  const texture = snowTexture();
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

/** Rails as square bars along their segments — the sim's rail line is the bar's top. */
function railMeshes(terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x8a939c, roughness: 0.35, metalness: 0.8 });
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.6 });
  const size = 0.08;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const contact = createContact();
  const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x2f3a45, roughness: 0.5, metalness: 0.2 });
  for (const rail of terrain.rails) {
    // A box is a flat plate as wide as its top; a rail is a square bar.
    const across = rail.width > 0 ? rail.width : size;
    const thick = rail.width > 0 ? 0.15 : size;
    for (let i = 1; i < rail.count; i++) {
      a.set(rail.x[i - 1] ?? 0, (rail.y[i - 1] ?? 0) - thick / 2, rail.z[i - 1] ?? 0);
      b.set(rail.x[i] ?? 0, (rail.y[i] ?? 0) - thick / 2, rail.z[i] ?? 0);
      const len = a.distanceTo(b);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(across, thick, len), rail.width > 0 ? boxMaterial : material);
      bar.position.copy(a).add(b).multiplyScalar(0.5);
      bar.lookAt(b);
      bar.castShadow = true;
      group.add(bar);
    }
    // A post at each point, down to the snow.
    for (let i = 0; i < rail.count; i++) {
      const x = rail.x[i] ?? 0;
      const z = rail.z[i] ?? 0;
      const ground = terrain.sample(x, z, contact).height;
      const h = Math.max(0.05, (rail.y[i] ?? 0) - thick - ground);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), postMaterial);
      post.position.set(x, ground + h / 2, z);
      group.add(post);
    }
  }
  return group;
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

  const slope = slopeMesh(cfg, terrain);
  const markers = slopeMarkers(cfg, terrain);
  scene.add(slope);
  scene.add(markers);
  const rails = railMeshes(terrain);
  scene.add(rails);
  const skyColour = new THREE.Color(0x9db6cc);
  const stageColour = new THREE.Color(0xeef2f6);
  const fog = scene.fog;

  const rig = createRig();
  scene.add(rig.root);
  const drivers = neutralDrivers();

  const roll = new THREE.Quaternion();
  const tumble = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const railAxis = new THREE.Vector3();
  const tumbleAxis = new THREE.Vector3(1, 0.3, 0).normalize();
  let tumbleAngle = 0;

  const neutral = neutralDrivers();
  const base = neutralDrivers();
  // Butter tip-up scratch: the board pitch pivots on the hand point (rig.ts), so the root is
  // shifted to put the pressed end back on the snow.
  let butterTip = 0;
  const tip = new THREE.Vector3();
  const pivot = new THREE.Vector3();
  const pitchQuat = new THREE.Quaternion();
  const lateral = new THREE.Vector3(-1, 0, 0);
  const body = neutralDrivers();

  /**
   * Gameplay → drivers. The body blends toward the grab anchors by grip; the gripping
   * hand, the grips and the board's attitude come straight from the sim, so the board that
   * is drawn is the board the landing test judges. Everything that moves is a spring on the
   * sim tick (secondary.ts), never a per-frame integration (§7.6).
   */
  const driveFromSim = (view: RiderView, params: Params, secondary: Secondary): void => {
    const r = params.rig;
    const grounded = view.mode === 'grounded' || view.mode === 'walled';

    base.hipY = secondary.hipY;
    // On snow the hips lean into the edge; on a rail they carry the balance — the lean you
    // are fighting is the one you see. In the air lx is spin, not lean.
    // The rail's side (the way a positive lean falls) is −cos(slide) on board X and
    // sin(slide) on board Z, so the hips shift toward the side you are falling to.
    const railed = view.mode === 'railed';
    const c = railed ? Math.cos(view.slide) : 0;
    const sn = railed ? Math.sin(view.slide) : 0;
    base.hipX = grounded ? view.edge * r.edgeHipShift : railed ? -c * view.balance * r.railLean : 0;
    base.hipZ = view.stance * r.stanceHipShift + sn * view.balance * r.railLean;
    base.spineSide = view.stance * r.stanceSpineSide;
    base.spineBend = r.spineBendBase + view.compress * r.compressSpineBend;

    // Body leads, hand commits later — the grab path stays reachable the whole way (rig.ts).
    const bodyWeight = smoothstep(view.grip);
    const handWeight = gripWeight(view.grip, params.grab.gripDelay);
    grabBody(body, view.grabEdge, view.grabT, view.tweak);
    // A switch grab: the regular grab's pose (and hands, below) mirrored nose-for-tail.
    if (view.grabSwitch) mirrorDrivers(body);
    for (const k of BODY_KEYS) drivers[k] = base[k] + (body[k] - base[k]) * bodyWeight;
    // Wind-up and lead ride on top of whatever the grab asks for, not under it.
    drivers.spineTwist += secondary.twist;
    drivers.headYaw += secondary.head;

    const front = view.grabFront;
    drivers.frontHandEdge = front ? view.grabEdge : neutral.frontHandEdge;
    drivers.frontHandT = front ? view.grabT : neutral.frontHandT;
    drivers.frontGrip = front ? handWeight : 0;
    drivers.backHandEdge = front ? neutral.backHandEdge : view.grabEdge;
    drivers.backHandT = front ? neutral.backHandT : view.grabT;
    drivers.backGrip = front ? 0 : handWeight;
    if (view.grabSwitch) {
      // Hands only: the body above already carries its mirror.
      const fe = drivers.frontHandEdge;
      const ft = drivers.frontHandT;
      const fg = drivers.frontGrip;
      drivers.frontHandEdge = drivers.backHandEdge;
      drivers.frontHandT = 1 - drivers.backHandT;
      drivers.frontGrip = drivers.backGrip;
      drivers.backHandEdge = fe;
      drivers.backHandT = 1 - ft;
      drivers.backGrip = fg;
    }

    const a = boardAttitude(view.grabEdge, view.grabT, view.grip, view.tweak, params);
    // A butter tips the board onto the pressed end: nose press is nose down.
    const butter = grounded ? butterAmount(view.stance, view.speed, params) : 0;
    butterTip = butter > 0 ? Math.sign(view.stance) : 0;
    drivers.boardPitch = (view.grabSwitch ? -a.pitch : a.pitch) - butterTip * butter * params.butter.pitch;
    drivers.tweakRoll = a.roll;
    drivers.shifty = view.shifty;
    drivers.stanceScale = neutral.stanceScale;
  };

  return {
    renderer,
    scene,
    rider: rig.root,
    drivers,
    strain: rig.strain,
    shortfall: rig.shortfall,
    legSpan: rig.legSpan,

    updateRider(view, params, poseMode, secondary, dt) {
      const frameDt = Math.min(dt, MAX_FRAME_DT);
      rig.root.position.set(view.position.x, view.position.y, view.position.z);
      // Tumble winds down with the slide rather than spinning at a fixed rate forever.
      tumbleAngle =
        view.mode === 'bailed'
          ? tumbleAngle + Math.min(view.speed / params.bail.tumbleSpeedRef, 1) * params.bail.tumbleRate * frameDt
          : 0;

      // The sim owns board orientation — grounded it is slaved to the terrain, airborne
      // it carries angular momentum. Render just reads it.
      const q = view.spinFrame;
      rig.root.quaternion.set(q.x, q.y, q.z, q.w);

      // Edge roll is cosmetic and only means anything on snow.
      if (view.mode === 'grounded' || view.mode === 'walled') {
        // Local +X is the heel side (design §1), so a toe edge tips −X down.
        roll.setFromAxisAngle(zAxis, view.edge * params.rig.edgeRoll);
        rig.root.quaternion.multiply(roll);
      }
      if (view.mode === 'railed') {
        // Tip the whole rider about the rail toward the side the lean is falling to —
        // the balance you are fighting, readable at a glance. The rail in board-local
        // axes is (sin slide, 0, cos slide).
        railAxis.set(Math.sin(view.slide), 0, Math.cos(view.slide));
        roll.setFromAxisAngle(railAxis, view.balance * params.rig.railTilt);
        rig.root.quaternion.multiply(roll);
      }
      if (view.mode === 'bailed') {
        tumble.setFromAxisAngle(tumbleAxis, tumbleAngle);
        rig.root.quaternion.multiply(tumble);
      }

      // Pose mode leaves the drivers alone — they are the thing being authored.
      butterTip = 0;
      if (!poseMode) driveFromSim(view, params, secondary);
      if (butterTip !== 0) {
        // Where the pressed tip ends up after the rig pitches the board about the hand
        // point, and the root moved back by that much so the tip stays on the snow.
        const useFront = drivers.frontGrip >= drivers.backGrip;
        edgePoint(pivot, useFront ? drivers.frontHandEdge : drivers.backHandEdge, useFront ? drivers.frontHandT : drivers.backHandT);
        pitchQuat.setFromAxisAngle(lateral, drivers.boardPitch);
        tip.set(0, 0, butterTip * BOARD_HALF).sub(pivot).applyQuaternion(pitchQuat).add(pivot);
        tip.z -= butterTip * BOARD_HALF;
        tip.applyQuaternion(rig.root.quaternion);
        rig.root.position.sub(tip);
      }

      rig.apply(drivers, params);
    },

    setStage(clean) {
      slope.visible = !clean;
      markers.visible = !clean;
      scene.fog = clean ? null : fog;
      scene.background = clean ? stageColour : skyColour;
      // Reach diagnostics belong to authoring, not to play.
      rig.showReach(clean);
    },

    resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    },
  };
}
