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
    hipX: 0.17,
    hipY: -0.49,
    hipZ: -0.01,
    hipYaw: 0.23,
    pelvisPitch: 0.08,
    hipRoll: -0.26,
    spineBend: 0.66,
    spineTwist: 0.18,
    backHandEdge: 1,
    backHandT: 0.38,
    backGrip: 1,
    frontHandEdge: -0.04,
    frontHandT: 0.33,
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
    hipX: 0.07,
    hipY: -0.5,
    hipZ: -0.09,
    pelvisPitch: -0.17,
    hipRoll: -0.17,
    spineBend: 0.21,
    spineSide: 0.18,
    spineTwist: -0.52, // toward the tail, which is what grabs.md asks a mute for
    frontHandEdge: 1,
    frontHandT: 0.54,
    frontGrip: 1,
    backHandEdge: -0.24,
    backHandT: 0.16,
    backGrip: 0.25,
    headYaw: 0.37,
    headPitch: -0.07,
    kneeSplay: 0.5,
    stanceScale: 1.01,
    frontShoulderSwing: 1.01,
    frontShoulderOut: 0.57,
    frontElbow: 0.5,
    backShoulderSwing: 0.93,
    backShoulderOut: -0.71,
    backElbow: 1.87,
  }),

  /** Front hand, heel edge, t ≈ 0.5. Board under the rider rather than behind. */
  melon: pose({ frontHandEdge: -1, frontHandT: 0.5, frontGrip: 1 }),

  /**
   * Front hand, heel edge, t ≈ 0.5 — the *identical coordinate to melon*. Everything that
   * separates them is body pose: spine extension and the board behind rather than under.
   * That is the whole argument for grab and tweak being separate systems, and it is why
   * this entry can be a copy of melon without being a duplicate.
   */
  method: pose({ frontHandEdge: -1, frontHandT: 0.5, frontGrip: 1 }),

  /** Back hand, heel edge, t ≈ 0.4, arm behind the back leg. Authored. */
  stalefish: pose({
    hipX: -0.06,
    hipY: -0.4,
    hipZ: -0.08,
    hipYaw: -0.39,
    pelvisPitch: 0.08,
    hipRoll: -0.23,
    spineBend: 0.21,
    spineSide: -0.02,
    spineTwist: -0.23,
    backHandEdge: -1,
    backHandT: 0.4,
    backGrip: 1,
    frontHandEdge: -0.26,
    frontHandT: 0.61,
    headYaw: -0.09,
    headPitch: -0.16,
    kneeSplay: 0.3,
    frontShoulderSwing: -0.32,
    frontShoulderOut: -0.35,
    frontElbow: 0.82,
    frontElbowPole: 2.29,
    backShoulderSwing: 1.17,
  }),

  /** Front hand, t ≈ 0.9. The one grab family where the spine flexes rather than extends. */
  nosegrab: pose({ frontHandEdge: 1, frontHandT: 0.9, frontGrip: 1 }),

  /** Back hand, t ≈ 0.05. Geometrically nosegrab's mirror, but the spine extends. */
  tailgrab: pose({ backHandEdge: 1, backHandT: 0.05, backGrip: 1 }),

  /** Front hand, toe edge, t ≈ 0.65, ahead of the front binding. Toe-side cousin of method. */
  japan: pose({ frontHandEdge: 1, frontHandT: 0.65, frontGrip: 1 }),
};

export const ANCHOR_NAMES = Object.keys(ANCHORS);
