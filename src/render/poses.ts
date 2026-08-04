import { neutralDrivers, type RigDrivers } from './rig.ts';

/**
 * Anchor poses (design §7.8). Presets of the driver vector, not skeleton keyframes —
 * invariant 3 permits them precisely because they stay composable. If one ever needs a
 * *timeline*, it has become a clip and the invariant broke.
 *
 * **Deliberately reset to grab coordinates only.** Every body pose in here was previously
 * my guess, and each one measured inside its bands while reading as a crash. What is
 * factual is the grab coordinate — which hand, which edge, where along the board — and that
 * comes from `grabs.md`. The pose is the author's to build on the sliders and save.
 *
 * So each grab below sets `(hand, edge, t, grip)` and nothing else. The body stays neutral.
 * Pick one, pose it, `save pose`, and the JSON can come back in here as a real anchor.
 */
function pose(overrides: Partial<RigDrivers>): RigDrivers {
  return { ...neutralDrivers(), ...overrides };
}

export const ANCHORS: Record<string, RigDrivers> = {
  /** Standing, no grab. Authored. The zero everything else departs from. */
  neutral: pose({
    frontHandEdge: 0.26,
    frontHandT: 0.36,
    backHandEdge: 0.02,
    backHandT: 0.36,
    frontShoulderSwing: -0.24,
    frontShoulderOut: -0.19,
    frontElbow: 0.54,
    frontElbowPole: -3.1,
    backShoulderSwing: -0.08,
    backShoulderOut: -0.27,
    backElbow: 0.62,
    backElbowPole: -0.2,
  }),

  /** Knees deep, weight centred — the pop wind-up. Authored. */
  crouch: pose({
    hipY: -0.34,
    spineBend: 0.42,
    kneeSplay: 0.62,
    frontShoulderSwing: 0.08,
    frontShoulderOut: 0.23,
    frontElbow: 0,
    backShoulderSwing: 0.41,
    backShoulderOut: -0.3,
    backElbow: 0,
  }),

  // --- grab coordinates, bodies unposed (grabs.md §3) -------------------------------
  // `t` runs tail 0 to nose 1. `edge` is −1 heel, +1 toe, matching state.edge's sign.

  /** Back hand, toe edge, t ≈ 0.38. Authored. The easiest grab — the toe edge comes up to it. */
  indy: pose({
    hipX: 0.21,
    hipY: -0.6, // the 6 cm that closed the reach
    hipZ: -0.13,
    hipYaw: 0.23,
    pelvisPitch: 0.08,
    hipRoll: -0.3,
    spineBend: 0.42,
    spineSide: -0.04,
    spineTwist: 0.42,
    backHandEdge: 1,
    backHandT: 0.38,
    backGrip: 1,
    frontHandEdge: -0.04,
    frontHandT: 0.33,
    boardPitch: -0.16,
    headYaw: 0.18,
    headPitch: -0.07,
    frontShoulderSwing: 0,
    frontShoulderOut: -0.22,
    frontElbow: 1.05,
    frontElbowPole: 2.83, // the free arm routed round, which is what the pole is for
    backShoulderSwing: 0.49,
  }),

  /**
   * Front hand, toe edge, t ≈ 0.54. **Authored on the sliders, not derived** — these are the
   * author's numbers, saved out of pose mode, and they are the record. The first anchor in
   * here that is a pose rather than a reconstruction of what one should measure.
   *
   * Note `backGrip` at 0.25: the free hand is drawn a quarter of the way toward a point near
   * the tail rather than left where the arm joints put it. Partial grip works as a hand
   * placement control, which was not what it was built for but is a fair use of it.
   */
  mute: pose({
    hipX: 0.1,
    hipY: -0.62,
    hipZ: -0.12,
    hipYaw: -0.16,
    pelvisPitch: -0.31,
    hipRoll: -0.35,
    spineBend: 0.38,
    // Flipped from +0.35: the earlier lean toward the nose was buying reach the long way
    // round, and this pass gets it from the pelvis and the shoulder instead.
    spineSide: -0.1,
    spineTwist: -0.52, // toward the tail, which is what grabs.md asks a mute for
    frontHandEdge: 1,
    frontHandT: 0.54,
    frontGrip: 1,
    backHandEdge: -0.24,
    backHandT: 0.16,
    backGrip: 0.25,
    boardPitch: 0.34,
    tweakRoll: 0.17,
    headYaw: 0.37,
    headPitch: -0.07,
    kneeSplay: 0.48,
    stanceScale: 1.01,
    // Front arm authored through the shoulder rather than left where the hand target put it.
    frontShoulderSwing: -0.12,
    frontShoulderOut: -0.48,
    frontElbow: 0.73,
    frontElbowPole: -0.2,
    backShoulderSwing: 0.93,
    backShoulderOut: -0.71,
    backElbow: 1.87,
  }),

  /**
   * Front hand, heel edge, t ≈ 0.55. Authored. Board under the rider rather than behind.
   * Re-authored: the front arm is now steered through its own shoulder rather than left to
   * fall out of the hand target, and the trailing arm is up and out as the counterweight.
   */
  melon: pose({
    hipX: 0.05,
    hipY: -0.71,
    hipZ: -0.21,
    hipYaw: 0.03,
    pelvisPitch: 0.24,
    spineBend: 0.17,
    spineTwist: 0.23,
    frontHandEdge: -1,
    frontHandT: 0.55,
    frontGrip: 1,
    backHandEdge: -0.35,
    backHandT: 0.26,
    boardPitch: 0.31,
    tweakRoll: 0.35,
    frontShoulderSwing: -0.6,
    frontShoulderOut: -1,
    frontElbow: 0.65,
    frontElbowPole: -0.47,
    backShoulderSwing: 1.25,
    backShoulderOut: -0.58,
  }),

  /**
   * Front hand, heel edge. Authored — and note the author put `t` at 0.83, well toward the
   * nose, not the 0.5 the reference predicted and not melon's coordinate either. So the
   * "method and melon are the same grab" claim does not survive contact with the sliders:
   * this method reaches much further forward. Worth reconciling in `grabs.md` rather than
   * assuming the doc was right and the pose wrong.
   */
  method: pose({
    hipX: -0.2,
    hipY: -0.52,
    hipYaw: 1.17,
    pelvisPitch: 0.28,
    hipRoll: 0.21,
    spineBend: 0.76,
    spineSide: 0.33,
    spineTwist: 0.21,
    frontHandEdge: -1,
    frontHandT: 0.83,
    frontGrip: 1,
    boardPitch: 0.55,
    tweakRoll: 0.72,
    headYaw: 0.21,
    headPitch: -0.16,
    kneeSplay: 0.34,
    backShoulderSwing: 2.62, // the trailing arm up, which is what a method's counterweight is
    backShoulderOut: -0.58,
    backElbow: 0.28,
    backElbowPole: -0.27,
  }),

  /** Back hand, heel edge, t ≈ 0.4, arm behind the back leg. Authored. */
  stalefish: pose({
    hipX: -0.03,
    hipY: -0.63, // 23 cm lower than the first pass — this is what the 1.40 reach cost
    hipZ: -0.08,
    hipYaw: -0.39,
    pelvisPitch: 0.26,
    hipRoll: -0.35,
    spineBend: 0.17,
    spineSide: -0.04,
    spineTwist: -0.47,
    backHandEdge: -1,
    backHandT: 0.39,
    backGrip: 1,
    frontHandEdge: -0.46,
    frontHandT: 0.29,
    boardPitch: -0.18, // flipped sign from the second pass: tail down, not nose down
    tweakRoll: 1,
    headPitch: 0.02,
    kneeSplay: 0.53,
    frontShoulderSwing: 0.57,
    frontShoulderOut: -0.48,
    frontElbow: 0.85,
    frontElbowPole: -2.49, // free arm routed the other way round from the first pass
    backShoulderSwing: 0.89,
  }),

  /**
   * Front hand at the **nose tip** — `t` is 1.0, the very end. Authored. This is the pose the
   * edge taper existed for: at `t` = 1 the two splines have met, so `frontHandEdge` is inert
   * here and the hand lands on the centre line whatever it says. The saved 1 is kept because
   * it is what the author's slider read, not because it does anything.
   */
  nosegrab: pose({
    hipX: -0.06,
    hipY: -0.75,
    hipZ: 0.13,
    pelvisPitch: 0.18,
    hipRoll: -0.05,
    spineBend: 0.31,
    spineSide: 0.25, // leaning toward the nose, chasing the hand out
    spineTwist: 0.47,
    frontHandEdge: 1,
    frontHandT: 1,
    frontGrip: 1,
    backHandEdge: 0,
    backHandT: 0.34,
    boardPitch: 0.36,
    tweakRoll: -0.28,
    headYaw: 0.61,
    headPitch: -0.07,
    kneeSplay: 0.5,
    frontElbowPole: -0.2,
    backShoulderSwing: 0.53, // free arm brought down and in from the first pass
    backShoulderOut: -0.09,
    backElbow: 0.42,
    backElbowPole: 0.13,
  }),

  /**
   * Back hand at the **tail tip** — `t` is 0, the mirror coordinate to nosegrab, and `edge` is
   * inert for the same reason.
   *
   * Not a mirrored pose though. `boardPitch` is −0.18 against nosegrab's +0.36, so the board
   * tips the other way, and the spine is dead flat: `spineBend` and `spineTwist` are both
   * exactly 0, the only anchor with no twist at all. My earlier guess in this slot claimed the
   * spine extends here — the sliders say it just stays square, and the pose is the record.
   */
  tailgrab: pose({
    hipX: 0.08,
    hipY: -0.67,
    hipZ: -0.01,
    pelvisPitch: -0.05,
    hipRoll: -0.38,
    spineSide: -0.08,
    frontHandEdge: 0,
    frontHandT: 0.13,
    backHandEdge: 1,
    backHandT: 0,
    backGrip: 1,
    boardPitch: -0.18,
    tweakRoll: -0.2,
    headYaw: -0.49,
    headPitch: -0.12,
    kneeSplay: 0.53,
    frontShoulderSwing: -0.16,
    frontShoulderOut: -0.5,
    frontElbow: 1.07,
    frontElbowPole: 2.96, // free arm routed right round, same trick as indy and stalefish
  }),

  /** Front hand, toe edge, t ≈ 0.54. Authored. Toe-side cousin of the method. */
  japan: pose({
    hipX: -0.04,
    hipY: -0.62,
    hipZ: -0.29,
    hipYaw: 0.05,
    pelvisPitch: 0.12,
    hipRoll: 0.66,
    spineBend: 0.07,
    spineSide: -0.24,
    // Twist went −1.02, then +0.47, and settled near square. The −1.02 wound the shoulders
    // away from the grabbing hand, which is what had it 10% out of reach.
    spineTwist: -0.1,
    frontHandEdge: 1,
    frontHandT: 0.55,
    frontGrip: 1,
    backHandEdge: -0.39,
    backHandT: 0.29,
    boardPitch: 0.91,
    tweakRoll: 1,
    headYaw: 0.79,
    headPitch: -0.09,
    kneeSplay: 0.44,
    // The front arm authored through the shoulder, which only became possible once these
    // stopped being dead while gripping. This is the routing over the front leg.
    frontShoulderSwing: 1.37,
    frontShoulderOut: -1,
    frontElbow: 0.34,
    frontElbowPole: -0.74,
    backShoulderSwing: 1.93,
    backShoulderOut: -0.14,
    backElbow: 0.68,
    backElbowPole: -0.27,
  }),
};

export const ANCHOR_NAMES = Object.keys(ANCHORS);
