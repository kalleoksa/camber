import * as THREE from 'three';
import { lcg, toon } from './toon.ts';

/**
 * Board and bindings, drawn only. Board local: +Z nose, +Y up, +X heel side; the rider
 * faces −X. The sim never sees any of this — edges and contact live in the sim's own
 * numbers — so shape is free to look right.
 */
export const BOARD = {
  // A directional freeride shape from your spec sheet, sized up past the 160W to suit the
  // rider's height and bulk. Board Z is centred on the stance, not the board: the setback
  // puts the nose further out than the tail.
  length: 1.62, // m tip to tip
  setback: 0.04, // m the stance sits back from the board's middle
  waist: 0.264, // m wide at the waist, the middle of the sidecut
  sidecutDepth: 0.0222, // m per edge, waist to contact points
  runningLength: 1.17, // m between contact points, centred on the stance
  noseWidth: 0.316, // m, widest point of the nose
  tailWidth: 0.304, // m, widest point of the tail — the taper
  noseRise: 0.07, // m of rocker at the nose tip
  noseRiseFrom: 0.3, // m ahead of stance centre where the rocker starts
  tailRise: 0.045, // m of kick at the tail end
  camber: 0.004, // m the base arches between the contact points, unweighted
  bottom: 0.015, // m base above the board origin
  thickness: 0.013, // m
  top: 0x0f6e5c, // green topsheet
  topLine: 0x5fae9c, // its contour lines
  base: 0xa9a7a8, // grey base — light against the topsheet, so a tweak's roll reads
  side: 0x111316,

  stanceFront: 0.26, // rad of duck on the front binding, toe toward the nose
  stanceBack: -0.26, // rad on the back, toe toward the tail
  // Binding and boot, from your references: white chassis and highback, black straps with
  // white ratchets, dark footbed; olive boot with a black collar, white midsole, black sole.
  chassis: 0xe6e8ea,
  footbed: 0x34363a,
  strap: 0x16171a,
  ratchet: 0xf2f2f2,
  boot: 0x6c7350,
  collar: 0x16171a,
  midsole: 0xeeeeea,
  outsole: 0x1b1b1b,
  maxFlex: 0.7, // rad the boot shaft can follow the shin off the binding's up
};

const STATIONS = 128;
export const NOSE_END = BOARD.length / 2 + BOARD.setback;
export const TAIL_END = -(BOARD.length / 2 - BOARD.setback);
const CONTACT = BOARD.runningLength / 2;

/** Superellipse falloff 1 → 0 over t 0..1: n > 2 is a blunter, squarer tip. */
function tipCurve(t: number, n: number): number {
  return Math.pow(Math.max(1 - Math.pow(Math.min(t, 1), n), 0), 1 / n);
}

/**
 * Half-width at `z`: parabolic sidecut to the contact points, then the tip widens to its
 * widest point and closes off blunt. The nose is longer and wider than the tail.
 */
function halfWidth(z: number): number {
  const b = BOARD;
  const a = Math.abs(z);
  const atContact = b.waist / 2 + b.sidecutDepth;
  if (a <= CONTACT) return b.waist / 2 + b.sidecutDepth * (a / CONTACT) ** 2;
  const nose = z > 0;
  const tipLen = (nose ? NOSE_END : -TAIL_END) - CONTACT;
  const widest = (nose ? b.noseWidth : b.tailWidth) / 2;
  const t = (a - CONTACT) / tipLen;
  const grow = 0.3; // fraction of the tip spent widening to the widest point
  if (t < grow) return atContact + (widest - atContact) * Math.sin((t / grow) * Math.PI * 0.5);
  return widest * tipCurve((t - grow) / (1 - grow), 2.6);
}

/** Height of the base at `z`: camber between the contact points, rocker in the nose, a tail kick. */
export function rise(z: number): number {
  const b = BOARD;
  let y = 0;
  if (Math.abs(z) < CONTACT) y += b.camber * (1 - (z / CONTACT) ** 2);
  if (z > b.noseRiseFrom) y += b.noseRise * ((z - b.noseRiseFrom) / (NOSE_END - b.noseRiseFrom)) ** 2.2;
  if (z < -CONTACT) y += b.tailRise * ((-z - CONTACT) / (-TAIL_END - CONTACT)) ** 2;
  return y;
}

/** Canvas `v` (0 tail … 1 nose) to pixel row, with nose at the top the way CanvasTexture maps it. */
const rowAt = (v: number, h: number): number => (1 - v) * h;
const vAt = (z: number): number => (z - TAIL_END) / (NOSE_END - TAIL_END);

/** Topsheet: green with wandering contour lines and the two insert channels, after your reference. */
function topsheet(): THREE.CanvasTexture {
  const w = 256;
  const h = 1024;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  g.fillStyle = `#${BOARD.top.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, w, h);
  const rnd = lcg(7);
  g.strokeStyle = `#${BOARD.topLine.toString(16).padStart(6, '0')}`;
  g.lineWidth = 2;
  for (let k = 0; k < 16; k++) {
    const y0 = (k + 0.5) * (h / 16);
    const a1 = 8 + rnd() * 18;
    const a2 = 3 + rnd() * 8;
    const p1 = rnd() * 6;
    const p2 = rnd() * 6;
    g.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = y0 + a1 * Math.sin(x / 60 + p1) + a2 * Math.sin(x / 23 + p2);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // Insert channels, one under each binding.
  for (const z of [0.26, -0.26]) {
    const y = rowAt(vAt(z), h);
    g.fillStyle = '#8f9496';
    g.fillRect(w / 2 - 4, y - 70, 8, 140);
    g.fillStyle = '#111';
    g.fillRect(w / 2 - 7, z > 0 ? y + 62 : y - 76, 14, 14);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Base: mottled grey with a logo disc near the nose. */
function baseGraphic(): THREE.CanvasTexture {
  const w = 128;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  g.fillStyle = `#${BOARD.base.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, w, h);
  const rnd = lcg(11);
  for (let i = 0; i < 900; i++) {
    const shade = Math.floor(70 + rnd() * 120);
    g.fillStyle = `rgba(${shade},${shade},${shade + 6},0.35)`;
    g.beginPath();
    g.arc(rnd() * w, rnd() * h, 2 + rnd() * 7, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#0f6e5c';
  g.beginPath();
  g.arc(w / 2, rowAt(0.84, h), 22, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The deck: textured top and base, edge walls, each its own strip so the edge stays crisp. */
export function createDeck(): THREE.Group {
  const b = BOARD;
  const zAt = (i: number): number => TAIL_END + (i / STATIONS) * (NOSE_END - TAIL_END);
  const yBase = (z: number): number => b.bottom + rise(z);

  /** A two-edge strip along the board; `at(z, s)` places edge s (0 or 1). UV: s across, v along. */
  const strip = (at: (z: number, s: 0 | 1) => [number, number, number], flip: boolean): THREE.BufferGeometry => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= STATIONS; i++) {
      const z = zAt(i);
      for (const s of [0, 1] as const) {
        pos.push(...at(z, s));
        uv.push(s, i / STATIONS);
      }
    }
    for (let i = 0; i < STATIONS; i++) {
      const a = i * 2;
      if (flip) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    return geometry;
  };
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    return m;
  };

  const group = new THREE.Group();
  group.add(
    mesh(
      strip((z, s) => [s ? halfWidth(z) : -halfWidth(z), yBase(z) + b.thickness, z], true),
      toon(0xffffff, { map: topsheet() }),
    ),
    mesh(
      strip((z, s) => [s ? halfWidth(z) : -halfWidth(z), yBase(z), z], false),
      toon(0xffffff, { map: baseGraphic() }),
    ),
  );
  const wall = toon(b.side, { twoSided: true });
  group.add(
    mesh(strip((z, s) => [halfWidth(z), yBase(z) + (s ? b.thickness : 0), z], false), wall),
    mesh(strip((z, s) => [-halfWidth(z), yBase(z) + (s ? b.thickness : 0), z], true), wall),
  );
  return group;
}

function part(geometry: THREE.BufferGeometry, color: number, twoSided = false): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, toon(color, { twoSided }));
  mesh.castShadow = true;
  return mesh;
}

function blob(color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
  const mesh = part(new THREE.SphereGeometry(1, 16, 10), color);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  return mesh;
}

/**
 * The highback: a shell round the back of the calf about an axis at `cx`, its half-angle
 * of wrap tapering from the heel cup to the waist and flaring again at the top.
 */
function highbackShell(cx: number, r: number, y0: number, y1: number): THREE.Mesh {
  const cols = 14;
  const rows = 10;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const wrap = 1.45 - 0.55 * Math.sin(Math.min(v / 0.7, 1) * Math.PI * 0.5) + (v > 0.7 ? 0.25 * ((v - 0.7) / 0.3) : 0);
    // Top corners rounded off: the last row pulls in.
    const w = j === rows ? wrap * 0.8 : wrap;
    for (let i = 0; i <= cols; i++) {
      const a = -w + (2 * w * i) / cols; // 0 is straight behind (+X)
      pos.push(cx + r * Math.cos(a), y0 + (y1 - y0) * v, r * Math.sin(a));
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return part(g, BOARD.chassis, true);
}

/** A band arched over the foot: across it along board-local Z, `width` along the foot. */
function strapArc(ry: number, rz: number, width: number, color: number): THREE.Mesh {
  const mesh = part(new THREE.CylinderGeometry(1, 1, width, 18, 1, true, 0, Math.PI), color, true);
  mesh.rotation.z = Math.PI / 2; // axis along the foot, the half-arc over the top
  mesh.scale.set(ry, 1, rz);
  return mesh;
}

export type Binding = {
  group: THREE.Group;
  /** Boot shaft and highback, pivoting at the ankle to follow the shin. */
  shaft: THREE.Group;
};

/**
 * Boot in a binding, origin at the ankle point the rig bolts the leg to (0.09 m above the
 * board origin). Toe toward −X, the way the rider faces, turned by `angle` of duck.
 * `outside` is which way (±Z) the outer side of this foot faces — where the dials go.
 */
export function createBinding(angle: number, outside: 1 | -1): Binding {
  const b = BOARD;
  const g = new THREE.Group();
  const deckTop = b.bottom + b.thickness - 0.09; // relative to the ankle point

  // Chassis: base, footbed, two side walls rising to a heel cup.
  const base = part(new THREE.BoxGeometry(0.27, 0.012, 0.155), b.chassis);
  base.position.set(-0.01, deckTop + 0.006, 0);
  g.add(base);
  const footbed = part(new THREE.BoxGeometry(0.26, 0.006, 0.135), b.footbed);
  footbed.position.set(-0.015, deckTop + 0.015, 0);
  g.add(footbed);
  const wall = new THREE.Shape();
  wall.moveTo(0.06, 0);
  wall.lineTo(0.06, 0.085);
  wall.quadraticCurveTo(0.0, 0.08, -0.04, 0.04);
  wall.quadraticCurveTo(-0.09, 0.02, -0.135, 0.012);
  wall.lineTo(-0.135, 0);
  wall.closePath();
  const window = new THREE.Path();
  window.moveTo(0.035, 0.022);
  window.lineTo(0.035, 0.06);
  window.lineTo(-0.02, 0.028);
  window.closePath();
  wall.holes.push(window);
  const wallGeometry = new THREE.ExtrudeGeometry(wall, { depth: 0.01, bevelEnabled: false });
  for (const side of [1, -1]) {
    const w = part(wallGeometry, b.chassis);
    w.position.set(0, deckTop + 0.006, side > 0 ? 0.068 : -0.078);
    g.add(w);
  }
  const heelCup = part(new THREE.CylinderGeometry(0.076, 0.076, 0.08, 16, 1, true, 0, Math.PI), b.chassis, true);
  heelCup.position.set(0.06, deckTop + 0.046, 0);
  g.add(heelCup);

  // Boot lower: outsole, midsole, the foot. Fixed in the binding.
  const soleBottom = deckTop + 0.018;
  const outsole = part(new THREE.BoxGeometry(0.31, 0.014, 0.112), b.outsole);
  outsole.position.set(-0.025, soleBottom + 0.007, 0);
  g.add(outsole);
  const midsole = part(new THREE.BoxGeometry(0.3, 0.022, 0.108), b.midsole);
  midsole.position.set(-0.025, soleBottom + 0.025, 0);
  g.add(midsole);
  g.add(blob(b.boot, -0.085, soleBottom + 0.058, 0, 0.1, 0.045, 0.056)); // toe box
  g.add(blob(b.boot, 0.035, soleBottom + 0.07, 0, 0.085, 0.06, 0.058)); // heel and instep

  // Boot shaft and highback pivot at the ankle and follow the shin (rig.ts aims them).
  const shaft = new THREE.Group();
  const upper = part(new THREE.CylinderGeometry(0.066, 0.07, 0.19, 16), b.boot);
  upper.position.set(0.02, 0.07, 0);
  shaft.add(upper);
  const collar = part(new THREE.CylinderGeometry(0.068, 0.066, 0.035, 16), b.collar);
  collar.position.set(0.022, 0.18, 0);
  shaft.add(collar);
  for (const [y, x] of [[0.125, 0.0], [0.06, -0.035]] as const) {
    const dial = part(new THREE.CylinderGeometry(0.014, 0.016, 0.014, 12), b.collar);
    dial.rotation.x = Math.PI / 2;
    dial.position.set(x + 0.02, y, outside * 0.068);
    shaft.add(dial);
  }
  shaft.add(highbackShell(0.02, 0.082, -0.03, 0.2));
  g.add(shaft);

  // Straps: a wide ankle strap across the instep with its ratchet outside, a toe cap.
  const ankleTilt = new THREE.Group();
  ankleTilt.add(strapArc(0.078, 0.078, 0.065, b.strap));
  const ratchet = part(new THREE.BoxGeometry(0.05, 0.018, 0.012), b.ratchet);
  ratchet.position.set(0.035, 0, outside * 0.08);
  ankleTilt.add(ratchet);
  ankleTilt.position.set(-0.035, soleBottom + 0.05, 0);
  ankleTilt.rotation.z = 0.55; // lying on the instep, top forward
  g.add(ankleTilt);
  const toeTilt = new THREE.Group();
  toeTilt.add(strapArc(0.05, 0.064, 0.035, b.strap));
  toeTilt.position.set(-0.14, soleBottom + 0.03, 0);
  toeTilt.rotation.z = -0.9; // capped over the front of the toe
  g.add(toeTilt);

  g.rotation.y = angle;
  return { group: g, shaft };
}

const aim = new THREE.Vector3();
const shaftUp = new THREE.Vector3(0, 1, 0);
const inverse = new THREE.Quaternion();

/**
 * Point the boot shaft up the shin. `shin` is ankle→knee in the binding's parent (board)
 * frame; the shaft follows it up to `BOARD.maxFlex`, past which the boot stops bending.
 */
export function aimShaft(binding: Binding, shin: THREE.Vector3): void {
  inverse.copy(binding.group.quaternion).invert();
  aim.copy(shin).applyQuaternion(inverse).normalize();
  const tilt = Math.acos(Math.min(Math.max(aim.y, -1), 1));
  if (tilt > BOARD.maxFlex) {
    const h = Math.hypot(aim.x, aim.z);
    const k = h > 1e-6 ? Math.sin(BOARD.maxFlex) / h : 0;
    aim.set(aim.x * k, Math.cos(BOARD.maxFlex), aim.z * k);
  }
  binding.shaft.quaternion.setFromUnitVectors(shaftUp, aim);
}
