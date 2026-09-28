import { neutralDrivers, type RigDrivers } from './rig.ts';

/**
 * Anchor poses (design §7.8). These are presets of the driver vector, not skeleton
 * keyframes — invariant 3 permits them precisely because they stay composable: you can
 * be 60% of the way to `method` while spinning and pressing tail and it still resolves.
 * If one of these ever needs a *timeline*, it has become a clip and the invariant broke.
 *
 * Starting points, not finished poses. Tune them in pose mode against video reference,
 * including your own — "write to anchor" updates the live copy, "save pose" exports it
 * for pasting back here.
 */
function pose(overrides: Partial<RigDrivers>): RigDrivers {
  return { ...neutralDrivers(), ...overrides };
}

const anchors = {
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

export const ANCHORS: Record<string, RigDrivers> = anchors;
export const ANCHOR_NAMES = Object.keys(ANCHORS);

/**
 * The drivers a grab anchor contributes: where the body goes. Hands, grip and tweak are
 * not in here — those come from the sim's grab, so the anchor can't disagree with the
 * physics about where the hand is or how far the board is out.
 */
export const BODY_KEYS = [
  'hipX',
  'hipY',
  'hipZ',
  'hipYaw',
  'hipPitch',
  'hipRoll',
  'spineBend',
  'spineSide',
  'spineTwist',
  'headYaw',
  'headPitch',
  'kneeSplay',
  'boardLift',
] as const satisfies readonly (keyof RigDrivers)[];

/**
 * Body pose for a grab at `edge`, `tweak` deep. Toe side leans on indy, heel side on
 * melon, and a heel grab shoved out becomes a method — the same edge and hand as a melon,
 * which is exactly the difference (§2). Continuous in both, so between-grabs resolve.
 * Reads the live anchors, so a pose written from pose mode shows up in play immediately.
 */
export function grabBody(out: RigDrivers, edge: number, tweak: number): RigDrivers {
  const toe = Math.min(1, Math.max(0, (1 + edge) / 2));
  const methodness = (1 - toe) * tweak;
  for (const k of BODY_KEYS) {
    const grab = anchors.melon[k] + (anchors.indy[k] - anchors.melon[k]) * toe;
    out[k] = grab + (anchors.method[k] - grab) * methodness;
  }
  return out;
}
