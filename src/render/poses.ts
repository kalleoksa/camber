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
  /** Standing, no grab, knees lightly flexed. The zero everything else departs from. */
  neutral: neutralDrivers(),

  /** Knees deep, weight centred — the pop wind-up. Body pose, no grab, so it survives. */
  crouch: pose({
    hipY: -0.34,
    spineBend: 0.42,
    kneeSplay: 0.62,
  }),

  // --- grab coordinates, bodies unposed (grabs.md §3) -------------------------------
  // `t` runs tail 0 to nose 1. `edge` is −1 heel, +1 toe, matching state.edge's sign.

  /** Back hand, toe edge, t ≈ 0.35. The easiest grab — the toe edge comes to the hand. */
  indy: pose({ backHandEdge: 1, backHandT: 0.35, backGrip: 1 }),

  /** Front hand, toe edge, t ≈ 0.55. Same edge as indy, opposite hand, compact and square. */
  mute: pose({ frontHandEdge: 1, frontHandT: 0.55, frontGrip: 1 }),

  /** Front hand, heel edge, t ≈ 0.5. Board under the rider rather than behind. */
  melon: pose({ frontHandEdge: -1, frontHandT: 0.5, frontGrip: 1 }),

  /**
   * Front hand, heel edge, t ≈ 0.5 — the *identical coordinate to melon*. Everything that
   * separates them is body pose: spine extension and the board behind rather than under.
   * That is the whole argument for grab and tweak being separate systems, and it is why
   * this entry can be a copy of melon without being a duplicate.
   */
  method: pose({ frontHandEdge: -1, frontHandT: 0.5, frontGrip: 1 }),

  /** Back hand, heel edge, t ≈ 0.35, arm behind the back leg. */
  stalefish: pose({ backHandEdge: -1, backHandT: 0.35, backGrip: 1 }),

  /** Front hand, t ≈ 0.9. The one grab family where the spine flexes rather than extends. */
  nosegrab: pose({ frontHandEdge: 1, frontHandT: 0.9, frontGrip: 1 }),

  /** Back hand, t ≈ 0.05. Geometrically nosegrab's mirror, but the spine extends. */
  tailgrab: pose({ backHandEdge: 1, backHandT: 0.05, backGrip: 1 }),

  /** Front hand, toe edge, t ≈ 0.65, ahead of the front binding. Toe-side cousin of method. */
  japan: pose({ frontHandEdge: 1, frontHandT: 0.65, frontGrip: 1 }),
};

export const ANCHOR_NAMES = Object.keys(ANCHORS);
