import * as THREE from 'three';

/**
 * Board and bindings, drawn only. Board local: +Z nose, +Y up, +X heel side; the rider
 * faces −X. The sim never sees any of this — edges and contact live in the sim's own
 * numbers — so shape is free to look right.
 */
export const BOARD = {
  length: 1.55, // m tip to tip — rig.ts BOARD_LENGTH
  waist: 0.25, // m wide at the middle
  tipWidth: 0.292, // m wide at the contact points: the sidecut is the difference
  contact: 0.6, // m from centre to where the edge meets the snow; past it the tip rounds off
  kickFrom: 0.56, // m from centre where the tips start to rise
  kick: 0.05, // m the tips rise at the very end
  bottom: 0.015, // m base above the board origin
  thickness: 0.013, // m
  top: 0x1b1f24,
  noseBand: 0xe2582f, // the nose reads at a glance, which is which end
  base: 0xe9e4d8, // light base, so a tweak's roll reads against the topsheet
  side: 0x111316,

  stanceFront: 0.26, // rad of duck on the front binding, toe toward the nose
  stanceBack: -0.26, // rad on the back, toe toward the tail
  boot: 0xb9ae98, // tan, from the reference
  sole: 0x2a2a2a,
  binding: 0x202326,
  strap: 0xe2582f,
};

const STATIONS = 96;
const HALF = BOARD.length / 2;

/** Half-width at `z`: parabolic sidecut to the contact points, a rounded tip beyond. */
function halfWidth(z: number): number {
  const b = BOARD;
  const a = Math.abs(z);
  if (a <= b.contact) return b.waist / 2 + (b.tipWidth / 2 - b.waist / 2) * (a / b.contact) ** 2;
  const t = Math.min((a - b.contact) / (HALF - b.contact), 1);
  return (b.tipWidth / 2) * Math.sqrt(Math.max(1 - t * t, 0));
}

/** Height of the base at `z`: flat between the feet, curling up at both ends. */
function rise(z: number): number {
  const b = BOARD;
  const a = Math.abs(z);
  if (a <= b.kickFrom) return 0;
  return b.kick * ((a - b.kickFrom) / (HALF - b.kickFrom)) ** 2;
}

/** The deck: top, base and edge wall as one strip each, so the edge stays crisp. */
export function createDeck(): THREE.Group {
  const b = BOARD;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const top = new THREE.Color(b.top);
  const band = new THREE.Color(b.noseBand);
  const base = new THREE.Color(b.base);
  const side = new THREE.Color(b.side);

  const zAt = (i: number): number => -HALF + (i / STATIONS) * b.length;
  // One strip of quads along the board between two edges (left/right) at heights yL/yR.
  const strip = (
    at: (i: number, side: 0 | 1) => [number, number, number],
    colour: (z: number) => THREE.Color,
    flip: boolean,
  ): void => {
    const start = pos.length / 3;
    for (let i = 0; i <= STATIONS; i++) {
      for (const s of [0, 1] as const) {
        const [x, y, z] = at(i, s);
        pos.push(x, y, z);
        const c = colour(z);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < STATIONS; i++) {
      const a = start + i * 2;
      if (flip) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };

  const yBase = (z: number): number => b.bottom + rise(z);
  const topColour = (z: number): THREE.Color => (z > HALF - 0.2 && z < HALF - 0.08 ? band : top);
  strip((i, s) => { const z = zAt(i); const w = halfWidth(z); return [s ? w : -w, yBase(z) + b.thickness, z]; }, topColour, false);
  strip((i, s) => { const z = zAt(i); const w = halfWidth(z); return [s ? w : -w, yBase(z), z]; }, () => base, true);
  // Edge walls, heel then toe side.
  strip((i, s) => { const z = zAt(i); const w = halfWidth(z); return [w, yBase(z) + (s ? b.thickness : 0), z]; }, () => side, false);
  strip((i, s) => { const z = zAt(i); const w = halfWidth(z); return [-w, yBase(z) + (s ? b.thickness : 0), z]; }, () => side, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

function part(geometry: THREE.BufferGeometry, color: number, roughness = 0.6): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness }));
  mesh.castShadow = true;
  return mesh;
}

/**
 * Boot in a binding, origin at the ankle point the rig bolts the leg to (0.09 m above the
 * board origin). Toe toward −X, the way the rider faces, turned by `angle` of duck.
 */
export function createBinding(angle: number): THREE.Group {
  const b = BOARD;
  const g = new THREE.Group();
  const deckTop = b.bottom + b.thickness - 0.09; // relative to the ankle point

  // Baseplate and heel cup.
  const plate = part(new THREE.BoxGeometry(0.25, 0.014, 0.13), b.binding);
  plate.position.set(0, deckTop + 0.007, 0);
  g.add(plate);

  // Boot: sole, a rounded toe box, the shaft up the shin.
  const sole = part(new THREE.BoxGeometry(0.31, 0.03, 0.115), b.sole, 0.8);
  sole.position.set(-0.02, deckTop + 0.029, 0);
  g.add(sole);
  const toe = part(new THREE.SphereGeometry(1, 16, 10), b.boot, 0.8);
  toe.scale.set(0.13, 0.055, 0.058);
  toe.position.set(-0.06, deckTop + 0.06, 0);
  g.add(toe);
  const shaft = part(new THREE.CylinderGeometry(0.062, 0.068, 0.2, 16), b.boot, 0.8);
  shaft.position.set(0.035, deckTop + 0.13, 0);
  shaft.rotation.z = 0.2; // forward lean
  g.add(shaft);

  // Highback: a half shell behind the calf, leaning forward with the boot.
  const highback = part(new THREE.CylinderGeometry(0.075, 0.08, 0.19, 16, 1, true, 0, Math.PI), b.binding);
  highback.material = new THREE.MeshStandardMaterial({ color: b.binding, roughness: 0.5, side: THREE.DoubleSide });
  highback.position.set(0.05, deckTop + 0.12, 0);
  highback.rotation.set(0, 0, 0.2);
  g.add(highback);

  // Straps: ankle over the instep, toe cap over the front of the toe box.
  // Arcs across the foot (board Z) and over it; tilted forward to lie on the instep.
  const ankle = part(new THREE.TorusGeometry(0.075, 0.02, 8, 16, Math.PI), b.strap, 0.5);
  ankle.rotation.order = 'YXZ';
  ankle.rotation.set(0, Math.PI / 2, 0);
  const ankleTilt = new THREE.Group();
  ankleTilt.add(ankle);
  ankleTilt.position.set(-0.035, deckTop + 0.045, 0);
  ankleTilt.rotation.z = 0.55;
  g.add(ankleTilt);
  const toeStrap = part(new THREE.TorusGeometry(0.062, 0.013, 8, 16, Math.PI), b.binding, 0.5);
  toeStrap.rotation.set(0, Math.PI / 2, 0);
  const toeTilt = new THREE.Group();
  toeTilt.add(toeStrap);
  toeTilt.position.set(-0.14, deckTop + 0.03, 0);
  toeTilt.rotation.z = -0.7; // capped over the front of the toe
  g.add(toeTilt);

  g.rotation.y = angle;
  return g;
}
