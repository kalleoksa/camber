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

  /** Front hand, toe edge, just ahead of centre. Folded over the toes. */
  mute: pose({
    hipY: -0.18,
    hipX: -0.06,
    boardLift: 0.5,
    spineBend: 0.45,
    spineTwist: 0.15,
    frontHandEdge: 1,
    frontHandT: 0.55,
    frontGrip: 1,
    headPitch: -0.1,
    kneeSplay: 0.6,
  }),

  /** Back hand, heel edge, behind the back binding. Reaching back between the legs. */
  stalefish: pose({
    hipY: -0.15,
    hipX: 0.06,
    hipZ: 0.05,
    boardLift: 0.5,
    spineBend: -0.3,
    spineSide: 0.1,
    spineTwist: -0.25,
    backHandEdge: -1,
    backHandT: 0.3,
    backGrip: 1,
    kneeSplay: 0.55,
  }),

  /** Front hand on the nose, board pulled up to it. */
  nose: pose({
    hipY: -0.12,
    hipZ: 0.12,
    hipPitch: 0.1,
    boardLift: 0.45,
    spineBend: 0.2,
    spineSide: 0.35,
    frontHandEdge: 0,
    frontHandT: 0.92,
    frontGrip: 1,
  }),

  /** Back hand on the tail. */
  tail: pose({
    hipY: -0.12,
    hipZ: -0.12,
    hipPitch: -0.1,
    boardLift: 0.45,
    spineBend: 0.2,
    spineSide: -0.35,
    backHandEdge: 0,
    backHandT: 0.06,
    backGrip: 1,
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
 * Where each grab anchor sits in the 2D grab space (§7.3). Method is not in here: it is
 * the same spot as melon with the board shoved out, so it rides on melon's weight.
 */
const GRAB_SPOTS = [
  { pose: anchors.indy, edge: 1, t: 0.35 },
  { pose: anchors.mute, edge: 1, t: 0.55 },
  { pose: anchors.melon, edge: -1, t: 0.5 },
  { pose: anchors.stalefish, edge: -1, t: 0.3 },
  { pose: anchors.nose, edge: 0, t: 0.92 },
  { pose: anchors.tail, edge: 0, t: 0.06 },
];
const weights = new Float64Array(GRAB_SPOTS.length);

/**
 * Body pose for a grab at (`edge`, `t`), `tweak` deep. Inverse-square distance weights
 * (Shepard) over the anchors: exact on a named grab — what you tuned is what you get —
 * and a smooth mix between two — nobody reaches for "a mute", they reach for a spot (§7.3).
 * `t` is doubled so a tail-to-nose move counts as much as a heel-to-toe one. Reads the
 * live anchors, so a pose written from pose mode shows up in play immediately.
 */
export function grabBody(out: RigDrivers, edge: number, t: number, tweak: number): RigDrivers {
  let total = 0;
  for (let i = 0; i < GRAB_SPOTS.length; i++) {
    const spot = GRAB_SPOTS[i];
    if (!spot) continue;
    const de = edge - spot.edge;
    const dt = (t - spot.t) * 2;
    const w = 1 / (de * de + dt * dt + 1e-9); // guard only: on the spot, that anchor wins outright
    weights[i] = w;
    total += w;
  }
  for (const k of BODY_KEYS) {
    let v = 0;
    for (let i = 0; i < GRAB_SPOTS.length; i++) {
      const spot = GRAB_SPOTS[i];
      if (!spot) continue;
      let p = spot.pose[k];
      // A shoved-out melon is a method.
      if (spot.pose === anchors.melon) p += (anchors.method[k] - p) * tweak;
      v += p * (weights[i] ?? 0);
    }
    out[k] = v / total;
  }
  return out;
}
