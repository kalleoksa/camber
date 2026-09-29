import * as THREE from 'three';

/**
 * The dressed rider, step 9a (docs/rider-look.md): a park silhouette from your references —
 * black beanie with the goggles pushed up on it, a boxy two-tone raglan shell (teal yoke,
 * sleeves and hood over a rust body) ending just below the hips, wide straight-leg olive
 * pants breaking softly over the boot, oversized mitts.
 *
 * Every piece is a rigid mesh parented to the rig's existing segment, so it moves with the
 * solve and needs no bones of its own. Limbs are lathe tubes with domed ends centred on the
 * joints: the thigh's dome and the shin's dome are the same sphere at the knee, so a bend
 * reads as a bent tube instead of a gap. Render only — nothing here reaches the sim.
 *
 * Fit numbers are here rather than in params because they don't change feel and aren't
 * part of a take. Edit and let Vite reload.
 */
export const OUTFIT = {
  jacket: 0xa9521f, // rust body
  yoke: 0x14545e, // teal shoulders, sleeves, hood
  pants: 0x5b6a3a, // olive — ref: wide straight-leg shell pant
  beanie: 0x16181b, // black
  mitt: 0x1b1f24,
  strap: 0x1b1f24,
  lens: 0xc9d6de, // mirror
  face: 0xf0d9b5,

  thighTop: 0.115, // m radius at the hip
  knee: 0.108, // m radius through the knee — wide, the pant doesn't taper here
  stackBase: 0.106, // m radius of the leg above the boot — straight, no taper
  stackAmp: 0.009, // m the bunches stand out — a soft break, not a heavy stack
  stacks: 2, // bunches between stackFrom and the hem
  stackFrom: 0.7, // fraction down the shin where the stack starts
  hem: 0.125, // m radius of the hem, covering most of the boot

  jacketHem: 0.14, // m below the hips — just past them
  jacketWaist: 0.185, // m radius — boxy, barely taken in
  jacketChest: 0.195, // m radius
  yokeFrom: 0.72, // fraction up the spine where the teal yoke starts
  jacketDepth: 0.8, // front-to-back squash of the jacket's round section
  jacketWidth: 1.05, // shoulder-to-shoulder stretch
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
function tube(profile: Profile, len: number, color: number): THREE.Mesh {
  const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y));
  const geometry = new THREE.LatheGeometry(points, 16);
  geometry.scale(1, 1 / len, 1);
  return new THREE.Mesh(geometry, cloth(color));
}

function cloth(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
}

function blob(color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), cloth(color));
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  return mesh;
}

function thigh(len: number): THREE.Mesh {
  const o = OUTFIT;
  const p: Profile = [];
  dome(p, o.thighTop, 0, -1);
  p.push([o.thighTop * 0.97, len * 0.35], [o.knee * 1.02, len * 0.75]);
  dome(p, o.knee, len, 1);
  return tube(p, len, o.pants);
}

function shin(len: number): THREE.Mesh {
  const o = OUTFIT;
  const p: Profile = [];
  dome(p, o.knee, 0, -1);
  p.push([o.knee * 0.95, len * 0.35]);
  // The stack: bunches that get fuller toward the boot, then a flare over it.
  const from = len * o.stackFrom;
  const to = len - 0.03;
  const rings = o.stacks * 4;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const bunch = 0.5 - 0.5 * Math.cos(t * o.stacks * Math.PI * 2);
    p.push([o.stackBase + o.stackAmp * bunch * (0.6 + 0.4 * t), from + (to - from) * t]);
  }
  p.push([o.hem, len + 0.045], [o.hem * 0.85, len + 0.06], [0, len + 0.06]);
  return tube(p, len, o.pants);
}

function upperArm(len: number): THREE.Mesh {
  const o = OUTFIT;
  const p: Profile = [];
  dome(p, o.sleeveTop, 0, -1);
  p.push([o.sleeveTop * 0.95, len * 0.4]);
  dome(p, o.elbow, len, 1);
  return tube(p, len, o.yoke);
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
  return tube(p, len, o.yoke);
}

/** Rust body: boxy, hem drawn in a little by its cinch, open at the top under the yoke. */
function jacket(spine: number): THREE.Mesh {
  const o = OUTFIT;
  const p: Profile = [
    [0, -o.jacketHem],
    [o.jacketWaist * 0.98, -o.jacketHem],
    [o.jacketWaist * 1.06, -o.jacketHem * 0.6],
    [o.jacketWaist * 1.03, 0.02],
    [o.jacketChest, spine * 0.45],
    [o.jacketChest, spine * (o.yokeFrom + 0.04)],
    [0, spine * (o.yokeFrom + 0.04)],
  ];
  const mesh = tube(p, 1, o.jacket);
  mesh.scale.set(o.jacketDepth, 1, o.jacketWidth);
  return mesh;
}

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
  const mesh = tube(p, 1, o.yoke);
  mesh.scale.set(o.jacketDepth, 1, o.jacketWidth);
  return mesh;
}

/** The rig's segments, as rig.ts builds them. Limb meshes are unit-tall along +Y. */
export type Segments = {
  pelvis: THREE.Mesh;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  thighs: THREE.Mesh[];
  shins: THREE.Mesh[];
  upperArms: THREE.Mesh[];
  forearms: THREE.Mesh[];
  mitts: THREE.Mesh[];
};

export type Outfit = { pieces: THREE.Object3D[] };

/** Hang the outfit on the rig's segments. Rest lengths come from the rig params at load. */
export function dress(seg: Segments, lengths: { thigh: number; shin: number; upperArm: number; forearm: number; spine: number }): Outfit {
  const o = OUTFIT;
  const pieces: THREE.Object3D[] = [];
  const hang = (parent: THREE.Object3D, piece: THREE.Object3D): void => {
    parent.add(piece);
    pieces.push(piece);
  };

  for (const m of seg.thighs) hang(m, thigh(lengths.thigh));
  for (const m of seg.shins) hang(m, shin(lengths.shin));
  for (const m of seg.upperArms) hang(m, upperArm(lengths.upperArm));
  for (const m of seg.forearms) hang(m, forearm(lengths.forearm));
  for (const m of seg.mitts) hang(m, blob(o.mitt, 0, 0, 0, 0.06, 0.066, 0.055));

  // Seat of the pants, and the jacket with a big hood bunched behind the neck (+X is the
  // heel side, behind the rider, who faces −X).
  hang(seg.pelvis, blob(o.pants, 0, 0, 0, 0.15, 0.13, 0.21));
  hang(seg.torso, jacket(lengths.spine));
  hang(seg.torso, yoke(lengths.spine));
  hang(seg.torso, blob(o.yoke, 0.11, lengths.spine * 1.0, 0, 0.09, 0.1, 0.14));

  // Head: face, black beanie with a folded band, goggles pushed up onto the beanie.
  hang(seg.head, blob(o.face, 0, 0, 0, 0.095, 0.11, 0.095));
  const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.106, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), cloth(o.beanie));
  beanie.position.set(0.008, 0.02, 0);
  beanie.scale.set(1, 1.2, 1);
  hang(seg.head, beanie);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.109, 0.109, 0.05, 16), cloth(o.beanie));
  band.position.set(0.006, 0.035, 0);
  hang(seg.head, band);
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.112, 0.03, 16, 1, true), cloth(o.strap));
  strap.position.set(0.006, 0.075, 0);
  strap.rotation.z = -0.25; // tilted back with the goggles up
  hang(seg.head, strap);
  const lens = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.06, 0.17),
    new THREE.MeshStandardMaterial({ color: o.lens, roughness: 0.15, metalness: 0.6 }),
  );
  lens.position.set(-0.098, 0.065, 0);
  lens.rotation.z = -0.35;
  hang(seg.head, lens);

  for (const piece of pieces) piece.castShadow = true;
  return { pieces };
}
