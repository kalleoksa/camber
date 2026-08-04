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
  /**
   * rad of pelvis pitch in the rider's sagittal plane; positive leans the pelvis *back*
   * toward the heel side. This is what tweak depth mostly moves. The board's world pitch is
   * inherited from here — the pelvis-forward axis rotated back with the torso is what the
   * board follows, so board attitude and torso lean are one rotation read twice, not two
   * things to reconcile.
   */
  pelvisPitch: number;
  hipRoll: number; // rad, pelvis side-tilt about the rider's facing axis
  spineBend: number; // rad, + folds the chest toward the toe edge
  spineSide: number; // rad, + leans toward the nose
  spineTwist: number; // rad, shoulders against hips
  frontHandEdge: number; // −1 heel .. +1 toe, matching state.edge's sign
  frontHandT: number; // 0 tail .. 1 nose
  backHandEdge: number;
  backHandT: number;
  frontGrip: number; // 0 = arm at rest, 1 = hand locked to the board
  backGrip: number;
  /** rad of thigh swing in the sagittal plane; positive swings the thighs toward the toes. */
  hipFlex: number;
  /**
   * rad of knee flexion, per leg, **driven**. The board's translation up and behind the
   * rider comes out of this — deeper flexion brings the board closer to the hips — so this
   * is what tweak depth modulates. Both legs want 105–115° in a method with at most ~10° of
   * front bias; 42° of divergence is a symptom, not a style choice.
   */
  kneeFront: number;
  kneeBack: number;
  /**
   * 0..1 of roll about the board's own long axis — the base turning to face away from the
   * rider, which is part of the look but a *lesser* magnitude than the pitch. Kept separate
   * because one scalar driving both means retuning either one moves the other.
   */
  tweakRoll: number;
  headYaw: number; // rad
  /**
   * rad of neck extension — a nod. About board Z, the rider's left-right axis, because the
   * rider faces −X: rotating about X would roll the head ear-to-shoulder, which is what
   * this used to do and is not a thing anyone wants to author. Positive looks up and back.
   */
  headPitch: number;
  /**
   * rad, the knee pole swept from forward. 0 points the knees straight at the toe side —
   * a stance splays, it doesn't squat — π/2 points them along the board, and past π/2 the
   * pole's X goes positive and the knees break *backward*, toward the heel side. A method
   * needs that back break, so the range has to run past π/2 or the pose is unreachable.
   */
  kneeSplay: number;
  stanceScale: number; // multiplier on binding separation
  /**
   * 0 = the ungripped hand hangs at the side, 1 = shoulder flexed ~155°, up and toe-ward.
   * A method's trailing arm is a counterweight thrown skyward, and with only a rest pose to
   * fall back on there was no way to express it — the arm stayed pinned down no matter what
   * the rest of the pose did.
   */
  freeArmRaise: number;
};

export function neutralDrivers(): RigDrivers {
  return {
    hipX: 0,
    hipY: 0,
    hipZ: 0,
    hipYaw: 0,
    pelvisPitch: 0,
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
    hipFlex: 0.25,
    kneeFront: 0.45,
    kneeBack: 0.45,
    tweakRoll: 0,
    headYaw: 0,
    headPitch: 0,
    kneeSplay: 0.5,
    stanceScale: 1,
    freeArmRaise: 0,
  };
}

export function copyDrivers(dst: RigDrivers, src: RigDrivers): void {
  for (const key of Object.keys(dst) as (keyof RigDrivers)[]) dst[key] = src[key];
}

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
const thighDir = new THREE.Vector3();
const shinDir = new THREE.Vector3();
const kneeAxis = new THREE.Vector3();
const legQuat = new THREE.Quaternion();

/**
 * Forward kinematics down one leg: the thigh swings from straight-down by `hipFlex` in the
 * sagittal plane and by `splay` laterally, then the knee bends the shin backward by
 * `flex`. Both joints are drivers, so the foot — and through it the board — is an output.
 *
 * Flexing the knee swings the foot up and *behind*, heel toward glutes, which is what
 * carries the board up behind the rider. That is the whole of the board's translation.
 */
function solveLeg(
  outKnee: THREE.Vector3,
  outFoot: THREE.Vector3,
  hip: THREE.Vector3,
  pelvis: THREE.Quaternion,
  hipFlex: number,
  flex: number,
  splay: number,
  side: number,
  r: { thigh: number; shin: number },
): void {
  // Thigh: down, swung toward the toes by hipFlex, splayed outward along the board.
  thighDir.set(0, -1, 0);
  legQuat.setFromAxisAngle(zAxisConst, -hipFlex);
  thighDir.applyQuaternion(legQuat);
  legQuat.setFromAxisAngle(xAxisConst, side * splay * 0.25);
  thighDir.applyQuaternion(legQuat);
  thighDir.applyQuaternion(pelvis).normalize();
  outKnee.copy(hip).addScaledVector(thighDir, r.thigh);

  // Knee bends about the leg's lateral axis, swinging the shin toward the rider's back.
  kneeAxis.set(0, 0, 1).applyQuaternion(pelvis).normalize();
  legQuat.setFromAxisAngle(kneeAxis, flex);
  shinDir.copy(thighDir).applyQuaternion(legQuat).normalize();
  outFoot.copy(outKnee).addScaledVector(shinDir, r.shin);
}

const xAxisConst = new THREE.Vector3(1, 0, 0);
const zAxisConst = new THREE.Vector3(0, 0, 1);

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
  /** Hip-to-foot distance per leg, m. The knee angle it implies is what reads as a tuck. */
  legSpan: { front: number; back: number };
  /** Spine direction, hips to shoulders. The frame board attitude should be measured in. */
  torsoAxis: THREE.Vector3;
  /** Foot separation the leg solve produced. A diagnostic — the board is derived from it. */
  readonly stance: number;
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
  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);

  /**
   * Where a hand sits when it isn't gripping. `raise` sweeps the shoulder from hanging at
   * the side through to roughly 155° of flexion, up and toe-ward. Kept at 0.95 of reach so
   * the arm reads as extended rather than locked.
   */
  const restDir = new THREE.Vector3();
  const restHand = (
    out: THREE.Vector3,
    shoulderPos: THREE.Vector3,
    reach: number,
    raise: number,
    torsoQuat: THREE.Quaternion,
  ): void => {
    // Built in TORSO space, then rotated by the spine. Shoulder flexion of 150–170° roughly
    // continues the torso axis, so a torso leaned 49° back puts the arm 49° off vertical
    // rather than straight up. Authored in world it pointed at the sky whatever the torso
    // did, which is where the 1.88 m tall outline came from.
    restDir.set(-0.36 - raise * 0.1, -0.93 + raise * 1.86, 0).normalize();
    restDir.applyQuaternion(torsoQuat);
    out.copy(shoulderPos).addScaledVector(restDir, reach * 0.95);
  };

  const strain = { front: 0, back: 0 };
  const legSpan = { front: 0, back: 0 };
  const torsoAxis = new THREE.Vector3(0, 1, 0);
  const kneeF = new THREE.Vector3();
  const kneeB = new THREE.Vector3();
  const boardLong = new THREE.Vector3();
  const boardUp = new THREE.Vector3();
  const boardSide = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  let effectiveStance = 0;

  return {
    root,
    board,
    strain,
    legSpan,
    torsoAxis,
    get stance() {
      return effectiveStance;
    },

    apply(d, params) {
      const r = params.rig;
      const halfStance = (r.stanceWidth * d.stanceScale) / 2;

      // Strict order, nothing later feeding anything earlier. The board is at step 4 and is
      // *derived*: it is bolted to two feet, so its position and orientation are outputs of
      // the leg solve. Driving the board and solving the body onto it is what produced both
      // earlier dead ends — a board pinned flat with the angle absorbed into a contorted
      // torso, then a board pitched about a mid-board grab which lifts one binding and drops
      // the other and forced the knees to 135/93.

      // 1. Pelvis. Sagittal pitch is about Z because the rider faces −X, so Z is their
      // left-right axis. Negated so positive `pelvisPitch` leans back toward the heel side.
      hipCentre.set(d.hipX, r.hipHeight + d.hipY, d.hipZ);
      hipQuat.setFromAxisAngle(yAxis, d.hipYaw);
      tmpQuat.setFromAxisAngle(zAxis, -d.pelvisPitch);
      hipQuat.multiply(tmpQuat);
      tmpQuat.setFromAxisAngle(xAxis, d.hipRoll);
      hipQuat.multiply(tmpQuat);
      pelvis.position.copy(hipCentre);
      pelvis.quaternion.copy(hipQuat);

      // 2. Spine chain.
      spineQuat.copy(hipQuat);
      tmpQuat.setFromAxisAngle(zAxis, d.spineBend);
      spineQuat.multiply(tmpQuat);
      tmpQuat.setFromAxisAngle(xAxis, d.spineSide);
      spineQuat.multiply(tmpQuat);
      tmpQuat.setFromAxisAngle(yAxis, d.spineTwist);
      spineQuat.multiply(tmpQuat);
      torso.position.copy(hipCentre);
      torso.quaternion.copy(spineQuat);
      torsoAxis.set(0, 1, 0).applyQuaternion(spineQuat);

      // 3. Legs forward-kinematically from hip rotation and knee flexion. Feet are outputs
      // of the drivers now, not targets the drivers have to be reverse-engineered from.
      hipL.set(0, 0, halfStance * 0.42).applyQuaternion(hipQuat).add(hipCentre);
      hipR.set(0, 0, -halfStance * 0.42).applyQuaternion(hipQuat).add(hipCentre);
      solveLeg(kneeF, footF, hipL, hipQuat, d.hipFlex, d.kneeFront, d.kneeSplay, 1, r);
      solveLeg(kneeB, footB, hipR, hipQuat, d.hipFlex, d.kneeBack, d.kneeSplay, -1, r);
      legSpan.front = hipL.distanceTo(footF);
      legSpan.back = hipR.distanceTo(footB);

      // 4. Board derived from the two feet. They define its length and where it sits; the
      // only free choice left is the roll about that line, which comes from hip rotation.
      boardLong.subVectors(footF, footB);
      const stance = boardLong.length();
      if (stance > 1e-5) boardLong.multiplyScalar(1 / stance);
      else boardLong.set(0, 0, 1);
      boardUp.set(0, 1, 0).applyQuaternion(hipQuat);
      boardUp.addScaledVector(boardLong, -boardUp.dot(boardLong));
      if (boardUp.lengthSq() < 1e-8) boardUp.set(0, 1, 0);
      boardUp.normalize();
      const roll = d.tweakRoll * r.tweakRollMax;
      if (roll > 1e-5 || roll < -1e-5) {
        tmpQuat.setFromAxisAngle(boardLong, roll);
        boardUp.applyQuaternion(tmpQuat).normalize();
      }
      boardSide.crossVectors(boardUp, boardLong).normalize();
      basis.makeBasis(boardSide, boardUp, boardLong);
      board.quaternion.setFromRotationMatrix(basis);
      // Origin sits a boot height below the midpoint of the feet, so the feet land on the deck.
      board.position.copy(footF).add(footB).multiplyScalar(0.5).addScaledVector(boardUp, -0.09);
      // Effective stance is whatever the legs produced. It is a diagnostic, not an input.
      effectiveStance = stance;

      // Boots ride the board, in its own space.
      bootF.position.set(0, 0.09, stance * 0.5);
      bootB.position.set(0, 0.09, -stance * 0.5);

      // 5. Head, in torso space — the frame errors that made a vertical board and a vertical
      // trailing arm were both a driver authored in the wrong frame.
      chestPos.set(0, r.spine, 0).applyQuaternion(spineQuat).add(hipCentre);
      neckOffset.set(0, r.neck, 0).applyQuaternion(spineQuat);
      head.position.copy(chestPos).add(neckOffset);
      head.quaternion.copy(spineQuat);
      tmpQuat.setFromAxisAngle(yAxis, d.headYaw);
      head.quaternion.multiply(tmpQuat);
      tmpQuat.setFromAxisAngle(zAxis, d.headPitch);
      head.quaternion.multiply(tmpQuat);

      // 6. Arms. `reach` is an output and a validity test: above 1.0 the hand cannot touch
      // the grab point, and the answer is to change the legs or the pelvis, never to stretch
      // the arm. The IK clamps rather than extending, so an invalid pose shows as a gap.
      const armReach = r.upperArm + r.forearm;
      for (const side of [1, -1]) {
        const front = side === 1;
        shoulder
          .set(0, r.spine, (front ? 1 : -1) * (r.shoulderWidth / 2))
          .applyQuaternion(spineQuat)
          .add(hipCentre);
        restHand(hand, shoulder, armReach, d.freeArmRaise, spineQuat);
        const g = front ? d.frontGrip : d.backGrip;
        if (g > 0) {
          edgePoint(grab, front ? d.frontHandEdge : d.backHandEdge, front ? d.frontHandT : d.backHandT);
          grab.applyQuaternion(board.quaternion).add(board.position);
          hand.lerp(grab, Math.min(g, 1));
        }
        const need = shoulder.distanceTo(hand) / armReach;
        if (front) strain.front = g > 0 ? need : 0;
        else strain.back = g > 0 ? need : 0;

        pole.set(-1, -0.2, 0).applyQuaternion(spineQuat);
        solveTwoBone(elbow, shoulder, hand, r.upperArm, r.forearm, pole);
        placeBone(front ? armLU : armRU, shoulder, elbow);
        placeBone(front ? armLL : armRL, elbow, hand);
      }

      // 7. Draw the legs the FK already solved. No IK: the knee angle is the driver.
      placeBone(thighL, hipL, kneeF);
      placeBone(shinL, kneeF, footF);
      placeBone(thighR, hipR, kneeB);
      placeBone(shinR, kneeB, footB);
    },
  };
}
