import * as THREE from 'three';
import { hipTakeoff } from '../sim/hip.ts';
import { quat, slerp, type Quat } from '../sim/quat.ts';
import type { Params } from '../sim/params.ts';
import type { LandingRead, RiderMode, RiderState } from '../sim/state.ts';
import type { HipConfig, KickerConfig, SlopeConfig, Terrain } from '../sim/terrain.ts';
import { createContact } from '../sim/terrain.ts';
import { length, vec3, type Vec3 } from '../sim/vec3.ts';
import { boardAttitude, GRABS, grabAttitude } from '../sim/grabs.ts';
import { ANCHORS, BODY_KEYS, grabBody, namedGrabBody } from './poses.ts';
import { createTerrainMesh, type Rect, type TerrainMesh } from './terrainMesh.ts';
import { butterAmount } from '../sim/states/grounded.ts';
import { BOARD_HALF, copyDrivers, createRig, edgePoint, gripWeight, mirrorDrivers, neutralDrivers, smoothstep, type RigDrivers } from './rig.ts';
import { carveLoad, type Secondary } from './secondary.ts';
import { flutter, lcg } from './toon.ts';
import { TICK_DT } from '../core/loop.ts';

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
  posture: number; // two sticks: −1 stand tall .. +1 tuck
  onPanel: boolean; // riding a built face: the board is on it, no edge roll
  popStance: number; // the press the last pop went off: − ollie, + nollie, 0 not popped
  airTime: number; // s since leaving the snow
  airPitch: number; // rad of board poke under the body in the air, nose up +
  compress: number;
  scrub: number;
  brake: number;
  shiftPivot: number; // 0 an air shifty about the board's centre, 1 a speed check's tail pushed round the front binding
  speed: number;
  mode: RiderMode;
  landing: LandingRead;
  impact: number;
  absorb: number;
  bailTime: number;
  time: number; // s of sim time, interpolated — drives cloth flutter, so replay matches
  grabEdge: number;
  grabT: number;
  grabFront: boolean;
  grabSwitch: boolean;
  grabId: number;
  switchRide: boolean;
  grip: number;
  tweak: number;
  shifty: number;
  balance: number;
  slide: number;
  railContact: number;
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
  posture: 0,
  onPanel: false,
  popStance: 0,
  airTime: 0,
  airPitch: 0,
  compress: 0,
  scrub: 0,
  brake: 0,
  shiftPivot: 0,
  speed: 0,
  mode: 'airborne',
  landing: 'none',
  impact: 0,
  absorb: 0,
  bailTime: 0,
  time: 0,
  grabEdge: 0,
  grabT: 0.5,
  grabFront: true,
  grabSwitch: false,
  grabId: -1,
  switchRide: false,
  grip: 0,
  tweak: 0,
  shifty: 0,
  balance: 0,
  slide: 0,
  railContact: 0,
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
  view.posture = prev.posture + (cur.posture - prev.posture) * alpha;
  view.onPanel = cur.panelIndex >= 0;
  view.popStance = cur.popStance;
  view.airPitch = prev.airPitch + (cur.airPitch - prev.airPitch) * alpha;
  view.airTime = cur.mode === prev.mode ? prev.airTime + (cur.airTime - prev.airTime) * alpha : cur.airTime;
  view.compress = prev.compress + (cur.compress - prev.compress) * alpha;
  view.scrub = cur.scrub;
  view.brake = cur.brake;
  view.shiftPivot = 0;
  view.speed = length(cur.velocity);
  view.time = (prev.tick + (cur.tick - prev.tick) * alpha) * TICK_DT;
  view.mode = cur.mode;
  view.landing = cur.landing;
  view.impact = cur.impact;
  view.absorb = cur.absorb;
  view.bailTime = cur.bailTime;
  view.grabEdge = prev.grabEdge + (cur.grabEdge - prev.grabEdge) * alpha;
  view.grabT = prev.grabT + (cur.grabT - prev.grabT) * alpha;
  view.grabFront = cur.grabFront;
  view.grabSwitch = cur.grabSwitch;
  view.grabId = cur.grabId;
  view.switchRide = cur.switchRide;
  view.grip = prev.grip + (cur.grip - prev.grip) * alpha;
  view.tweak = prev.tweak + (cur.tweak - prev.tweak) * alpha;
  view.shifty = prev.shifty + (cur.shifty - prev.shifty) * alpha;
  view.balance = prev.balance + (cur.balance - prev.balance) * alpha;
  view.slide = cur.slide;
  view.railContact = prev.railContact + (cur.railContact - prev.railContact) * alpha;
  view.course =
    Math.abs(cur.velocity.x) + Math.abs(cur.velocity.z) > 1e-4
      ? Math.atan2(cur.velocity.x, cur.velocity.z)
      : view.heading;
  return view;
}

export type SceneView = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** The terrain mesh, chunked; `update` each frame sharpens it round the camera. */
  ground: TerrainMesh;
  rider: THREE.Group;
  /** Drivers the rig is currently posed with. Pose mode writes here directly. */
  drivers: RigDrivers;
  /** Per-hand shoulder-to-hand distance over arm reach; above 1 the grab is out of reach. */
  strain: { front: number; back: number };
  /** How far each hand falls short of its grab point, m. 0 when it reaches. */
  shortfall: { front: number; back: number };
  /** Solved elbow positions in the rider's frame, as rig.ts reports them. A diagnostic. */
  elbowAt: { front: THREE.Vector3; back: THREE.Vector3 };
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
  setDressed(on: boolean): void;
  /**
   * Show another park, or this one edited. `changed`: where the ground moved (a feature's old
   * and new footprints) — only the terrain there is rebuilt. Omitted, all of it is.
   */
  setPark(cfg: SlopeConfig, terrain: Terrain, changed?: readonly Rect[]): void;
  resize(): void;
};

/**
 * Snow, one tile per 4 m. What sells speed is texture streaming past near the board, so it
 * carries detail at two sizes: fine speckle (cm-scale crust and sparkle) for the near field
 * and soft patches for the middle distance, over groomer corduroy running down the fall line.
 * Seeded, so it is the same every load.
 */
function snowTexture(): THREE.Texture {
  const size = 512; // px per 4 m tile: ~8 mm a pixel
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const rnd = lcg(11);
    ctx.fillStyle = '#f4f8fc';
    ctx.fillRect(0, 0, size, size);
    // Soft patches, wrapped so the tile stays seamless.
    for (let i = 0; i < 40; i++) {
      const x = rnd() * size, y = rnd() * size, r = 30 + rnd() * 90;
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, rnd() < 0.5 ? 'rgba(200,214,230,0.35)' : 'rgba(255,255,255,0.5)');
        g.addColorStop(1, 'rgba(244,248,252,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
      }
    }
    // Corduroy along the fall line (v is z): ~5 cm ribs.
    for (let x = 0; x < size; x += 6) {
      ctx.fillStyle = (x / 6) % 2 === 0 ? 'rgba(205,218,232,0.45)' : 'rgba(255,255,255,0.35)';
      ctx.fillRect(x, 0, 3, size);
    }
    // Speckle: crust and sparkle, dark and light.
    for (let i = 0; i < 2600; i++) {
      const dark = rnd() < 0.7;
      ctx.fillStyle = dark ? `rgba(150,170,195,${0.25 + rnd() * 0.35})` : 'rgba(255,255,255,0.9)';
      const r = 0.8 + rnd() * (dark ? 2.2 : 1.2);
      ctx.beginPath();
      ctx.ellipse(rnd() * size, rnd() * size, r, r * (0.6 + rnd() * 0.8), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(201,216,230,0.6)';
    ctx.lineWidth = 2;
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
/** Metres from a takeoff's start to its lip: the arc, or a hip's arc and straight lip. */
function runInOf(k: KickerConfig | HipConfig): number {
  if ('hip' in k && k.hip) return hipTakeoff(k, k.hip).runIn;
  return (k.lipHeight / (1 - Math.cos(k.lipAngle))) * Math.sin(k.lipAngle);
}

/** Kickers and corners: both start with the same arc up to a lip. */
function takeoffs(cfg: SlopeConfig): Array<KickerConfig | HipConfig> {
  return [...(cfg.kickers ?? []), ...(cfg.corners ?? [])];
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
/**
 * Coloured lines along each cut takeoff's edges — the lip and both sides of the ramp, as
 * parks paint them — and along every quarter pipe's coping. They read the lip and the speed
 * from a distance. Park paint: a backcountry feature (to come) goes without. Takeoffs with
 * rolled sides (sideTaper over 1 m: the jib tables, the older parks) don't get them.
 */
function edgeLines(cfg: SlopeConfig, terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xd8325a });
  const contact = createContact();
  // Paint is laid out as if the feature faced straight down the hill (yaw 0) about its origin
  // (cx, cz), then turned with it — the same turn `turned()` gives its height function.
  let cx = 0;
  let cz = 0;
  let sinYaw = 0;
  let cosYaw = 1;
  const frame = (f: { x: number; z: number; yaw?: number }): void => {
    cx = f.x;
    cz = f.z;
    sinYaw = Math.sin(f.yaw ?? 0);
    cosYaw = Math.cos(f.yaw ?? 0);
  };
  const worldX = (x: number, z: number): number => cx + (cz - z) * sinYaw + (x - cx) * cosYaw;
  const worldZ = (x: number, z: number): number => cz - (cz - z) * cosYaw + (x - cx) * sinYaw;
  const heightAt = (x: number, z: number): number => terrain.sample(worldX(x, z), worldZ(x, z), contact).height;
  const at = (x: number, z: number, insetX: number, insetZ: number): THREE.Vector3 =>
    new THREE.Vector3(worldX(x, z), heightAt(x - insetX, z - insetZ) + 0.03, worldZ(x, z));
  const tube = (points: THREE.Vector3[]): void => {
    const curve = new THREE.CatmullRomCurve3(points);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 2, 0.045, 6, false), material));
  };
  for (const k of takeoffs(cfg)) {
    if (k.sideTaper > 1) continue;
    frame(k);
    const runIn = runInOf(k);
    const lip = k.z - runIn;
    const half = k.width * 0.5;
    for (const side of [-1, 1]) {
      const x = k.x + side * (half - 0.05);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) pts.push(at(x, k.z - (runIn * i) / 24, side * 0.05, 0));
      tube(pts);
    }
    const lipPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) lipPts.push(at(k.x - half + 0.05 + ((2 * half - 0.1) * i) / 12, lip + 0.02, 0, 0));
    tube(lipPts);
    // A separate landing (gap jump): the knuckle dyed across its top, where the landing starts.
    if ('knuckleHeight' in k && k.knuckleHeight !== undefined) {
      const knuckle = lip - k.deckLength;
      const deckHalf = (k.deckWidth ?? k.width) * 0.5 - 0.3;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 16; i++) pts.push(at(k.x - deckHalf + (2 * deckHalf * i) / 16, knuckle, 0, 0));
      tube(pts);
    }
  }
  // A corner's deck edges too — the knuckle on all three sides, where its landings start.
  for (const c of cfg.corners ?? []) {
    if (c.sideTaper > 1) continue;
    frame(c);
    const lip = c.z - runInOf(c);
    const end = lip - c.deckLength + 0.05;
    const half = c.deckWidth * 0.5 - 0.05;
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) pts.push(at(c.x + side * half, lip - ((lip - end) * i) / 12, side * 0.05, 0));
      tube(pts);
    }
    const back: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) back.push(at(c.x - half + (2 * half * i) / 8, end, 0, -0.05));
    tube(back);
    // The side landings' cut uphill ends, from the deck corner down to the snow — on a hip, the
    // knuckle seen from the side; only where it has a landing.
    if (c.deckTaper !== undefined && c.deckTaper <= 1) {
      const reach = 3 * c.lipHeight / Math.tan(c.landingAngle); // past the landing's end; the line stops at the snow
      for (const side of [-1, 1]) {
        if (c.hip && c.hip.side !== 0 && c.hip.side !== side) continue;
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 30; i++) {
          const p = at(c.x + side * (half + (reach * i) / 30), lip - 0.05, 0, 0.05);
          if (p.y - heightAt(c.x + side * (half + (reach * i) / 30), lip + 2) < 0.1) break;
          pts.push(p);
        }
        if (pts.length > 1) tube(pts);
      }
    }
  }
  // Coping: just onto the deck past the face, along the full-height length of the pipe.
  for (const q of cfg.quarters ?? []) {
    frame(q);
    const r = q.radius;
    const faceEnd = r * Math.sin(q.angle) + Math.max(0, q.height - r * (1 - Math.cos(q.angle))) / Math.tan(q.angle);
    const pts: THREE.Vector3[] = [];
    const n = Math.max(2, Math.round(q.width / 2));
    for (let i = 0; i <= n; i++) {
      const along = -q.width * 0.5 + (q.width * i) / n;
      if (q.side) pts.push(at(q.x + q.side * (faceEnd + 0.08), q.z + along, -q.side * 0.04, 0));
      else pts.push(at(q.x + along, q.z - faceEnd - 0.08, 0, 0.04));
    }
    tube(pts);
  }
  // Painted small kickers (side hits built as park features): the lip and both sides of the ramp.
  for (const h of cfg.shapes ?? []) {
    if (h.kind !== 'sideHit' || !h.paint) continue;
    frame(h);
    const runIn = (h.height / (1 - Math.cos(h.angle))) * Math.sin(h.angle);
    const half = h.width * 0.5;
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) pts.push(at(h.x + side * (half - 0.05), h.z - (runIn * i) / 12, side * 0.05, 0));
      tube(pts);
    }
    const lipPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) lipPts.push(at(h.x - half + 0.05 + ((2 * half - 0.1) * i) / 8, h.z - runIn + 0.02, 0, 0));
    tube(lipPts);
  }
  return group;
}

/** Take a group out of the scene and free what it built. Each builder above makes its own materials. */
function disposeGroup(scene: THREE.Scene, group: THREE.Group): void {
  scene.remove(group);
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Line)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) (m as THREE.Material).dispose();
  });
}

/** A flat arrow on the snow along board +Z, the way of travel: shaft and head, 1.3 m long. */
function downhillArrow(): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-0.05, -0.2);
  shape.lineTo(0.05, -0.2);
  shape.lineTo(0.05, 0.8);
  shape.lineTo(0.16, 0.8);
  shape.lineTo(0, 1.1);
  shape.lineTo(-0.16, 0.8);
  shape.lineTo(-0.05, 0.8);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2); // shape +Y → board +Z, lying flat, facing up
  geometry.translate(0, 0.005, 0);
  const material = new THREE.MeshBasicMaterial({ color: 0xd8325a, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

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

/**
 * Built wallrides (docs/walls-plan.md): each panel a plywood slab behind its face with a darker
 * cap along the top; each block (a building, a box) one solid box. Block faces are panels in the
 * sim, so they're the panels past the config's own, drawn here as the block instead.
 */
function panelMeshes(cfg: SlopeConfig, terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xc79a5b, roughness: 0.8 });
  const cap = new THREE.MeshStandardMaterial({ color: 0x6b5640, roughness: 0.7 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x8c8f93, roughness: 0.9 });
  const thick = 0.15;
  const a = new THREE.Vector3();
  const e = new THREE.Vector3();
  const n = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const own = cfg.panels?.length ?? 0;
  for (let i = 0; i < own; i++) {
    const p = terrain.panels[i];
    if (!p) continue;
    a.set(p.ax, p.ay, p.az);
    e.set(p.ex, p.ey, p.ez);
    n.set(p.nx, p.ny, p.nz);
    basis.makeBasis(a, e, n);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(p.length, p.height, thick), wood);
    slab.quaternion.setFromRotationMatrix(basis);
    slab.position.set(p.x0, p.y0, p.z0).addScaledVector(a, p.length / 2).addScaledVector(e, p.height / 2).addScaledVector(n, -thick / 2);
    slab.castShadow = true;
    group.add(slab);
    const top = new THREE.Mesh(new THREE.BoxGeometry(p.length, 0.08, thick + 0.04), cap);
    top.quaternion.copy(slab.quaternion);
    top.position.set(p.x0, p.y0, p.z0).addScaledVector(a, p.length / 2).addScaledVector(e, p.height).addScaledVector(n, -thick / 2);
    group.add(top);
  }
  const contact = createContact();
  for (const b of cfg.blocks ?? []) {
    const ground = terrain.sample(b.x, b.z, contact).height;
    const box = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, b.length), wall);
    // Box Z along the block's axis (sin yaw, −cos yaw): turned −yaw about up.
    box.rotation.y = -b.yaw;
    box.position.set(b.x, ground + b.height / 2, b.z);
    box.castShadow = true;
    group.add(box);
  }
  return group;
}

/** `cell` is the coarse grid size in m — larger for a park scaled up, whose features are too. */
export function createScene(cfg: SlopeConfig, terrain: Terrain, camera: THREE.PerspectiveCamera): SceneView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  // CSS sizes the canvas to the screen (index.html); `resize` matches the drawing buffer to
  // it. Sized from innerHeight instead, iPad Safari left a band at the bottom when its
  // toolbars changed the visible height without a resize event.
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.domElement.id = 'view';
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9db6cc);
  scene.fog = new THREE.Fog(0x9db6cc, 60, 320);

  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(-40, 80, 30);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbcd7f0, 0xe8eef4, 1.1));

  const snowMap = snowTexture();
  // The camera looks along the snow at a grazing angle; without anisotropic filtering the
  // texture smears to flat white a few metres out and the ground stops showing speed.
  snowMap.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const snow = new THREE.MeshStandardMaterial({ map: snowMap, roughness: 0.95, metalness: 0 });
  let slope = createTerrainMesh(cfg, terrain, snow);
  let markers = slopeMarkers(cfg, terrain);
  let rails = railMeshes(terrain);
  let panels = panelMeshes(cfg, terrain);
  let edges = edgeLines(cfg, terrain);
  scene.add(slope.group, markers, rails, edges, panels);
  let size = { width: cfg.width, length: cfg.length };
  // Pose mode: an arrow under the rider along the direction of travel, down the hill, to set
  // a grab's turn against.
  const downhill = downhillArrow();
  downhill.visible = false;
  scene.add(downhill);
  const skyColour = new THREE.Color(0x9db6cc);
  const stageColour = new THREE.Color(0xeef2f6);
  const fog = scene.fog;

  const rig = createRig();
  scene.add(rig.root);
  const drivers = neutralDrivers();

  const roll = new THREE.Quaternion();
  const tumble = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const railAxis = new THREE.Vector3();
  const tumbleAxis = new THREE.Vector3(1, 0.3, 0).normalize();
  let tumbleAngle = 0;
  // Touchdown: the board is drawn from its air attitude onto the slope over a short blend
  // instead of jumping there in one tick. Render only — the sim judged the landing at contact.
  const landOffset = new THREE.Quaternion();
  const lastBase = new THREE.Quaternion();
  const baseInverse = new THREE.Quaternion();
  const noTurn = new THREE.Quaternion();
  let lastMode = '';

  const neutral = neutralDrivers();
  const base = neutralDrivers();
  // Tip-up scratch: the board pitch pivots on the hand point (rig.ts), so the root is shifted
  // to keep one board point where the sim put it — the pressed tip of a butter on the snow,
  // the contact point of a press over the rail. `pinZ` is that point on board Z; 0 is none.
  let pinZ = 0;
  // 0..1, how much the rail pose is a blunt — read again for the board's pitch.
  let railBlunt = 0;
  // The grab's turn of the whole rider (sim grabs.ts `yaw`), applied to the root after the
  // drivers — the sim's board turns by the same, so the landing judges what is drawn.
  let grabYaw = 0;
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
  const pressScratch = neutralDrivers();
  const slideScratch = neutralDrivers();
  /** Blend the body keys toward a pose; elbow poles the short way round, since they wrap. */
  const blendToward = (out: RigDrivers, to: RigDrivers, w: number): void => {
    for (const k of BODY_KEYS) {
      let d = to[k] - out[k];
      if (k === 'frontElbowPole' || k === 'backElbowPole') d = Math.atan2(Math.sin(d), Math.cos(d));
      out[k] += d * w;
    }
  };

  const armToward = (front: boolean, from: RigDrivers, to: RigDrivers, w: number): void => {
    if (front) {
      drivers.frontShoulderSwing = from.frontShoulderSwing + (to.frontShoulderSwing - from.frontShoulderSwing) * w;
      drivers.frontShoulderOut = from.frontShoulderOut + (to.frontShoulderOut - from.frontShoulderOut) * w;
      drivers.frontElbow = from.frontElbow + (to.frontElbow - from.frontElbow) * w;
      drivers.frontElbowPole = from.frontElbowPole + Math.atan2(Math.sin(to.frontElbowPole - from.frontElbowPole), Math.cos(to.frontElbowPole - from.frontElbowPole)) * w;
    } else {
      drivers.backShoulderSwing = from.backShoulderSwing + (to.backShoulderSwing - from.backShoulderSwing) * w;
      drivers.backShoulderOut = from.backShoulderOut + (to.backShoulderOut - from.backShoulderOut) * w;
      drivers.backElbow = from.backElbow + (to.backElbow - from.backElbow) * w;
      drivers.backElbowPole = from.backElbowPole + Math.atan2(Math.sin(to.backElbowPole - from.backElbowPole), Math.cos(to.backElbowPole - from.backElbowPole)) * w;
    }
  };

  const driveFromSim = (view: RiderView, params: Params, secondary: Secondary): void => {
    const r = params.rig;
    const grounded = view.mode === 'grounded' || view.mode === 'walled';

    base.hipY = secondary.hipY;
    // On snow the hips lean into the edge; on a rail they carry the balance — the lean you
    // are fighting is the one you see. In the air lx is spin, not lean.
    // The rail's side (the way a positive lean falls) is −cos(slide) on board X and
    // sin(slide) on board Z, so the hips shift toward the side you are falling to.
    // In the rail trick model the balance is already over the edges (+ heel, board +X) and
    // the hips sit over the contact point instead of following the stick.
    const railed = view.mode === 'railed';
    const trick = railed && params.rail.trickModel >= 0.5;
    const c = railed ? Math.cos(view.slide) : 0;
    const sn = railed ? Math.sin(view.slide) : 0;
    if (trick) {
      // The lean and the press shift go on after the slide poses below, not into base.
      base.hipX = 0;
      base.hipZ = 0;
      base.spineSide = 0;
    } else {
      base.hipX = grounded ? view.edge * r.edgeHipShift : railed ? -c * view.balance * r.railLean : 0;
      // A press is a weight shift onto the snow; in the air stick Y is a flip, not a lean.
      const press = view.stance * (1 - secondary.inAir);
      base.hipZ = press * r.stanceHipShift + sn * view.balance * r.railLean;
      base.spineSide = press * r.stanceSpineSide;
    }
    base.spineBend = r.spineBendBase + view.compress * r.compressSpineBend;
    // Riders look down the hill, not straight across the board: toward the nose, or the
    // tail riding switch. A grab's anchor carries its own head and takes over as it comes on.
    base.headYaw = view.switchRide ? -r.rideHeadYaw : r.rideHeadYaw;

    // Body leads, hand commits later — the grab path stays reachable the whole way (rig.ts).
    const bodyWeight = smoothstep(view.grip);
    const handWeight = gripWeight(view.grip, params.grab.gripDelay);
    // Stick model 2 names its grab: that anchor's pose exactly, hand where it was authored.
    const named = params.grab.stickModel >= 2 ? GRABS[view.grabId]?.name : undefined;
    const anchor = named ? ANCHORS[named] : undefined;
    if (named && anchor) namedGrabBody(body, named, view.tweak);
    else grabBody(body, view.grabEdge, view.grabT, view.tweak);
    // A switch grab: the regular grab's pose (and hands, below) mirrored nose-for-tail.
    if (view.grabSwitch) mirrorDrivers(body);
    for (const k of BODY_KEYS) drivers[k] = base[k] + (body[k] - base[k]) * bodyWeight;
    // The gripping arm's drivers were authored for a hand on the board, where they only steer
    // the elbow; as a free arm they fling the hand out wide. So that arm stays in the riding
    // pose until the hand commits and moves into the grab with it, elbow the short way round.
    const frontReaches = view.grabFront !== view.grabSwitch;
    armToward(frontReaches, base, body, handWeight);
    if (trick) {
      // Slide poses (poses.ts): across the rail toward the toes is the backside
      // boardslide (open), toward the heels the frontside (blind) — travel in board frame is (sin slide, ·, cos slide)
      // with +X the heel. Weight on an end blends toward the press, mirrored for the tail.
      const across = smoothstep((Math.abs(sn) - 0.3) / 0.6);
      const slidePose = sn < 0 ? ANCHORS.backsideBoardslide : ANCHORS.frontsideBoardslide;
      if (slidePose && across > 0) {
        // Posed with the board yawed under the body (shifty); in play the sim owns the
        // board, so the same relative turn goes on the hips.
        copyDrivers(slideScratch, slidePose);
        // Came in riding switch: same board on the rail, but the lead is the tail side, so
        // the pose mirrors nose-for-tail — head over the other shoulder, lead arm swapped.
        if (view.switchRide) mirrorDrivers(slideScratch);
        slideScratch.hipYaw -= slideScratch.shifty;
        blendToward(drivers, slideScratch, across);
      }
      // Weight on an end. Along the rail it's a press. Across it, the rail under a foot is
      // a blunt (nose blunt under the front foot), out at a tip a noseslide or tailslide —
      // each its own anchor, authored for the nose and mirrored for the tail.
      const end = Math.abs(view.railContact);
      const pressAmount = smoothstep(end / Math.max(params.rail.pressMax, 1e-3));
      const onEnd = smoothstep((end - r.slideEndMin) / Math.max(r.slideEndMin, 1e-3)) * across;
      const tipward = smoothstep((end - r.bluntContact) / Math.max(r.slideContact - r.bluntContact, 1e-3));
      railBlunt = onEnd * (1 - tipward);
      const toEnd = (endPose: RigDrivers | undefined, w: number): void => {
        if (!endPose || w <= 0) return;
        copyDrivers(pressScratch, endPose);
        if (view.railContact < 0) mirrorDrivers(pressScratch);
        blendToward(drivers, pressScratch, w);
      };
      toEnd(ANCHORS.press, pressAmount * (1 - across));
      toEnd(ANCHORS.noseBlunt, railBlunt);
      toEnd(ANCHORS.noseslide, onEnd * tipward);
      // The lean you are fighting, and the hips over the contact, on top of whatever pose.
      drivers.hipX += view.balance * r.railLean;
      drivers.hipZ += view.railContact * r.pressHipShift;
      drivers.spineSide += view.railContact * r.stanceSpineSide;
    }
    // The hunch rides on top of whatever the grab asks for, not under it: the anchors were
    // authored straight-backed, and a grab shouldn't sit the rider up. Wind-up and lead
    // (below, with the hands) likewise, until a hand grips.
    drivers.spineCurl += r.spineCurlBase + view.compress * r.compressSpineCurl + secondary.airCrouch * r.airSlouch;
    drivers.spineBend += secondary.airCrouch * r.airFold;
    drivers.headYaw += secondary.head;
    drivers.hipX += secondary.swayX;
    drivers.hipZ += secondary.swayZ;
    // Carving posture (two-stick spec §8): legs and torso shape the turn apart. Heelside you
    // sit toward the heel and fold the chest forward over the toes; toeside the knees drive
    // at the snow while the hips stay over the board and the chest stays tall. The torso
    // tipping back toward the outside of the turn is the angulation. The board's edge roll
    // already tips the whole rider; this is the shape inside it.
    const load = grounded ? carveLoad(secondary, params) * (1 - secondary.inAir) : 0;
    const heel = Math.max(0, load);
    const toe = Math.max(0, -load);
    drivers.hipX += heel * r.heelSit + toe * r.toeHipBack;
    drivers.spineBend += load * r.angulation;
    drivers.kneeSplay -= toe * r.toeKneeDrive;
    // Posture: the tuck folds the chest over the knees, standing tall straightens it.
    drivers.spineBend += view.posture > 0 ? view.posture * r.tuckFold : view.posture * r.tallFold;

    const front = view.grabFront;
    const handEdge = anchor ? (front ? anchor.frontHandEdge : anchor.backHandEdge) : view.grabEdge;
    const handT = anchor ? (front ? anchor.frontHandT : anchor.backHandT) : view.grabT;
    drivers.frontHandEdge = front ? handEdge : neutral.frontHandEdge;
    drivers.frontHandT = front ? handT : neutral.frontHandT;
    drivers.frontGrip = front ? handWeight : 0;
    drivers.backHandEdge = front ? neutral.backHandEdge : handEdge;
    drivers.backHandT = front ? neutral.backHandT : handT;
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

    // Body sequencing (shoulders' twist and hips' yaw, both measured from the board; spine
    // twist is shoulders against hips) and the loose arms, faded out under a grab: a gripping hand is pinned to
    // the board, and its elbow aims from the shoulder drivers in chest space, so the chest
    // twisting off the board or the arm swinging round would carry the elbow across the
    // shoulder-to-hand line and break it backward. A rider holding the board turns with it.
    // Gone by the time the hand commits (`gripDelay` into the grab), so a gripping arm is
    // always the authored pose.
    const held = 1 - smoothstep(view.grip / Math.max(params.grab.gripDelay, 1e-3));
    const frontGrabs = view.grabFront !== view.grabSwitch;
    const fg = frontGrabs ? held : 1;
    const bg = frontGrabs ? 1 : held;
    drivers.hipYaw += secondary.hipYaw * held;
    drivers.spineTwist += (secondary.twist - secondary.hipYaw) * held;
    // Arms swung round as a pair: a turn about board up carries the front arm (nose side)
    // toward the heel, back in its swing, and the back arm toward the toes, forward.
    // Opened out along the board — Out is negative outward on both arms. Loose body: arms
    // trail the board's acceleration (secondary.ts); toward the nose is − Out on the front
    // arm, + on the back.
    drivers.frontShoulderSwing -= (secondary.armYaw + secondary.armX) * fg;
    drivers.backShoulderSwing += (secondary.armYaw - secondary.armX) * bg;
    drivers.frontShoulderOut -= (secondary.armOpen + secondary.armZ) * fg;
    drivers.backShoulderOut += (secondary.armZ - secondary.armOpen) * bg;
    // Tucked (two sticks), the arms come in: forward and bent, close to the knees.
    const tucked = Math.max(0, view.posture);
    drivers.frontShoulderSwing += tucked * r.tuckArmSwing * fg;
    drivers.backShoulderSwing += tucked * r.tuckArmSwing * bg;
    drivers.frontElbow += tucked * r.tuckElbow * fg;
    drivers.backElbow += tucked * r.tuckElbow * bg;
    // Carving arms: forward as counterweight to a heelside sit; past `handDragLoad` the
    // trailing hand reaches toward the snow inside the turn — behind on the heel side, out
    // over the toes on the toe side — and the lead arm lifts against it. + Swing is toward
    // the toes. Riding switch the trailing arm is the front one.
    const drag = smoothstep((Math.abs(load) - r.handDragLoad) / Math.max(1 - r.handDragLoad, 1e-3)) * r.handDrag;
    const trailing = -Math.sign(load) * drag;
    const leading = 0.5 * Math.sign(load) * drag;
    drivers.frontShoulderSwing += (heel * r.heelArms + (view.switchRide ? trailing : leading)) * fg;
    drivers.backShoulderSwing += (heel * r.heelArms + (view.switchRide ? leading : trailing)) * bg;

    const a = named
      ? grabAttitude(view.grabId, view.grip, view.tweak, params)
      : boardAttitude(view.grabEdge, view.grabT, view.grip, view.tweak, params);
    grabYaw = view.grabSwitch ? -a.yaw : a.yaw;
    // A butter tips the board onto the pressed end: nose press is nose down.
    const butter = grounded ? butterAmount(view.stance, view.speed, params) : 0;
    const butterTip = butter > 0 ? Math.sign(view.stance) : 0;
    drivers.boardPitch = (view.grabSwitch ? -a.pitch : a.pitch) - butterTip * butter * params.butter.pitch;
    pinZ = butterTip * BOARD_HALF;
    // Ollie and nollie, drawn: crouching on a press the board tips onto that end, and just
    // after the pop the other end snaps up — nose up off the tail, tail up off the nose —
    // then levels. Pivots on the end that popped. Render only: the landing test reads the
    // sim's board, and the snap is gone `rig.popPitchTime` into the air.
    // The poke (two sticks, right stick Y in the air): the board the landing test judges.
    drivers.boardPitch += view.airPitch;
    let popTip = 0;
    if (grounded && butter === 0) popTip = -view.stance * view.compress * r.popLoadPitch;
    else if (view.mode === 'airborne' && view.popStance !== 0 && view.airTime < r.popPitchTime) {
      // A grab coming on takes the board's attitude over, pivoting on the hand.
      popTip = -view.popStance * r.popPitch * Math.sin((Math.PI * view.airTime) / r.popPitchTime) * (1 - view.grip);
    }
    if (popTip !== 0) {
      drivers.boardPitch += popTip;
      if (view.grip === 0) pinZ = popTip > 0 ? -BOARD_HALF : BOARD_HALF;
    }
    if (trick) {
      // A press tips the board onto its contact point: nose press, nose down.
      drivers.boardPitch -= view.railContact * r.pressPitch;
      // A blunt stands the board up on the rail: the free end high.
      drivers.boardPitch -= Math.sign(view.railContact) * railBlunt * r.bluntPitch;
      pinZ = view.railContact * params.rail.boardHalf; // where the sim put the contact
    }
    drivers.tweakRoll = a.roll;
    drivers.shifty = view.shifty;
    drivers.stanceScale = neutral.stanceScale;
  };

  return {
    get ground() {
      return slope;
    },
    renderer,
    scene,
    rider: rig.root,
    drivers,
    strain: rig.strain,
    shortfall: rig.shortfall,
    legSpan: rig.legSpan,
    elbowAt: rig.elbowAt,

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
      const onSnow = view.mode === 'grounded' || view.mode === 'walled';
      if (!poseMode && onSnow && lastMode === 'airborne') {
        // drawn = offset · sim, so at touchdown offset = last air attitude · sim⁻¹.
        landOffset.copy(lastBase).multiply(baseInverse.copy(rig.root.quaternion).invert());
      } else if (!onSnow) landOffset.identity();
      lastBase.copy(rig.root.quaternion);
      lastMode = view.mode;
      if (Math.abs(landOffset.w) < 1 - 1e-7) {
        const blend = view.landing === 'sketchy' ? params.rig.landBlendSketchy : params.rig.landBlendClean;
        landOffset.slerp(noTurn, 1 - Math.exp((-3 * frameDt) / Math.max(blend, 1e-3)));
        rig.root.quaternion.premultiply(landOffset);
      }

      // Edge roll is cosmetic and only means anything on snow.
      if ((view.mode === 'grounded' || view.mode === 'walled') && !view.onPanel) {
        // Local +X is the heel side (design §1), so a toe edge tips −X down.
        roll.setFromAxisAngle(zAxis, view.edge * params.rig.edgeRoll);
        rig.root.quaternion.multiply(roll);
      }
      if (view.mode === 'railed') {
        // Tip the whole rider about the rail toward the side the lean is falling to —
        // the balance you are fighting, readable at a glance. The rail in board-local
        // axes is (sin slide, 0, cos slide).
        // Trick model: the lean is over the edges, so the tip is about the board's own axis.
        if (params.rail.trickModel >= 0.5) railAxis.set(0, 0, -1);
        else railAxis.set(Math.sin(view.slide), 0, Math.cos(view.slide));
        roll.setFromAxisAngle(railAxis, view.balance * params.rig.railTilt);
        rig.root.quaternion.multiply(roll);
      }
      if (view.mode === 'bailed') {
        tumble.setFromAxisAngle(tumbleAxis, tumbleAngle);
        rig.root.quaternion.multiply(tumble);
      }

      // Pose mode leaves the drivers alone — they are the thing being authored.
      pinZ = 0;
      grabYaw = 0;
      if (!poseMode) driveFromSim(view, params, secondary);
      // The arrow down the hill keeps the rider's frame before the turn: the turn is measured
      // against it. In pose mode the turn is the driver being authored; in play, the grab's.
      downhill.position.copy(rig.root.position);
      downhill.quaternion.copy(rig.root.quaternion);
      const turn = poseMode ? drivers.turn : grabYaw;
      if (turn !== 0) {
        roll.setFromAxisAngle(yAxis, turn);
        rig.root.quaternion.multiply(roll);
      }
      if (!poseMode && drivers.shifty !== 0) {
        // A hand holding the board can't let it yaw away under a still body: that much of
        // the shifty turns the whole rider instead, about the same axis, and only the rest
        // twists the board under the hips. The sim's board is the same either way.
        const held = Math.min(1, Math.max(drivers.frontGrip, drivers.backGrip));
        const turn = drivers.shifty * params.rig.shiftyGrabTurn * held;
        if (turn !== 0) {
          drivers.shifty -= turn;
          roll.setFromAxisAngle(yAxis, turn);
          rig.root.quaternion.multiply(roll);
        }
        // An air shifty is the body splitting, not the board turning under a still one: the
        // hips go part of the way with the board and the shoulders counter-rotate against it.
        // Not the speed check's skid (shiftPivot), where the body stays down the line.
        if (view.mode === 'airborne' && view.shiftPivot === 0) {
          drivers.hipYaw += drivers.shifty * params.rig.shiftyHipFollow;
          drivers.spineTwist -= drivers.shifty * (params.rig.shiftyHipFollow + params.rig.shiftyCounter);
        }
      }
      if (pinZ !== 0) {
        // Where the pressed tip ends up after the rig pitches the board about the hand
        // point, and the root moved back by that much so the tip stays on the snow.
        const useFront = drivers.frontGrip >= drivers.backGrip;
        edgePoint(pivot, useFront ? drivers.frontHandEdge : drivers.backHandEdge, useFront ? drivers.frontHandT : drivers.backHandT);
        pitchQuat.setFromAxisAngle(lateral, drivers.boardPitch);
        tip.set(0, 0, pinZ).sub(pivot).applyQuaternion(pitchQuat).add(pivot);
        tip.z -= pinZ;
        tip.applyQuaternion(rig.root.quaternion);
        rig.root.position.sub(tip);
      }

      rig.shiftPivot = view.shiftPivot;
      rig.apply(drivers, params);

      // Cloth (9c): springs from Secondary, flutter from sim time and speed. Still in pose
      // mode, so the pose being authored isn't blowing about.
      const still = poseMode;
      rig.cloth.skirt.rotation.set(still ? 0 : secondary.skirtX, 0, still ? 0 : secondary.skirtZ);
      rig.cloth.hood.rotation.set(still ? 0 : secondary.hoodX, 0, still ? 0 : secondary.hoodZ);
      flutter.uTime.value = view.time;
      flutter.uAmp.value = still ? 0 : Math.min(view.speed * params.cloth.flutterPerSpeed, params.cloth.flutterMax);
    },

    setStage(clean) {
      slope.group.visible = !clean;
      markers.visible = !clean;
      scene.fog = clean ? null : fog;
      scene.background = clean ? stageColour : skyColour;
      // Reach diagnostics belong to authoring, not to play.
      rig.showReach(clean);
      downhill.visible = clean;
    },

    setDressed(on) {
      rig.setDressed(on);
    },

    setPark(next, nextTerrain, changed) {
      if (next.width === size.width && next.length === size.length) {
        slope.invalidate(nextTerrain, changed);
      } else {
        const visible = slope.group.visible;
        scene.remove(slope.group);
        slope.dispose();
        slope = createTerrainMesh(next, nextTerrain, snow);
        slope.group.visible = visible;
        scene.add(slope.group);
        size = { width: next.width, length: next.length };
      }
      // Markers, rails and paint are cheap: rebuilt whole.
      const visible = markers.visible;
      for (const g of [markers, rails, edges, panels]) disposeGroup(scene, g);
      markers = slopeMarkers(next, nextTerrain);
      markers.visible = visible;
      rails = railMeshes(nextTerrain);
      panels = panelMeshes(next, nextTerrain);
      edges = edgeLines(next, nextTerrain);
      scene.add(markers, rails, edges, panels);
    },

    resize() {
      const w = renderer.domElement.clientWidth || innerWidth;
      const h = renderer.domElement.clientHeight || innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    },
  };
}
