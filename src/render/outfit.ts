import * as THREE from 'three';
import { camo, toon } from './toon.ts';

/**
 * The dressed rider, step 9a (docs/rider-look.md): a park silhouette from your references —
 * an olive ribbed fisherman beanie with the goggles pushed up on it, a boxy black raglan
 * shell ending just below the hips, wide straight-leg olive pants breaking softly over the
 * boot, oversized mitts.
 *
 * Every piece is a rigid mesh parented to the rig's existing segment, so it moves with the
 * solve, except the pant legs: one tube each from hip to boot, skinned to two bones posed
 * from the thigh and shin, so the knee bends like cloth (`pantLeg`). Arms are lathe tubes
 * with domed ends centred on the joints, the two domes the same sphere at the elbow. Render
 * only — nothing here reaches the sim.
 *
 * Fit numbers are here rather than in params because they don't change feel and aren't
 * part of a take. Edit and let Vite reload.
 */
export const OUTFIT = {
  jacket: 0x26282c, // black body — a charcoal black, so the toon bands still read against the outline
  yoke: 0x26282c, // shoulders, sleeves, hood: the same black
  pants: 0x5a6236, // olive drab ground of the camo — ref: wide straight-leg shell pant
  camo: [0x9a8a62, 0x6e8a3a, 0x434a2a], // khaki, light green, dark: the patches over it
  camoRepeat: [1.5, 2.4], // tiles round a leg, and per metre along it: patches about hand-sized
  beanie: 0x5f7431, // olive, ribbed — ref: shallow fisherman beanie with a deep cuff
  beanieRibs: 56, // ribs round the head
  patch: 0x121314, // the woven label on the cuff, plain
  // Mitts, from your reference: rust shell, black leather palm, long gauntlet over the sleeve.
  mitt: 0xb95b24,
  palm: 0x17181b,
  // Goggles, from your reference: white frame and strap with black edges, dark lens.
  goggleFrame: 0xf2f2f2,
  lens: 0x3b3d44,
  strap: 0xf0f0f0,
  strapEdge: 0x16171a,
  goggleWidth: 0.19, // m across the lens, round the head
  goggleHeight: 0.075, // m, a big cylindrical lens
  face: 0xf0d9b5,

  // Pants: baggy, but tucked in at the hip so the thigh tops stay under the jacket.
  thighTop: 0.085, // m radius at the hip joint — tucked, under the skirt and the seat
  thighFull: 0.128, // m radius the thigh opens out to a third of the way down
  knee: 0.124, // m radius through the knee — the thigh's and shin's domes meet here
  stackBase: 0.122, // m radius of the leg above the boot — straight, no taper
  stackAmp: 0.009, // m the bunches stand out — a soft break, not a heavy stack
  stacks: 2, // bunches between stackFrom and the hem
  stackFrom: 0.7, // fraction down the shin where the stack starts
  hem: 0.132, // m radius of the hem over the boot
  hemEnd: 0.03, // m above the ankle point the hem ends — at the boot, clear of the deck
  cuffTop: 0.22, // m up the boot shaft the pant cuff reaches, overlapping the shin tube
  shinEnd: 0.16, // m above the ankle the shin tube stops and domes into the cuff
  seat: [0.17, 0.15, 0.25], // m half-extents of the seat and crotch piece, over both hip joints

  jacketHem: 0.14, // m below the hips — just past them
  jacketWaist: 0.2, // m radius — boxy, barely taken in
  jacketChest: 0.21, // m radius
  skirtHem: 0.235, // m radius the skirt flares out to at the hem, clear of hips and thighs
  yokeFrom: 0.72, // fraction up the spine where the teal yoke starts
  jacketDepth: 0.84, // front-to-back squash of the jacket's round section
  jacketWidth: 1.07, // shoulder-to-shoulder stretch
  sleeveTop: 0.075, // m radius at the shoulder
  elbow: 0.066, // m radius
  cuff: 0.08, // m radius, stacked at the mitt
};

type Profile = [number, number][]; // [radius, y] in metres along the segment

/** A dome of radius `r` centred at height `y`, facing up (+1) or down (−1). */
function dome(out: Profile, r: number, y: number, facing: 1 | -1): void {
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const a = ((facing === -1 ? steps - i : i) / steps) * (Math.PI / 2); // pole-to-equator below, equator-to-pole above
    out.push([r * Math.cos(a), y + facing * r * Math.sin(a)]);
  }
}

/**
 * A segment's tube, built in metres for rest length `len` and then squashed to unit height,
 * because the rig draws a segment as a unit-tall mesh scaled by its length (rig.ts
 * placeBone). The domes come out round at that length; limb lengths only change when the
 * rig params are tuned.
 */
function tube(profile: Profile, len: number, material: THREE.Material): THREE.Mesh {
  const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y));
  const geometry = new THREE.LatheGeometry(points, 16);
  // Lathe UVs run by point count, so a stretch with few points smears a pattern along it.
  // V in metres up the segment instead: camo patches keep their size everywhere.
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i));
  uv.needsUpdate = true;
  geometry.scale(1, 1 / len, 1);
  return new THREE.Mesh(geometry, material);
}

/** Shared cloth materials: shells flutter (9c), the rest don't. Built once, on first dress. */
const cloth = (() => {
  let made: Record<'pants' | 'jacket' | 'yoke' | 'beanie' | 'patch' | 'mitt' | 'palm' | 'strap' | 'strapEdge' | 'frame' | 'lens' | 'face', THREE.Material> | null = null;
  return () => {
    if (made) return made;
    const o = OUTFIT;
    const pattern = camo({ ground: o.pants, blobs: o.camo });
    pattern.repeat.set(o.camoRepeat[0] ?? 1, o.camoRepeat[1] ?? 1);
    made = {
      pants: toon(0xffffff, { map: pattern, flutter: true }),
      jacket: toon(o.jacket, { flutter: true }),
      yoke: toon(o.yoke, { flutter: true }),
      beanie: toon(0xffffff, { map: ribs(o.beanie, o.beanieRibs) }),
      patch: toon(o.patch),
      mitt: toon(o.mitt),
      palm: toon(o.palm),
      strap: toon(o.strap, { twoSided: true }),
      strapEdge: toon(o.strapEdge, { twoSided: true }),
      frame: toon(o.goggleFrame, { twoSided: true }),
      lens: toon(o.lens, { twoSided: true }),
      face: toon(o.face),
    };
    return made;
  };
})();

function blob(material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  return mesh;
}

/**
 * A pant leg from the hip to just above the boot, one tube skinned to two bones so it bends
 * at the knee like cloth instead of two tubes meeting in a ball. Built along +Y in metres:
 * hip at 0, knee at `thighLen`. The bones are posed from the rig's thigh and shin segments
 * each frame (`Outfit.poseLegs`); the band either side of the knee blends between them.
 */
function pantLeg(thighLen: number, shinLen: number): { mesh: THREE.SkinnedMesh; thigh: THREE.Bone; shin: THREE.Bone } {
  const o = OUTFIT;
  const k = thighLen;
  const p: Profile = [];
  dome(p, o.thighTop, 0, -1);
  p.push([o.thighTop * 1.1, k * 0.12], [o.thighFull, k * 0.35], [o.knee * 1.02, k * 0.75]);
  // Close rings through the knee so the bend has vertices to fold on; a little fuller there,
  // because a blended joint loses volume on the outside of the bend.
  for (const [dy, f] of [[-0.09, 1.02], [-0.06, 1.03], [-0.03, 1.05], [0, 1.06], [0.03, 1.05], [0.06, 1.02], [0.09, 1]] as const) {
    p.push([o.knee * f, k + dy]);
  }
  p.push([o.knee * 0.97, k + shinLen * 0.35]);
  dome(p, o.stackBase, k + shinLen - o.shinEnd, 1);

  const points = p.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y));
  const geometry = new THREE.LatheGeometry(points, 16);
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const index = new Uint16Array(pos.count * 4);
  const weight = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    uv.setY(i, y); // metres, as `tube` does, so the camo keeps its size
    const t = Math.min(1, Math.max(0, (y - (k - KNEE_BLEND)) / (2 * KNEE_BLEND)));
    const w = t * t * (3 - 2 * t);
    index[i * 4 + 1] = 1;
    weight[i * 4] = 1 - w;
    weight[i * 4 + 1] = w;
  }
  uv.needsUpdate = true;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));

  // Bound at rest — straight leg, both bones unrotated — in a frame of their own. They are
  // posed in the rig root's space later, and the mesh's own transform cancels out (attached
  // bind mode), so where this frame sits doesn't matter.
  const thigh = new THREE.Bone();
  const shin = new THREE.Bone();
  shin.position.set(0, k, 0);
  const mesh = new THREE.SkinnedMesh(geometry, cloth().pants);
  const rest = new THREE.Group();
  rest.add(thigh, shin, mesh);
  rest.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([thigh, shin]));
  mesh.frustumCulled = false; // its bounds are the rest pose's, not where the leg is
  return { mesh, thigh, shin };
}

const legUp = new THREE.Vector3();
const legDown = new THREE.Vector3();
const legBend = new THREE.Quaternion();

/** m either side of the knee the leg blends from the thigh's bone to the shin's. */
const KNEE_BLEND = 0.07;

/**
 * The bottom of the leg: the stack and the hem, hung on the boot shaft rather than the
 * shin. Baggy pants bunch on the boot; they don't follow a steeply bent shin down through
 * the deck, and the boot's lean is capped (board.ts maxFlex), so neither does this. Built
 * in the shaft's frame: origin at the ankle, up the shin.
 */
function pantCuff(): THREE.Mesh {
  const o = OUTFIT;
  const p: Profile = [[0, o.hemEnd + 0.012], [o.hem * 0.85, o.hemEnd + 0.012], [o.hem, o.hemEnd]];
  const from = o.hemEnd + 0.03;
  const to = o.cuffTop - 0.02;
  const rings = o.stacks * 4;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const bunch = 0.5 - 0.5 * Math.cos(t * o.stacks * Math.PI * 2);
    p.push([o.stackBase + o.stackAmp * bunch * (1 - 0.4 * t), from + (to - from) * t]);
  }
  p.push([o.stackBase * 0.96, o.cuffTop], [0, o.cuffTop]);
  return tube(p, 1, cloth().pants);
}

function upperArm(len: number): THREE.Mesh {
  const o = OUTFIT;
  const p: Profile = [];
  dome(p, o.sleeveTop, 0, -1);
  p.push([o.sleeveTop * 0.95, len * 0.4]);
  dome(p, o.elbow, len, 1);
  return tube(p, len, cloth().yoke);
}

function forearm(len: number): THREE.Mesh {
  const o = OUTFIT;
  const p: Profile = [];
  dome(p, o.elbow, 0, -1);
  p.push([o.elbow * 0.97, len * 0.4]);
  // Sleeve bunched at the wrist, ending under the mitt.
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    p.push([o.elbow + (o.cuff - o.elbow) * t + 0.006 * Math.sin(t * Math.PI * 4), len * (0.55 + 0.27 * t)]);
  }
  p.push([o.cuff * 0.6, len * 0.84], [0, len * 0.84]);
  return tube(p, len, cloth().yoke);
}

/**
 * Mitt in the hand frame rig.ts sets: +y along the forearm to the fingertips, palm toward −z,
 * origin at the hand point. `thumb` is the side the thumb sits on: +x left hand, −x right.
 */
function mitten(thumb: 1 | -1): THREE.Group {
  const c = cloth();
  const g = new THREE.Group();
  // Chunky shell, and the leather palm proud of it on the palm side.
  g.add(blob(c.mitt, 0, 0.032, 0.004, 0.056, 0.076, 0.04));
  g.add(blob(c.palm, 0, 0.028, -0.012, 0.052, 0.07, 0.033));
  const t = blob(c.mitt, thumb * 0.05, 0.006, -0.016, 0.021, 0.04, 0.021);
  t.rotation.z = -thumb * 0.45;
  g.add(t);
  // Gauntlet, flaring back over the sleeve end: wider than the bunched sleeve cuff (OUTFIT.cuff).
  const p: Profile = [[0.088, -0.145], [0.095, -0.14], [0.093, -0.1], [0.089, -0.06], [0.076, -0.03], [0.06, -0.008], [0, -0.008]];
  g.add(tube(p, 1, c.mitt));
  // Wrist strap cinching the gauntlet.
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.093, 0.096, 0.02, 20, 1, true), c.palm);
  strap.position.y = -0.055;
  g.add(strap);
  return g;
}

/** Fraction up the spine of the mid-back joint the upper back curls on (rig.ts `spineCurl`). */
export const SPINE_CURL_AT = 0.45;

/**
 * Rust body from the waist up, open at the top under the yoke, in two pieces either side of
 * the mid-back joint. Each closes over the joint with a ball centred on it, so when the upper
 * back curls the rounding shows as a hump of jacket rather than a gap — the knee's trick.
 */
function jacketLower(spine: number): THREE.Mesh {
  const o = OUTFIT;
  const mid = spine * SPINE_CURL_AT;
  // Down to −0.08, inside the skirt, so a bend at the waist never opens a gap between them.
  const p: Profile = [
    [0, -0.08],
    [o.jacketWaist, -0.08],
    [o.jacketWaist * 1.03, 0.02],
    [o.jacketChest, mid],
  ];
  dome(p, o.jacketChest * 0.98, mid, 1);
  const mesh = tube(p, 1, cloth().jacket);
  mesh.scale.set(o.jacketDepth, 1, o.jacketWidth);
  return mesh;
}

/** The upper piece, in the same spine coordinates as the lower — its parent offsets it. */
function jacketUpper(spine: number): THREE.Mesh {
  const o = OUTFIT;
  const mid = spine * SPINE_CURL_AT;
  const p: Profile = [];
  dome(p, o.jacketChest * 0.98, mid, -1);
  p.push([o.jacketChest, mid + 0.01], [o.jacketChest, spine * (o.yokeFrom + 0.04)], [0, spine * (o.yokeFrom + 0.04)]);
  const mesh = tube(p, 1, cloth().jacket);
  mesh.scale.set(o.jacketDepth, 1, o.jacketWidth);
  return mesh;
}

/**
 * The skirt: waist to hem, hung from a pivot on the pelvis — where the legs attach — so
 * the hip joints stay inside it whatever the spine does, and the cloth springs (9c) swing
 * it. A-line out to `skirtHem`, wide enough to clear the hips and the tops of the thighs;
 * its top rides up inside the jacket body.
 */
export function skirtProfile(): Profile {
  const o = OUTFIT;
  return [
    [0, -o.jacketHem - SKIRT_PIVOT],
    [o.skirtHem, -o.jacketHem - SKIRT_PIVOT],
    [o.skirtHem * 0.99, -o.jacketHem * 0.55 - SKIRT_PIVOT],
    [o.jacketWaist * 1.02, 0.03 - SKIRT_PIVOT],
    [o.jacketWaist * 0.97, 0.12 - SKIRT_PIVOT],
    [o.jacketWaist * 0.85, 0.12 - SKIRT_PIVOT],
  ];
}

function skirt(): THREE.Mesh {
  const o = OUTFIT;
  const mesh = tube(skirtProfile(), 1, cloth().jacket);
  mesh.scale.set(o.jacketDepth, 1, o.jacketWidth);
  return mesh;
}
const SKIRT_PIVOT = 0.02; // m up the spine from the hips: the waist the skirt hangs from

/** Teal yoke over the shoulders into the collar, the raglan line the reference reads by. */
function yoke(spine: number): THREE.Mesh {
  const o = OUTFIT;
  const p: Profile = [
    [0, spine * o.yokeFrom],
    [o.jacketChest * 1.015, spine * o.yokeFrom],
    [o.jacketChest * 0.98, spine * 0.88],
    [o.jacketChest * 0.6, spine * 1.02],
    [0.085, spine * 1.07], // high collar
    [0.075, spine * 1.13],
    [0, spine * 1.13],
  ];
  const mesh = tube(p, 1, cloth().yoke);
  mesh.scale.set(o.jacketDepth, 1, o.jacketWidth);
  return mesh;
}

/**
 * Goggles pushed up on the beanie: a wide strap with dark edges right round the head, and a
 * cylindrical lens in a white frame wrapped round the front (−X). Built round the head's
 * axis, then tipped back as one piece.
 */
/** Rib knit: soft light-dark bands, one per rib, tiled round a beanie. */
function ribs(color: number, count: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 4;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  const base = new THREE.Color(color);
  for (let x = 0; x < 16; x++) {
    const k = 0.78 + 0.22 * Math.sin((x / 16) * Math.PI); // raised in the middle of each rib
    g.fillStyle = `#${base.clone().multiplyScalar(k).getHexString()}`;
    g.fillRect(x, 0, 1, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(count, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function goggles(): THREE.Group {
  const o = OUTFIT;
  const c = cloth();
  const g = new THREE.Group();
  const R = 0.118; // m, strap radius round the beanie — clear of the cuff where it tips down at the back
  const ring = (r: number, h: number, y: number, m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24, 1, true), m);
    mesh.position.y = y;
    return mesh;
  };
  g.add(ring(R, 0.04, 0, c.strap), ring(R + 0.001, 0.004, 0.019, c.strapEdge), ring(R + 0.001, 0.004, -0.019, c.strapEdge));
  // Arcs centred on −X: Cylinder theta puts x = r·sin θ, so the front is θ = −π/2.
  const arc = (r: number, w: number, h: number, m: THREE.Material): THREE.Mesh => {
    const half = w / (2 * r);
    return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20, 1, true, -Math.PI / 2 - half, 2 * half), m);
  };
  g.add(arc(R + 0.012, o.goggleWidth + 0.012, o.goggleHeight + 0.014, c.frame));
  g.add(arc(R + 0.016, o.goggleWidth, o.goggleHeight, c.lens));
  g.position.set(0.006, 0.098, 0);
  g.rotation.z = -0.3; // front up: pushed up onto the forehead
  return g;
}

/** The rig's segments, as rig.ts builds them. Limb meshes are unit-tall along +Y. */
export type Segments = {
  pelvis: THREE.Mesh;
  torso: THREE.Mesh; // hips to the mid-back joint
  chest: THREE.Mesh; // mid-back joint to the shoulders, origin on the joint
  head: THREE.Mesh;
  thighs: THREE.Mesh[];
  shins: THREE.Mesh[];
  upperArms: THREE.Mesh[];
  forearms: THREE.Mesh[];
  mitts: THREE.Mesh[];
  /** Boot shafts (board.ts), one per shin in the same order: the pant cuffs hang on these. */
  bootShafts: THREE.Object3D[];
};

/** `skirt` and `hood` are the pivots the cloth springs turn (scene.ts, from Secondary). */
export type Outfit = {
  pieces: THREE.Object3D[];
  skirt: THREE.Object3D;
  hood: THREE.Object3D;
  /** For the clip check (scripts/clip-check.ts): the skirt mesh and the pant legs and cuffs. */
  fit: { skirt: THREE.Mesh; thighs: THREE.Mesh[]; shins: THREE.Mesh[] };
  /** Pose the pant legs' bones from the thigh and shin segments. After the rig places them. */
  poseLegs(): void;
};

/** Hang the outfit on the rig's segments. Rest lengths come from the rig params at load. */
export function dress(seg: Segments, lengths: { thigh: number; shin: number; upperArm: number; forearm: number; spine: number }): Outfit {
  const pieces: THREE.Object3D[] = [];
  const hang = (parent: THREE.Object3D, piece: THREE.Object3D): void => {
    parent.add(piece);
    pieces.push(piece);
  };

  // The legs hang beside the segments, in the rig root, rather than on them: their bones are
  // posed from the segments' transforms, minus the length scale the segments carry.
  const legs = seg.thighs.map((m) => {
    const leg = pantLeg(lengths.thigh, lengths.shin);
    m.parent?.add(leg.thigh, leg.shin);
    hang(m.parent ?? m, leg.mesh);
    return leg;
  });
  const thighs: THREE.Mesh[] = legs.map((l) => l.mesh);
  const shins: THREE.Mesh[] = [];
  const poseLegs = (): void => {
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const t = seg.thighs[i];
      const s = seg.shins[i];
      if (!leg || !t || !s) continue;
      leg.thigh.position.copy(t.position);
      leg.thigh.quaternion.copy(t.quaternion);
      leg.shin.position.copy(s.position);
      // The thigh's frame bent at the knee, not the shin segment's own: each segment is aimed
      // by the shortest turn from up, so the two can differ by a twist about the leg, and a
      // twist blended across the knee wrings the tube thin.
      legUp.set(0, 1, 0).applyQuaternion(t.quaternion);
      legDown.set(0, 1, 0).applyQuaternion(s.quaternion);
      legBend.setFromUnitVectors(legUp, legDown);
      leg.shin.quaternion.copy(legBend).multiply(t.quaternion);
    }
  };
  for (const shaft of seg.bootShafts) {
    const c = pantCuff();
    hang(shaft, c);
    shins.push(c);
  }
  for (const m of seg.upperArms) hang(m, upperArm(lengths.upperArm));
  for (const m of seg.forearms) hang(m, forearm(lengths.forearm));
  const c = cloth();
  seg.mitts.forEach((m, i) => hang(m, mitten(i === 0 ? 1 : -1)));

  // Seat of the pants; the jacket body, its skirt on a pivot at the waist, and the hood on a
  // pivot at the back of the neck (+X is the heel side, behind the rider, who faces −X).
  // Seat and crotch in one piece, over both hip joints and down between the legs.
  const [sx, sy, sz] = OUTFIT.seat;
  hang(seg.pelvis, blob(c.pants, 0, -0.03, 0, sx ?? 0.17, sy ?? 0.15, sz ?? 0.25));
  hang(seg.torso, jacketLower(lengths.spine));
  // Upper back pieces keep their hips-up coordinates: a group on the chest sets them back
  // down by the joint's height, so with no curl everything sits exactly where it did.
  const upper = new THREE.Group();
  upper.position.y = -lengths.spine * SPINE_CURL_AT;
  seg.chest.add(upper);
  hang(upper, jacketUpper(lengths.spine));
  hang(upper, yoke(lengths.spine));
  const skirtPivot = new THREE.Group();
  skirtPivot.position.y = SKIRT_PIVOT;
  const skirtMesh = skirt();
  skirtPivot.add(skirtMesh);
  hang(seg.pelvis, skirtPivot);
  const hoodPivot = new THREE.Group();
  hoodPivot.position.set(0.07, lengths.spine * 1.02, 0);
  hoodPivot.add(blob(c.yoke, 0.04, -0.02, 0, 0.09, 0.1, 0.14));
  hang(upper, hoodPivot);

  // Head: face, a shallow fisherman beanie sitting above the ears with a deep cuff and its
  // label, goggles pushed up onto the crown.
  hang(seg.head, blob(c.face, 0, 0, 0, 0.095, 0.11, 0.095));
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.106, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), c.beanie);
  crown.position.set(0.006, 0.07, 0);
  crown.scale.set(1, 0.8, 1);
  hang(seg.head, crown);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.109, 0.113, 0.056, 20), c.beanie);
  cuff.position.set(0.006, 0.048, 0);
  hang(seg.head, cuff);
  // Label on the cuff, off to the side of the front as worn.
  const patch = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.028, 0.026), c.patch);
  patch.position.set(0.006 - 0.113 * Math.cos(0.5), 0.046, 0.113 * Math.sin(0.5));
  patch.rotation.y = 0.5;
  hang(seg.head, patch);
  hang(seg.head, goggles());

  for (const piece of pieces) piece.traverse((o) => (o.castShadow = true));
  return { pieces, skirt: skirtPivot, hood: hoodPivot, fit: { skirt: skirtMesh, thighs, shins }, poseLegs };
}
