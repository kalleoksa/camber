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
  /**
   * Pelvis position relative to the board, which is the fixed frame. This is how the rider
   * gets placed: hips down is a crouch, hips toward the heel edge is a lean, hips toward the
   * nose is a press. Knee flexion follows from where they end up.
   */
  hipX: number; // m, + toward the heel edge
  hipY: number; // m, along the board normal. − is a crouch
  hipZ: number; // m, + toward the nose
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
  /**
   * rad of board pitch about its lateral axis, nose up for positive, pivoting on the grabbed
   * point so the hand stays put.
   *
   * This is the driver that makes one leg straighter than the other. The feet are bolted to a
   * rigid board, so with the pelvis placed both knee angles are already determined — nothing
   * about the body can extend the back leg alone. Tilting the board raises one binding and
   * drops the other, which bends one knee and extends the other, and that is what a boned
   * japan or method actually is. It is also the board's nose-up attitude, so the same number
   * does both jobs.
   */
  boardPitch: number;
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
   * Arms, per side, joint by joint. Forward-kinematic from the shoulder, so a hand goes
   * wherever the joints put it — there is no shared rest pose any more, and the two hands
   * are independent.
   *
   * `Swing` is shoulder flexion in the rider's sagittal plane: 0 hangs at the side, π/2 is
   * straight out toward the toes, π is overhead. `Out` is abduction along the board, toward
   * the nose on the front arm and the tail on the back. `Elbow` is flexion. `Pole` sweeps
   * which way the elbow breaks, and it is also what `armRouting` will need — outside,
   * between the legs and crossed differ only in where the elbow goes.
   *
   * When the matching grip is above 0 the hand is pulled to the grab point and the elbow
   * solves by IK instead, with `Pole` still choosing the break direction.
   */
  frontShoulderSwing: number;
  frontShoulderOut: number;
  frontElbow: number;
  frontElbowPole: number;
  backShoulderSwing: number;
  backShoulderOut: number;
  backElbow: number;
  backElbowPole: number;
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
    boardPitch: 0,
    tweakRoll: 0,
    headYaw: 0,
    headPitch: 0,
    kneeSplay: 0.5,
    stanceScale: 1,
    frontShoulderSwing: 0.35,
    frontShoulderOut: 0.25,
    frontElbow: 0.5,
    frontElbowPole: 0,
    backShoulderSwing: 0.35,
    backShoulderOut: 0.25,
    backElbow: 0.5,
    backElbowPole: 0,
  };
}

export function copyDrivers(dst: RigDrivers, src: RigDrivers): void {
  for (const key of Object.keys(dst) as (keyof RigDrivers)[]) dst[key] = src[key];
}

const BOARD_LENGTH = 1.55;
const BOARD_HALF = BOARD_LENGTH / 2;
const EDGE_X = 0.145; // m, just outside the deck so the hand wraps the edge

/** Fraction of `t` at each end over which the two edge splines converge on the tip. */
const TIP_TAPER = 0.15;

/**
 * A grab is a coordinate on the board, not one of eight buttons (§7.3). `edge` picks
 * which rail continuously, `t` runs tail (0) to nose (1).
 *
 * The two splines **converge at the tips**, because a board's edges meet there. Without
 * that, `edge` only ever interpolated between the two side rails at full width all the way
 * to the end, so a nose or tail grab had no coordinate: those are grabbed at the tip on the
 * centre line, not on either edge. Now any `edge` value collapses to the centre line as `t`
 * approaches 0 or 1, which is what makes a tailgrab and a nosegrab expressible at all.
 *
 * The taper only bites over the outer 15%, so every grab between the bindings — indy, mute,
 * melon, method, stalefish, japan — sits at exactly the width it did before.
 */
export function edgePoint(out: THREE.Vector3, edge: number, t: number): THREE.Vector3 {
  const fromTip = Math.min(t, 1 - t);
  const taper = Math.min(Math.max(fromTip / TIP_TAPER, 0), 1);
  // state.edge is + for toe, and the toe side is board-local −X.
  out.set(-edge * EDGE_X * taper, 0.035, (t * 2 - 1) * (BOARD_HALF - 0.06));
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

/** Recolour a limb in place. Skips the write when it already matches, so it stays cheap. */
function tint(mesh: THREE.Mesh, color: number): void {
  const material = mesh.material as THREE.MeshStandardMaterial;
  if (material.color.getHex() !== color) material.color.setHex(color);
}

/**
 * Aim a bone mesh from one joint to another, drawn at no more than `maxLen`.
 *
 * The clamp matters. Without it the mesh scaled to whatever gap it was given, so a target
 * the limb could not reach came out as a *stretched* bone rather than a short one — which
 * is invisible, and meant `reach` above 1.0 looked fine on screen. An unreachable grab now
 * leaves a gap between the hand and the board, which is what it physically is.
 */
function placeBone(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, maxLen: number): void {
  dir.subVectors(to, from);
  const len = dir.length();
  mesh.position.copy(from);
  if (len > 1e-5) {
    dir.multiplyScalar(1 / len);
    quat.setFromUnitVectors(up, dir);
    mesh.quaternion.copy(quat);
  }
  mesh.scale.set(1, Math.max(Math.min(len, maxLen), 1e-4), 1);
}

const toTarget = new THREE.Vector3();
const poleFlat = new THREE.Vector3();
const upperDir = new THREE.Vector3();
const foreDir = new THREE.Vector3();
const bendAxis = new THREE.Vector3();
const armRef = new THREE.Vector3();
const armQuat = new THREE.Quaternion();
const armZ = new THREE.Vector3(0, 0, 1);
const armX = new THREE.Vector3(1, 0, 0);

/**
 * Forward kinematics down one arm, in torso space: shoulder swing and abduction aim the
 * upper arm, then the elbow bends the forearm about an axis `pole` sweeps around it.
 *
 * The hand is wherever the joints put it. That is the point — a single shared rest pose
 * could not place two hands independently, and every joint being a driver is what makes a
 * hand poseable rather than only reachable.
 */
function solveArmFK(
  outElbow: THREE.Vector3,
  outHand: THREE.Vector3,
  shoulderPos: THREE.Vector3,
  torsoQuat: THREE.Quaternion,
  swing: number,
  out: number,
  flex: number,
  pole: number,
  side: number,
  r: { upperArm: number; forearm: number },
): void {
  // Hanging down, swung forward toward the toes, then abducted along the board.
  upperDir.set(0, -1, 0);
  armQuat.setFromAxisAngle(armZ, -swing);
  upperDir.applyQuaternion(armQuat);
  armQuat.setFromAxisAngle(armX, side * out);
  upperDir.applyQuaternion(armQuat);
  upperDir.applyQuaternion(torsoQuat).normalize();
  outElbow.copy(shoulderPos).addScaledVector(upperDir, r.upperArm);

  // A reference perpendicular to the upper arm, swept by `pole`, is the bend axis.
  armRef.set(0, 0, side).applyQuaternion(torsoQuat);
  armRef.addScaledVector(upperDir, -armRef.dot(upperDir));
  if (armRef.lengthSq() < 1e-8) armRef.set(1, 0, 0).addScaledVector(upperDir, -upperDir.x);
  armRef.normalize();
  armQuat.setFromAxisAngle(upperDir, pole);
  bendAxis.copy(armRef).applyQuaternion(armQuat).normalize();

  armQuat.setFromAxisAngle(bendAxis, flex);
  foreDir.copy(upperDir).applyQuaternion(armQuat).normalize();
  outHand.copy(outElbow).addScaledVector(foreDir, r.forearm);
}


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
  /**
   * How far short the hand actually is, in metres. A ratio tells you a pose is impossible;
   * this tells you how much to move, which is what you need while dragging a slider.
   */
  shortfall: { front: number; back: number };
  /**
   * Draw the red gap bars and tint an over-reaching arm. On while authoring, off in play —
   * a hand that misses during a trick should read as the trick going wrong, not as a debug
   * overlay. `createScene` turns it on with pose mode.
   */
  showReach(on: boolean): void;
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
const MITT = 0x1b3f8f;
/** The one colour that means "this pose is not physically possible". */
const SHORT = 0xff2d2d;

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
  // A visor on the toe side, which is the way the rider faces. Without it the head is a
  // symmetric box and headYaw/headPitch are invisible however correctly they rotate it —
  // they measured 0.000 movement not because they were broken but because nothing about a
  // rotating cube reads.
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.07, 0.16),
    new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.35 }),
  );
  visor.position.set(-0.1, 0.02, 0);
  head.add(visor);

  const thighL = bone(SKIN, 0.11);
  const shinL = bone(SKIN, 0.1);
  const thighR = bone(SKIN, 0.11);
  const shinR = bone(SKIN, 0.1);
  const armLU = bone(SKIN, 0.085);
  const armLL = bone(SKIN, 0.08);
  const armRU = bone(SKIN, 0.085);
  const armRL = bone(SKIN, 0.08);
  // Hands. There were none — the arm chain just ended, so the thing being placed was
  // invisible and any driver that only moved the hand looked like it did nothing.
  const mittF = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.09, 0.075),
    new THREE.MeshStandardMaterial({ color: MITT, roughness: 0.6 }),
  );
  // Its own material, not the clone's shared one — otherwise tinting one mitt tints both and
  // the overlay cannot say *which* hand is short.
  const mittB = mittF.clone();
  mittB.material = new THREE.MeshStandardMaterial({ color: MITT, roughness: 0.6 });

  // The gap between where the hand got to and where the grab point is. This is the whole
  // point of the overlay: the number in the panel is easy to miss while you are dragging a
  // slider and watching the viewport, and an unreachable pose otherwise just looks posed.
  const gapF = bone(SHORT, 0.045);
  const gapB = bone(SHORT, 0.045);
  gapF.visible = false;
  gapB.visible = false;
  let reachOverlay = false;

  const bootF = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.12, 0.28),
    new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.7 }),
  );
  const bootB = bootF.clone();

  for (const part of [pelvis, torso, head, thighL, shinL, thighR, shinR, armLU, armLL, armRU, armRL, mittF, mittB]) {
    part.castShadow = true;
    root.add(part);
  }
  root.add(gapF, gapB);
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

  const strain = { front: 0, back: 0 };
  const shortfall = { front: 0, back: 0 };
  const legSpan = { front: 0, back: 0 };
  const torsoAxis = new THREE.Vector3(0, 1, 0);
  const kneeF = new THREE.Vector3();
  const kneeB = new THREE.Vector3();
  const boardLong = new THREE.Vector3();
  let effectiveStance = 0;

  return {
    root,
    board,
    strain,
    shortfall,
    legSpan,
    torsoAxis,
    showReach(on: boolean): void {
      reachOverlay = on;
      if (!on) {
        gapF.visible = false;
        gapB.visible = false;
      }
    },
    get stance() {
      return effectiveStance;
    },

    apply(d, params) {
      const r = params.rig;
      const halfStance = (r.stanceWidth * d.stanceScale) / 2;

      /**
       * **The board is the fixed frame here.** It sits at the root, unrotated, and the feet
       * are bolted to its bindings. The body is then positioned *relative to it*.
       *
       * This walks back the derived-board inversion for the pose path, on purpose. Deriving
       * the board from the feet is right about the physics — it is bolted to two feet and its
       * attitude is an output — but it makes the rig unposeable: with rigid legs and the board
       * hanging off them, every pelvis driver moves the whole assembly and nothing moves
       * relative to anything. Measured: hip translation gave exactly 0.000 joint movement once
       * the board was anchored, and pelvis *rotation* tipped the rider and board over together
       * because the anchor cancelled position but not orientation.
       *
       * The cost, stated plainly: knee flexion is an output again, not a driver, so the
       * ≤10° divergence the patch note guaranteed by construction now has to be *watched* in
       * the readout instead. That is the trade for being able to place the rider at all.
       */
      board.quaternion.identity();
      board.position.set(0, 0, 0);
      const pitch = d.boardPitch;
      const roll = d.tweakRoll * r.tweakRollMax;
      if (Math.abs(pitch) > 1e-5 || Math.abs(roll) > 1e-5) {
        // Pitch about the lateral axis first — nose up for positive — then the lesser roll
        // about the board's own length, which is what shows the base.
        boardLong.set(-1, 0, 0);
        board.quaternion.setFromAxisAngle(boardLong, pitch);
        if (Math.abs(roll) > 1e-5) {
          boardLong.set(0, 0, 1);
          tmpQuat.setFromAxisAngle(boardLong, roll);
          board.quaternion.multiply(tmpQuat);
        }
        // Pivot on the grabbed point so the hand stays where it was put (§7.4).
        const useFront = d.frontGrip >= d.backGrip;
        edgePoint(grab, useFront ? d.frontHandEdge : d.backHandEdge, useFront ? d.frontHandT : d.backHandT);
        board.position.copy(grab).applyQuaternion(board.quaternion).negate().add(grab);
      }

      // 1. Feet, bolted to the bindings, following the board.
      footF.set(0, 0.09, halfStance);
      footB.set(0, 0.09, -halfStance);
      bootF.position.copy(footF);
      bootB.position.copy(footB);
      footF.applyQuaternion(board.quaternion).add(board.position);
      footB.applyQuaternion(board.quaternion).add(board.position);

      // 2. Pelvis, placed and oriented relative to the board. Sagittal pitch is about Z
      // because the rider faces −X, so Z is their left-right axis; negated so positive
      // `pelvisPitch` leans back toward the heel side.
      hipCentre.set(d.hipX, r.hipHeight + d.hipY, d.hipZ);
      hipQuat.setFromAxisAngle(yAxis, d.hipYaw);
      tmpQuat.setFromAxisAngle(zAxis, -d.pelvisPitch);
      hipQuat.multiply(tmpQuat);
      tmpQuat.setFromAxisAngle(xAxis, d.hipRoll);
      hipQuat.multiply(tmpQuat);
      pelvis.position.copy(hipCentre);
      pelvis.quaternion.copy(hipQuat);
      hipL.set(0, 0, halfStance * 0.42).applyQuaternion(hipQuat).add(hipCentre);
      hipR.set(0, 0, -halfStance * 0.42).applyQuaternion(hipQuat).add(hipCentre);

      // 3. Spine chain.
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

      // 4. Head, in torso space.
      chestPos.set(0, r.spine, 0).applyQuaternion(spineQuat).add(hipCentre);
      neckOffset.set(0, r.neck, 0).applyQuaternion(spineQuat);
      head.position.copy(chestPos).add(neckOffset);
      head.quaternion.copy(spineQuat);
      tmpQuat.setFromAxisAngle(yAxis, d.headYaw);
      head.quaternion.multiply(tmpQuat);
      tmpQuat.setFromAxisAngle(zAxis, d.headPitch);
      head.quaternion.multiply(tmpQuat);

      // 5. Arms. `reach` stays an output and a validity test: above 1.0 the hand cannot touch
      // the grab point, and the IK clamps rather than stretching, so it shows as a gap.
      const armReach = r.upperArm + r.forearm;
      for (const side of [1, -1]) {
        const front = side === 1;
        shoulder
          .set(0, r.spine, (front ? 1 : -1) * (r.shoulderWidth / 2))
          .applyQuaternion(spineQuat)
          .add(hipCentre);
        const swing = front ? d.frontShoulderSwing : d.backShoulderSwing;
        const outward = front ? d.frontShoulderOut : d.backShoulderOut;
        const flex = front ? d.frontElbow : d.backElbow;
        const poleAngle = front ? d.frontElbowPole : d.backElbowPole;

        // Free arm: pure FK, so both hands are placeable joint by joint and independently.
        solveArmFK(elbow, hand, shoulder, spineQuat, swing, outward, flex, poleAngle, side, r);

        const g = front ? d.frontGrip : d.backGrip;
        if (g > 0) {
          // Gripping: the hand is pulled to the grab point and the elbow solves to suit, with
          // `pole` still choosing which way it breaks.
          edgePoint(grab, front ? d.frontHandEdge : d.backHandEdge, front ? d.frontHandT : d.backHandT);
          grab.applyQuaternion(board.quaternion).add(board.position);
          hand.lerp(grab, Math.min(g, 1));
          pole.set(Math.cos(poleAngle), -0.2, side * Math.sin(poleAngle)).applyQuaternion(spineQuat);
          solveTwoBone(elbow, shoulder, hand, r.upperArm, r.forearm, pole);
        }
        const span = shoulder.distanceTo(hand);
        const need = span / armReach;
        const missing = g > 0 ? Math.max(span - armReach, 0) : 0;
        if (front) {
          strain.front = g > 0 ? need : 0;
          shortfall.front = missing;
        } else {
          strain.back = g > 0 ? need : 0;
          shortfall.back = missing;
        }

        placeBone(front ? armLU : armRU, shoulder, elbow, r.upperArm);
        placeBone(front ? armLL : armRL, elbow, hand, r.forearm);
        // The mitt rides the end of the forearm, not the target, so a hand that cannot
        // reach visibly falls short instead of the arm quietly stretching to it.
        const mitt = front ? mittF : mittB;
        mitt.position
          .copy(elbow)
          .addScaledVector(dir.subVectors(hand, elbow).normalize(), Math.min(hand.distanceTo(elbow), r.forearm));

        // Overlay: bar the mitt to the grab point it could not make, and redden the arm.
        const short = reachOverlay && missing > 1e-4;
        const gapBar = front ? gapF : gapB;
        gapBar.visible = short;
        if (short) placeBone(gapBar, mitt.position, grab, span);
        tint(front ? armLU : armRU, short ? SHORT : SKIN);
        tint(front ? armLL : armRL, short ? SHORT : SKIN);
        tint(mitt, short ? SHORT : MITT);
      }

      // 6. Legs last, hips to the bolted feet. Knee bend emerges from where the pelvis ended
      // up (§7.8); `kneeSplay` only picks which way it breaks — past π/2 the pole's X goes
      // positive and the knees break backward toward the heel side, which a method needs.
      legSpan.front = hipL.distanceTo(footF);
      legSpan.back = hipR.distanceTo(footB);
      pole.set(-Math.cos(d.kneeSplay), 0, Math.sin(d.kneeSplay));
      solveTwoBone(kneeF, hipL, footF, r.thigh, r.shin, pole);
      placeBone(thighL, hipL, kneeF, r.thigh);
      placeBone(shinL, kneeF, footF, r.shin);
      pole.set(-Math.cos(d.kneeSplay), 0, -Math.sin(d.kneeSplay));
      solveTwoBone(kneeB, hipR, footB, r.thigh, r.shin, pole);
      placeBone(thighR, hipR, kneeB, r.thigh);
      placeBone(shinR, kneeB, footB, r.shin);
      effectiveStance = halfStance * 2;
    },
  };
}
