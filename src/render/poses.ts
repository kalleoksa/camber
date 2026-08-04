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
    boardLift: 0.5,
    spineBend: 0.4,
    spineTwist: -0.22,
    backHandEdge: 1,
    backHandT: 0.35,
    backGrip: 1,
    tweak: 0.25,
    headPitch: -0.15,
    kneeSplay: 0.6,
  }),

  /** Front hand, heel edge, mid-board. Boned out toward the nose. */
  melon: pose({
    hipY: -0.15,
    hipX: 0.08,
    hipZ: -0.1,
    boardLift: 0.5,
    spineBend: -0.4,
    spineSide: 0.14,
    spineTwist: 0.2,
    frontHandEdge: -1,
    frontHandT: 0.5,
    frontGrip: 1,
    tweak: 0.4,
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
   *   2. knees flex, heels toward glutes — this is what brings the board up and behind
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
    hipRoll: -0.2,
    boardLift: 0.34,
    // ~49° of spine extension, lumbar plus thoracic. Negative is toward the heel side,
    // which for a rider facing the toe edge is backwards — an arch, not a fold.
    spineBend: -1.0, // their +0.92 in the grab reference — that doc's sign is inverted
    spineSide: -0.12,
    spineTwist: 0.35, // ~20° of counter-rotation against the board, which *is* the arch
    frontHandEdge: -1, // heel edge
    frontHandT: 0.5, // between the bindings — identical to melon
    frontGrip: 1,
    tweak: 0.85, // ~85° of board vs clean frame at tweakMax 1.75
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
    hipPitch: -0.2,
    spineBend: 0.2,
    spineSide: -0.3,
  }),
};

export const ANCHOR_NAMES = Object.keys(ANCHORS);
