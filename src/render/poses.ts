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
   * Heel grab near mid-board, full tail stance, back arched, board yanked out behind.
   * The pose the gate is about.
   */
  method: pose({
    hipX: 0.14,
    hipY: -0.14,
    hipZ: -0.11,
    hipRoll: -0.2,
    boardLift: 0.56,
    spineBend: -0.45, // toward the heel side — the arch, not a fold over the toes
    spineSide: -0.22,
    spineTwist: 0.3,
    frontHandEdge: -1,
    frontHandT: 0.52,
    frontGrip: 1,
    tweak: 0.85,
    headYaw: 0.3,
    headPitch: 0.1,
    kneeSplay: 0.45,
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
