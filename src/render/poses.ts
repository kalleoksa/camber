import { neutralDrivers, type RigDrivers } from './rig.ts';

/**
 * Anchor poses (design §7.8). These are presets of the driver vector, not skeleton
 * keyframes — invariant 3 permits them precisely because they stay composable: you can
 * be 60% of the way to `method` while spinning and pressing tail and it still resolves.
 * If one of these ever needs a *timeline*, it has become a clip and the invariant broke.
 *
 * Starting points, not finished poses. The milestone 4 gate is that you can reach a
 * method you're happy with from the sliders — use video reference, including your own.
 */
function pose(overrides: Partial<RigDrivers>): RigDrivers {
  return { ...neutralDrivers(), ...overrides };
}

export const ANCHORS: Record<string, RigDrivers> = {
  neutral: neutralDrivers(),

  /** Knees deep, weight centred — the pop wind-up. */
  crouch: pose({
    hipY: -0.34,
    spineBend: 0.42,
    kneeSplay: 0.62,
    headPitch: -0.12,
  }),

  /** Back hand, toe edge, just behind centre. Compact and tucked. */
  indy: pose({
    hipY: -0.18,
    hipX: -0.05,
    spineBend: 0.4,
    spineTwist: -0.22,
    backHandEdge: 1,
    backHandT: 0.35,
    backGrip: 1,
    kneeFront: 1.75,
    kneeBack: 1.92,
    headPitch: -0.15,
    kneeSplay: 0.6,
  }),

  /** Front hand, heel edge, mid-board. Boned out toward the nose. */
  melon: pose({
    hipY: -0.15,
    hipX: 0.08,
    hipZ: -0.1,
    spineBend: -0.4,
    spineSide: 0.14,
    spineTwist: 0.2,
    frontHandEdge: -1,
    frontHandT: 0.5,
    frontGrip: 1,
    kneeFront: 1.85,
    kneeBack: 1.85,
    kneeSplay: 0.55,
  }),

  /**
   * The pose the gate is about, built from the causal chain rather than from a silhouette.
   *
   * A method and a melon are the *same grab* — front hand, heel edge, between the bindings,
   * an identical `(edge, t, hand)` coordinate. Everything that makes it a method happens
   * after the hand lands, which is exactly why the grab spline and the driver vector are
   * separate systems. Compare with `melon` below: only the pose drivers differ.
   *
   * Order of cause, because the naive version gets it backwards. The arm is a tension
   * member, not an actuator — it never lifts the board:
   *   1. front hand anchors to the heel edge, elbow near straight (that is what "boned" is)
   *   2. knees flex, heels toward glutes — this is what brings the board up and *behind the
   *      rider's back*, which is `boardBack`, not just `boardLift`
   *   3. hips extend, driving forward and up as the board goes back
   *   4. lumbar and thoracic spine extend — the arch, chest opening to the sky
   *   5. trailing arm extends up and forward as a counterweight
   *   6. head extends, gaze back over the lead shoulder
   *
   * The board's angle is the *effect* of 2–4, never the input. And the composite centre of
   * mass has to stay put: the board swinging to the heel side is why the hips go the other
   * way. Hips drifting with the board is what makes a rider look like they are falling
   * over backwards rather than poking a method.
   */
  method: pose({
    // Hips forward off the heel side and up along the normal — the counterweight to a
    // board swinging back, so the centre of mass stays on its parabola.
    hipX: -0.1,
    hipY: 0.0,
    hipZ: 0.06,
    hipRoll: -0.2, // ~11° of hip *extension*. The hips stay near straight — the arch is
    // spine, not hip, and folding forward at the hip is the thing that made this read wrong.
    // ~43° of spine extension, lumbar plus thoracic. Negative is toward the heel side,
    // which for a rider facing the toe edge is backwards — an arch, not a fold. It used to
    // need 57° here, but that was the torso leaning over to *reach* a board that had no way
    // to come behind the rider; with boardBack carrying that, the arch is back in its band.
    spineBend: -0.65, // torso 49° from vertical, inside the 40–50 band
    spineSide: -0.12,
    spineTwist: 0.35, // ~20° of counter-rotation against the board, which *is* the arch
    frontHandEdge: -1, // heel edge
    frontHandT: 0.5, // between the bindings — identical to melon
    frontGrip: 1,
    // Board attitude is not authored — it is inherited from the pelvis and translated by
    // knee flexion. pelvisPitch is what tweak depth moves.
    pelvisPitch: 0.78,
    kneeFront: 1.95, // 112 deg
    kneeBack: 1.83, // 105 deg — the <=10 deg front bias a real method has
    hipFlex: 0.35,
    tweakRoll: 0.5, // the lesser roll, so the base turns toward the camera
    freeArmRaise: 1, // trailing arm thrown skyward
    headYaw: 0.35, // gaze back over the lead shoulder
    headPitch: 0.38, // ~22° of neck extension
    kneeSplay: 2.4, // past pi/2: knees break back toward the heel edge, not forward
    stanceScale: 1.0,
  }),

  /** Tail press: hips back over the tail, front leg extended. */
  tailPress: pose({
    hipZ: -0.3,
    hipY: -0.1,
    pelvisPitch: 0.2,
    spineBend: 0.2,
    spineSide: -0.3,
  }),
};

export const ANCHOR_NAMES = Object.keys(ANCHORS);
