import * as THREE from 'three';
import type { Params } from '../sim/params.ts';

/**
 * The rider, inverted from a normal character rig (design §7.1): the feet are bolted to
 * the bindings and are the constraint, the hips are the only thing that moves, and knee
 * bend emerges from two-bone IK rather than being authored.
 *
 * Board local: +Z nose, +Y board up, +X heel side (§1). The rider faces the toe side, −X.
 */

/** The whole rider, in about twenty numbers (§7.2). Everything else is a consequence. */
export type RigDrivers = {
  hipX: number; // m, board-local. + is toward the heel edge
  hipY: number; // m, along the board normal. − is crouch
  hipZ: number; // m, + is toward the nose
  hipYaw: number; // rad, about board up — counter-rotation
  hipPitch: number; // rad, about the board's nose axis
  hipRoll: number; // rad
  spineBend: number; // rad, + folds the chest toward the toe edge
  spineSide: number; // rad, + leans toward the nose
  spineTwist: number; // rad, shoulders against hips
  frontHandEdge: number; // −1 heel .. +1 toe, matching state.edge's sign
  frontHandT: number; // 0 tail .. 1 nose
  backHandEdge: number;
  backHandT: number;
  frontGrip: number; // 0 = arm at rest, 1 = hand locked to the board
  backGrip: number;
  tweak: number; // 0..1, how hard the legs shove the board away from the grab
  headYaw: number; // rad
  headPitch: number; // rad
  kneeSplay: number; // rad, pole vector out from forward — a stance splays, it doesn't squat
  stanceScale: number; // multiplier on binding separation
  /**
   * m the board rises toward the rider along its own normal — the leg tuck. In the air
   * the board comes up to the hands; the rider does not fold down to the board. Without
   * this a grab is only reachable by bending the torso double, which is not what a grab
   * looks like. Zero on snow, where the board is on the ground and the hips do the work.
   */
  boardLift: number;
};

export function neutralDrivers(): RigDrivers {
  return {
    hipX: 0,
    hipY: 0,
    hipZ: 0,
    hipYaw: 0,
    hipPitch: 0,
    hipRoll: 0,
    spineBend: 0.18,
    spineSide: 0,
    spineTwist: 0,
    frontHandEdge: 0,
    frontHandT: 0.62,
    backHandEdge: 0,
    backHandT: 0.34,
    frontGrip: 0,
    backGrip: 0,
    tweak: 0,
    headYaw: 0,
    headPitch: 0,
    kneeSplay: 0.5,
    stanceScale: 1,
    boardLift: 0,
  };
}

export function copyDrivers(dst: RigDrivers, src: RigDrivers): void {
  for (const key of Object.keys(dst) as (keyof RigDrivers)[]) dst[key] = src[key];
}

/** Max board rotation about the grab point at full tweak. Anatomy clamps it below this. */
const TWEAK_MAX = 1.15; // rad
const BOARD_LENGTH = 1.55;
const BOARD_HALF = BOARD_LENGTH / 2;
const EDGE_X = 0.145; // m, just outside the deck so the hand wraps the edge

/**
 * A grab is a coordinate on the board, not one of eight buttons (§7.3). `edge` picks
 * which rail continuously, `t` runs tail (0) to nose (1).
 */
export function edgePoint(out: THREE.Vector3, edge: number, t: number): THREE.Vector3 {
  // state.edge is + for toe, and the toe side is board-local −X.
  out.set(-edge * EDGE_X, 0.035, (t * 2 - 1) * (BOARD_HALF - 0.06));
  return out;
}

/** Which hand can reach: split at the midpoint between the bindings (§7.3). */
export function handForT(t: number): 'front' | 'back' {
  return t >= 0.5 ? 'front' : 'back';
}

function bone(color: number, thickness: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(thickness, 1, thickness),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
  );
  mesh.geometry.translate(0, 0.5, 0); // pivot at the joint end
  return mesh;
}

const up = new THREE.Vector3(0, 1, 0);
const dir = new THREE.Vector3();
const quat = new THREE.Quaternion();

/** Stretch and aim a bone mesh from one joint to another. */
function placeBone(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  dir.subVectors(to, from);
  const len = dir.length();
  mesh.position.copy(from);
  if (len > 1e-5) {
    dir.multiplyScalar(1 / len);
    quat.setFromUnitVectors(up, dir);
    mesh.quaternion.copy(quat);
  }
  mesh.scale.set(1, Math.max(len, 1e-4), 1);
}

const toTarget = new THREE.Vector3();
const poleFlat = new THREE.Vector3();

/**
 * Analytic two-bone IK, law of cosines (§7.5). Twenty lines, no CCD, no FABRIK. Writes
 * the middle joint into `outJoint`; the chain reaches as far as it can and no further.
 */
export function solveTwoBone(
  outJoint: THREE.Vector3,
  root: THREE.Vector3,
  target: THREE.Vector3,
  upper: number,
  lower: number,
  pole: THREE.Vector3,
): void {
  toTarget.subVectors(target, root);
  const reach = upper + lower;
  const floor = Math.abs(upper - lower) + 1e-4;
  let d = toTarget.length();
  if (d < 1e-5) {
    toTarget.set(0, -1, 0);
    d = 1;
  }
  toTarget.multiplyScalar(1 / d);
  d = Math.min(Math.max(d, floor), reach - 1e-4);

  // Distance along the root→target line to the joint's projection, and its offset.
  const a = (upper * upper - lower * lower + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));

  // Pole, made perpendicular to the chain, decides which way the joint breaks.
  poleFlat.copy(pole).addScaledVector(toTarget, -pole.dot(toTarget));
  if (poleFlat.lengthSq() < 1e-8) poleFlat.set(0, 0, 1).addScaledVector(toTarget, -toTarget.z);
  poleFlat.normalize();

  outJoint.copy(root).addScaledVector(toTarget, a).addScaledVector(poleFlat, h);
}

export type Rig = {
  root: THREE.Group;
  board: THREE.Group;
  /** Shoulder-to-hand distance over arm reach. Above 1 means the arm is coming up short. */
  strain: { front: number; back: number };
  apply(drivers: RigDrivers, params: Params): void;
};

const SKIN = 0x2f6ee2;
const DARK = 0x1b1f24;

export function createRig(): Rig {
  const root = new THREE.Group();

  // Board hangs off the root so a tweak can rotate it about the grab point while the
  // hips stay in the clean frame (§7.4). Without that split the tweak is invisible.
  const board = new THREE.Group();
  root.add(board);

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.02, BOARD_LENGTH),
    new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.4 }),
  );
  deck.position.y = 0.02;
  board.add(deck);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.022, 0.14),
    new THREE.MeshStandardMaterial({ color: 0xe2582f, roughness: 0.4 }),
  );
  nose.position.set(0, 0.02, BOARD_HALF - 0.09);
  board.add(nose);

  const pelvis = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.14, 0.22),
    new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6 }),
  );
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.44, 0.24),
    new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6 }),
  );
  torso.geometry.translate(0, 0.22, 0);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.19, 0.22, 0.19),
    new THREE.MeshStandardMaterial({ color: 0xf0d9b5, roughness: 0.7 }),
  );

  const thighL = bone(SKIN, 0.11);
  const shinL = bone(SKIN, 0.1);
  const thighR = bone(SKIN, 0.11);
  const shinR = bone(SKIN, 0.1);
  const armLU = bone(SKIN, 0.085);
  const armLL = bone(SKIN, 0.08);
  const armRU = bone(SKIN, 0.085);
  const armRL = bone(SKIN, 0.08);
  const bootF = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.12, 0.28),
    new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.7 }),
  );
  const bootB = bootF.clone();

  for (const part of [pelvis, torso, head, thighL, shinL, thighR, shinR, armLU, armLL, armRU, armRL]) {
    part.castShadow = true;
    root.add(part);
  }
  board.add(bootF, bootB);

  // Scratch, all reused — this runs every frame.
  const hipCentre = new THREE.Vector3();
  const hipL = new THREE.Vector3();
  const hipR = new THREE.Vector3();
  const footF = new THREE.Vector3();
  const footB = new THREE.Vector3();
  const knee = new THREE.Vector3();
  const shoulder = new THREE.Vector3();
  const hand = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const chestPos = new THREE.Vector3();
  const grab = new THREE.Vector3();
  const neckOffset = new THREE.Vector3();
  const hipQuat = new THREE.Quaternion();
  const spineQuat = new THREE.Quaternion();
  const tmpQuat = new THREE.Quaternion();
  const tweakAxis = new THREE.Vector3();
  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);

  /** Rest position for a hand that isn't grabbing: hanging down, slightly toe-ward. */
  const restHand = (out: THREE.Vector3, shoulderPos: THREE.Vector3, reach: number): void => {
    out.set(shoulderPos.x - reach * 0.35, shoulderPos.y - reach * 0.9, shoulderPos.z);
  };

  const strain = { front: 0, back: 0 };

  return {
    root,
    board,
    strain,

    apply(d, params) {
      const r = params.rig;
      const halfStance = (r.stanceWidth * d.stanceScale) / 2;

      // 1. Board, with the tweak applied about the active grab point.
      const grip = Math.max(d.frontGrip, d.backGrip);
      const useFront = d.frontGrip >= d.backGrip;
      edgePoint(grab, useFront ? d.frontHandEdge : d.backHandEdge, useFront ? d.frontHandT : d.backHandT);
      const lift = Math.max(0, d.boardLift);
      const tweakAngle = d.tweak * grip * TWEAK_MAX;
      if (tweakAngle > 1e-4) {
        // Shove is about the axis through the grab point, perpendicular to the board's
        // length and to the direction the legs push.
        tweakAxis.set(grab.z, 0, -grab.x).normalize();
        board.quaternion.setFromAxisAngle(tweakAxis, tweakAngle);
        board.position.copy(grab).applyQuaternion(board.quaternion).negate().add(grab);
      } else {
        board.quaternion.identity();
        board.position.set(0, 0, 0);
      }
      board.position.y += lift;

      // 2. Feet, which follow the tweaked board.
      footF.set(0, 0.09, halfStance);
      footB.set(0, 0.09, -halfStance);
      bootF.position.copy(footF);
      bootB.position.copy(footB);
      footF.applyQuaternion(board.quaternion).add(board.position);
      footB.applyQuaternion(board.quaternion).add(board.position);

      // 3. Hips — in the clean frame, never parented to the drawn board.
      hipCentre.set(d.hipX, r.hipHeight + d.hipY, d.hipZ);
      hipQuat.setFromAxisAngle(yAxis, d.hipYaw);
      tmpQuat.setFromAxisAngle(xAxis, d.hipPitch);
      hipQuat.multiply(tmpQuat);
      tmpQuat.setFromAxisAngle(zAxis, d.hipRoll);
      hipQuat.multiply(tmpQuat);
      pelvis.position.copy(hipCentre);
      pelvis.quaternion.copy(hipQuat);

      hipL.set(0, 0, halfStance * 0.42).applyQuaternion(hipQuat).add(hipCentre);
      hipR.set(0, 0, -halfStance * 0.42).applyQuaternion(hipQuat).add(hipCentre);

      // 4. Spine, then head.
      spineQuat.copy(hipQuat);
      tmpQuat.setFromAxisAngle(zAxis, d.spineBend);
      spineQuat.multiply(tmpQuat);
      tmpQuat.setFromAxisAngle(xAxis, d.spineSide);
      spineQuat.multiply(tmpQuat);
      tmpQuat.setFromAxisAngle(yAxis, d.spineTwist);
      spineQuat.multiply(tmpQuat);
      torso.position.copy(hipCentre);
      torso.quaternion.copy(spineQuat);

      chestPos.set(0, r.spine, 0).applyQuaternion(spineQuat).add(hipCentre);
      neckOffset.set(0, r.neck, 0).applyQuaternion(spineQuat);
      head.position.copy(chestPos).add(neckOffset);
      head.quaternion.copy(spineQuat);
      tmpQuat.setFromAxisAngle(yAxis, d.headYaw);
      head.quaternion.multiply(tmpQuat);
      tmpQuat.setFromAxisAngle(xAxis, d.headPitch);
      head.quaternion.multiply(tmpQuat);

      // 5. Arms. Hand target lerps from rest toward the point on the board it grips.
      const armReach = r.upperArm + r.forearm;
      for (const side of [1, -1]) {
        const front = side === 1;
        shoulder
          .set(0, r.spine, (front ? 1 : -1) * (r.shoulderWidth / 2))
          .applyQuaternion(spineQuat)
          .add(hipCentre);
        restHand(hand, shoulder, armReach);
        const g = front ? d.frontGrip : d.backGrip;
        if (g > 0) {
          edgePoint(grab, front ? d.frontHandEdge : d.backHandEdge, front ? d.frontHandT : d.backHandT);
          grab.applyQuaternion(board.quaternion).add(board.position);
          hand.lerp(grab, Math.min(g, 1));
        }
        const need = shoulder.distanceTo(hand) / armReach;
        if (front) strain.front = g > 0 ? need : 0;
        else strain.back = g > 0 ? need : 0;

        pole.set(-1, -0.2, 0);
        solveTwoBone(elbow, shoulder, hand, r.upperArm, r.forearm, pole);
        placeBone(front ? armLU : armRU, shoulder, elbow);
        placeBone(front ? armLL : armRL, elbow, hand);
      }

      // 6. Legs last, because the feet moved with the board and the hips did not (§7.8).
      // Knee bend is never authored — it falls out of where the hips ended up.
      pole.set(-Math.cos(d.kneeSplay), 0, Math.sin(d.kneeSplay));
      solveTwoBone(knee, hipL, footF, r.thigh, r.shin, pole);
      placeBone(thighL, hipL, knee);
      placeBone(shinL, knee, footF);

      pole.set(-Math.cos(d.kneeSplay), 0, -Math.sin(d.kneeSplay));
      solveTwoBone(knee, hipR, footB, r.thigh, r.shin, pole);
      placeBone(thighR, hipR, knee);
      placeBone(shinR, knee, footB);
    },
  };
}
