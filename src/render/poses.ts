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
    headYaw: 0.94, // looking down the hill rather than straight across the board
    frontShoulderSwing: -0.24,
    frontShoulderOut: -0.19,
    frontElbow: 0.54,
    frontElbowPole: -3.1,
    backShoulderSwing: -0.08,
    backShoulderOut: -0.27,
    backElbow: 0.62,
    backElbowPole: -0.2,
  }),

  /**
   * Knees deep, weight centred — the pop wind-up. Authored.
   *
   * Also the base of every grab transition (`blendToGrab` in main.ts), so changing it moves
   * all eight paths, not just this pose. Re-check the dense path sweep after touching it.
   */
  crouch: pose({
    hipX: 0.17,
    hipY: -0.34,
    hipZ: 0.01,
    hipYaw: 0.03,
    pelvisPitch: 0.4,
    hipRoll: 0,
    spineBend: 0.66,
    spineSide: -0.02,
    spineTwist: 0,
    spineCurl: 0.3,
    frontHandEdge: -0.09,
    frontHandT: 0.62,
    backHandEdge: 0,
    backHandT: 0.34,
    frontGrip: 0,
    backGrip: 0,
    boardPitch: 0,
    tweakRoll: 0,
    headYaw: 0.94,
    headPitch: 0,
    kneeSplay: 0.62,
    stanceScale: 1,
    frontShoulderSwing: 0.04,
    frontShoulderOut: -0.58,
    frontElbow: 0.88,
    frontElbowPole: -3.1,
    backShoulderSwing: 0.36,
    backShoulderOut: -0.71,
    backElbow: 0.62,
    backElbowPole: -0.68,
    shifty: 0,
  }),

  // --- rail slides (docs: slide plan) — first pass from reference photos, refine in pose
  // mode. Blended in play by how far across the rail the board is and where the contact
  // is (scene.ts); the balance lean rides on top, so a sketchy slide still reads.

  /**
   * Backside boardslide — board across the rail, travelling toward the toes. Authored by
   * you in pose mode. Its `shifty` (board yawed under the body) is how the body's turn
   * against the board was posed; in play the sim owns the board, so scene.ts applies it
   * as hip yaw instead. Board attitude and hand coordinates here only show in pose mode.
   */
  backsideBoardslide: pose({
    hipX: -0.13,
    hipY: -0.15,
    hipZ: 0,
    hipYaw: 0.05,
    pelvisPitch: 0.42,
    hipRoll: 0.37,
    spineBend: 0.77,
    spineSide: -0.59,
    spineTwist: 0.08,
    frontHandEdge: -0.8,
    frontHandT: 0.74,
    backHandEdge: 0,
    backHandT: 0.39,
    frontGrip: 0,
    backGrip: 0,
    boardPitch: 0.13,
    tweakRoll: 0.41,
    headYaw: 0.09,
    headPitch: -0.03,
    kneeSplay: 0.39,
    stanceScale: 1.07,
    frontShoulderSwing: 1.73,
    frontShoulderOut: 1.4,
    frontElbow: 0.48,
    frontElbowPole: -3.03,
    backShoulderSwing: -0.16,
    backShoulderOut: -1,
    backElbow: 0.4,
    backElbowPole: -0.2,
    shifty: -0.65,
  }),

  /**
   * Frontside boardslide — board across the rail, travelling toward the heels (blind).
   * Authored by you in pose mode; `shifty` as above.
   */
  frontsideBoardslide: pose({
    hipX: -0.04,
    hipY: -0.01,
    hipZ: 0.12,
    hipYaw: 0.03,
    pelvisPitch: -0.05,
    hipRoll: -0.03,
    spineBend: 0.28,
    spineSide: 0,
    spineTwist: 0.7,
    frontHandEdge: 0.22,
    frontHandT: 0.62,
    backHandEdge: 0,
    backHandT: 0.34,
    frontGrip: 0,
    backGrip: 0,
    boardPitch: 0.05,
    tweakRoll: 0,
    headYaw: 1.4,
    headPitch: 0.45,
    kneeSplay: 0.06,
    stanceScale: 0.97,
    frontShoulderSwing: 0.4,
    frontShoulderOut: -1,
    frontElbow: 0.28,
    frontElbowPole: -2.97,
    backShoulderSwing: -0.12,
    backShoulderOut: -0.9,
    backElbow: 0.3,
    backElbowPole: -0.2,
    shifty: -0.97,
  }),

  /**
   * Weight on the nose over the rail — nose press or noseslide. Chest and eyes over the
   * nose, front hand reaching toward it, back arm out toward the tail for balance. A tail
   * press is this mirrored.
   */
  press: pose({
    hipY: -0.18,
    pelvisPitch: 0.2,
    spineBend: 0.45,
    spineSide: 0.35,
    headYaw: 0.9,
    kneeSplay: 0.55,
    frontShoulderSwing: 0.7,
    frontShoulderOut: 0.8,
    frontElbow: 0.2,
    frontElbowPole: -3.1,
    backShoulderSwing: 0.2,
    backShoulderOut: 0.7,
    backElbow: 0.5,
    backElbowPole: -0.2,
  }),

  // --- grab coordinates, bodies unposed (grabs.md §3) -------------------------------
  // `t` runs tail 0 to nose 1. `edge` is −1 heel, +1 toe, matching state.edge's sign.

  /** Back hand, toe edge, t ≈ 0.43. Authored. The easiest grab — the toe edge comes up to it. */
  indy: pose({
    hipX: 0.21,
    hipY: -0.67, // was −0.6: the hand reaches the board, at rest and on the way in from the crouch
    hipZ: -0.11,
    hipYaw: 0.16,
    pelvisPitch: 0.16,
    hipRoll: -0.03,
    spineBend: 0.66,
    spineSide: -0.04,
    spineTwist: 0.42,
    spineCurl: -0.19,
    frontHandEdge: -0.28,
    frontHandT: 0.34,
    backHandEdge: 1,
    backHandT: 0.43,
    frontGrip: 0,
    backGrip: 1,
    boardPitch: -0.16,
    tweakRoll: 0,
    headYaw: 0.18,
    headPitch: -0.07,
    kneeSplay: 0.5,
    stanceScale: 1.06,
    frontShoulderSwing: 0.33,
    frontShoulderOut: -0.56,
    frontElbow: 0.51,
    frontElbowPole: -2.7,
    backShoulderSwing: 0.77,
    backShoulderOut: -0.14,
    backElbow: 0.37,
    backElbowPole: -3.1,
    shifty: -0.34,
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
    hipX: 0.2, // was 0.1
    hipY: -0.73, // was −0.68: with hipX and hipZ, the hand reaches the board (in play it was 13% short) and the knee stays above the deck
    hipZ: 0.04, // was −0.11
    hipYaw: -0.29,
    pelvisPitch: -0.21,
    hipRoll: -0.57,
    spineBend: 0.33,
    spineSide: -0.1,
    spineTwist: -0.34,
    spineCurl: 0,
    frontHandEdge: 1,
    frontHandT: 0.54,
    backHandEdge: -0.24,
    backHandT: 0.16,
    frontGrip: 1,
    backGrip: 0,
    boardPitch: 0.34,
    tweakRoll: -0.61,
    headYaw: 0.37,
    headPitch: -0.07,
    kneeSplay: 0.6,
    stanceScale: 1,
    frontShoulderSwing: 0.26,
    frontShoulderOut: -0.48,
    frontElbow: 0.73,
    frontElbowPole: -0.2,
    backShoulderSwing: 0.93,
    backShoulderOut: -0.71,
    backElbow: 1.87,
    backElbowPole: 0,
    shifty: 0.33,
    turn: 0.37,
  }),

  /**
   * Front hand, heel edge, t ≈ 0.55. Authored. Board under the rider rather than behind.
   * Re-authored: the front arm is now steered through its own shoulder rather than left to
   * fall out of the hand target, and the trailing arm is up and out as the counterweight.
   */
  melon: pose({
    hipX: 0.1, // was 0.05
    hipY: -0.65, // was −0.55: with hipX, the hand reaches the board (in play it was 8% short) and the knee stays above the deck
    hipZ: -0.29,
    hipYaw: -0.59,
    pelvisPitch: 0.65,
    hipRoll: -0.1,
    spineBend: 0.3,
    spineSide: 0.3,
    spineTwist: 0.81,
    spineCurl: 0,
    frontHandEdge: -1,
    frontHandT: 0.55,
    backHandEdge: -0.35,
    backHandT: 0.26,
    frontGrip: 1,
    backGrip: 0,
    boardPitch: 0.31,
    tweakRoll: 0.35,
    headYaw: 0.79,
    headPitch: 0,
    kneeSplay: 0.72,
    stanceScale: 1,
    frontShoulderSwing: -0.6,
    frontShoulderOut: -1,
    frontElbow: 0.65,
    frontElbowPole: -0.47,
    backShoulderSwing: 0.37,
    backShoulderOut: -0.82,
    backElbow: 0.78,
    backElbowPole: -0.3,
    shifty: -0.51,
    turn: 0,
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
    hipY: -0.72, // was −0.67: in play (shifty on the hips) the hand was 2% short
    hipZ: 0,
    hipYaw: 1.17,
    pelvisPitch: 0.48,
    hipRoll: 0.03,
    spineBend: 0.73,
    spineSide: 0.33,
    spineTwist: 0.21,
    spineCurl: 0,
    frontHandEdge: -1,
    frontHandT: 0.83,
    backHandEdge: 0,
    backHandT: 0.34,
    frontGrip: 1,
    backGrip: 0,
    boardPitch: 0.55,
    tweakRoll: 0.72,
    headYaw: 1.37,
    headPitch: -0.12,
    kneeSplay: 0.34,
    stanceScale: 1,
    frontShoulderSwing: 0.3,
    frontShoulderOut: -0.65,
    frontElbow: 0.61,
    frontElbowPole: -0.34,
    backShoulderSwing: 2.62,
    backShoulderOut: -0.58,
    backElbow: 0.28,
    backElbowPole: -0.27,
    shifty: -0.26,
    turn: -1.01,
  }),

  /** Back hand, heel edge, t ≈ 0.4, arm behind the back leg. Authored. */
  stalefish: pose({
    hipX: -0.03,
    hipY: -0.68,
    hipZ: -0.08,
    hipYaw: -0.39,
    pelvisPitch: -0.19,
    hipRoll: -0.35,
    spineBend: 0.17,
    spineSide: -0.04,
    spineTwist: -0.47,
    spineCurl: 0,
    frontHandEdge: -0.46,
    frontHandT: 0.29,
    backHandEdge: -1,
    backHandT: 0.39,
    frontGrip: 0,
    backGrip: 1,
    boardPitch: -0.18,
    tweakRoll: 1,
    headYaw: 1.02,
    headPitch: -0.03,
    kneeSplay: 0.53,
    stanceScale: 1,
    frontShoulderSwing: 1.49,
    frontShoulderOut: 0.38,
    frontElbow: 0.54,
    frontElbowPole: -2.97,
    backShoulderSwing: 0.89,
    backShoulderOut: -0.35,
    backElbow: 0.45,
    backElbowPole: 0,
    shifty: -0.05,
    turn: 0.7,
  }),

  /**
   * Front hand at the **nose tip** — `t` is 1.0, the very end. Authored. This is the pose the
   * edge taper existed for: at `t` = 1 the two splines have met, so `frontHandEdge` is inert
   * here and the hand lands on the centre line whatever it says. The saved 1 is kept because
   * it is what the author's slider read, not because it does anything.
   */
  nosegrab: pose({
    // Hips over toward the heel edge (was −0.06): folded this deep, the front knee broke ~10 cm
    // down through the deck ahead of the binding. Clear now; the lean and bend below keep the
    // hand on the nose.
    hipX: 0.11,
    hipY: -0.75,
    hipZ: 0.13,
    pelvisPitch: 0.18,
    hipRoll: -0.05,
    spineBend: 0.36,
    spineSide: 0.3, // leaning toward the nose, chasing the hand out
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
    backShoulderSwing: 0.93, // free arm brought down and in from the first pass
    backShoulderOut: -1,
    backElbow: 0.42,
    backElbowPole: 0.13,
  }),

  /** Back hand at the **tail tip** — `t` 0, the mirror coordinate to nosegrab. Authored: tail pulled
   * well down (boardPitch −0.55), body twisted back to it. */
  tailgrab: pose({
    hipX: 0.1,
    hipY: -0.65, // was −0.6: with spineSide below, the hand reaches the tail (was 8% short)
    hipZ: -0.02,
    hipYaw: 0.52,
    pelvisPitch: -0.46,
    hipRoll: -0.3,
    spineBend: 0.03,
    spineSide: -0.13, // was −0.08
    spineTwist: -0.65,
    spineCurl: 0.26,
    frontHandEdge: -0.13,
    frontHandT: 0.13,
    backHandEdge: 1,
    backHandT: 0,
    frontGrip: 0,
    backGrip: 1,
    boardPitch: -0.55,
    tweakRoll: -0.2,
    headYaw: 0.09,
    headPitch: 0.05,
    kneeSplay: 0.53,
    stanceScale: 1,
    frontShoulderSwing: 0.49,
    frontShoulderOut: -1,
    frontElbow: 1.07,
    frontElbowPole: -3.1,
    backShoulderSwing: 0.2,
    backShoulderOut: 0.2,
    backElbow: 0.59,
    backElbowPole: -0.81,
    shifty: 0.37,
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

// Stick model 2's own grabs. Placeholders: a neighbour's body with the hand moved to the
// grab's point on the board, until posed in pose mode. Board attitude matches the
// `grab.<name>Pitch/Roll` first guesses.
const base = (name: string): RigDrivers => ({ ...(ANCHORS[name] ?? neutralDrivers()) });
/** Front hand across the body to the toe edge at the tail. Authored (pose_10). */
ANCHORS.seatbelt = pose({
  hipX: 0.09,
  hipY: -0.67,
  hipZ: 0.04,
  hipYaw: -0.78,
  pelvisPitch: -0.27,
  hipRoll: -0.63,
  spineBend: 0.31,
  spineSide: 0.02,
  spineTwist: -0.42,
  spineCurl: -0.4,
  frontHandEdge: 1,
  frontHandT: 0.12,
  backHandEdge: -0.24,
  backHandT: 0.16,
  frontGrip: 1,
  backGrip: 0,
  boardPitch: -0.52,
  tweakRoll: -0.37,
  headYaw: 1.03,
  headPitch: 0.14,
  kneeSplay: 0.6,
  stanceScale: 1,
  frontShoulderSwing: -0.48,
  frontShoulderOut: -1,
  frontElbow: 0.54,
  frontElbowPole: -0.13,
  backShoulderSwing: 0.45,
  backShoulderOut: -1,
  backElbow: 1.07,
  backElbowPole: 0.27,
  shifty: 0.1,
  turn: 0.82,
});
/** Back hand to the toe edge near the nose. */
ANCHORS.crail = { ...base('indy'), backHandEdge: 1, backHandT: 0.85, frontGrip: 0, backGrip: 1, boardPitch: 0.3, tweakRoll: -0.2, turn: 0, shifty: 0 };
/** Front hand between the legs to the heel edge between the feet, front leg boned. */
ANCHORS.chickenSalad = { ...base('melon'), frontHandEdge: -1, frontHandT: 0.5, frontGrip: 1, backGrip: 0, boardPitch: 0.2, tweakRoll: 0.4, turn: 0, shifty: 0 };
/** Back hand between the legs to the heel edge between the feet. */
ANCHORS.roastBeef = { ...base('stalefish'), backHandEdge: -1, backHandT: 0.45, frontGrip: 0, backGrip: 1, boardPitch: -0.1, tweakRoll: 0.5, turn: 0, shifty: 0 };

export const ANCHOR_NAMES = Object.keys(ANCHORS);

/**
 * The drivers a grab contributes in play: where the body and the free arm go. The grabbing
 * hand, the grips and the board's attitude are not in here — those come from the sim's
 * grab, so an anchor can't disagree with the physics about where the hand is or how far
 * the board is out, and the landing test judges the board that is drawn.
 */
export const BODY_KEYS = (Object.keys(neutralDrivers()) as (keyof RigDrivers)[]).filter(
  (k) =>
    ![
      'frontHandEdge',
      'frontHandT',
      'backHandEdge',
      'backHandT',
      'frontGrip',
      'backGrip',
      'boardPitch',
      'tweakRoll',
      'shifty',
      'turn',
      'stanceScale',
    ].includes(k),
);

type GrabSpot = { pose: RigDrivers; edge: number; t: number; tweaked: RigDrivers | null };

/**
 * Where each grab anchor sits in (edge, t) grab space: its gripping hand's coordinate.
 * Derived from the anchors, so re-authoring one moves its spot with it. Two anchors on the
 * same spot are one grab untweaked and tweaked — japan is a shoved-out mute — and the one
 * with more board attitude becomes the other's tweaked variant.
 */
const SPOTS: GrabSpot[] = [];
// Stick models 0 and 1 blend these by (edge, t). Model 2's own grabs stay out: chicken
// salad and roast beef sit on melon's and stalefish's spots and would read as their twins.
const BLENDED = ['indy', 'mute', 'melon', 'method', 'stalefish', 'nosegrab', 'tailgrab', 'japan'];
for (const [name, pose] of Object.entries(ANCHORS)) {
  if (!BLENDED.includes(name) || Math.max(pose.frontGrip, pose.backGrip) <= 0) continue;
  const front = pose.frontGrip >= pose.backGrip;
  const edge = front ? pose.frontHandEdge : pose.backHandEdge;
  const t = front ? pose.frontHandT : pose.backHandT;
  const twin = SPOTS.find((s) => Math.abs(s.edge - edge) < 0.05 && Math.abs(s.t - t) < 0.05);
  if (!twin) {
    SPOTS.push({ pose, edge, t, tweaked: null });
    continue;
  }
  const size = (p: RigDrivers): number => Math.abs(p.boardPitch) + Math.abs(p.tweakRoll);
  if (size(pose) > size(twin.pose)) twin.tweaked = pose;
  else {
    twin.tweaked = twin.pose;
    twin.pose = pose;
  }
}
const weights = new Float64Array(SPOTS.length);

/**
 * Body pose for a grab at (`edge`, `t`), `tweak` deep. Inverse-square distance weights
 * (Shepard) over the spots: exact on a named grab — what was tuned in pose mode is what
 * plays — and a smooth mix between. `t` is doubled so a tail-to-nose move counts as much as
 * a heel-to-toe one. Reads the live anchors, so a pose written from pose mode shows up in
 * play immediately.
 */
export function grabBody(out: RigDrivers, edge: number, t: number, tweak: number): RigDrivers {
  let total = 0;
  for (let i = 0; i < SPOTS.length; i++) {
    const s = SPOTS[i];
    if (!s) continue;
    const de = edge - s.edge;
    const dt = (t - s.t) * 2;
    const w = 1 / (de * de + dt * dt + 1e-9); // guard only: on the spot, that anchor wins outright
    weights[i] = w;
    total += w;
  }
  for (const k of BODY_KEYS) {
    let v = 0;
    for (let i = 0; i < SPOTS.length; i++) {
      const s = SPOTS[i];
      if (!s) continue;
      let p = s.tweaked ? s.pose[k] + (s.tweaked[k] - s.pose[k]) * tweak : s.pose[k];
      // Posed against a board yawed under the body (`shifty`); in play the sim owns the
      // board, so the same relative turn goes on the hips, as the rail slides do (scene.ts).
      if (k === 'hipYaw') p -= s.tweaked ? s.pose.shifty + (s.tweaked.shifty - s.pose.shifty) * tweak : s.pose.shifty;
      v += p * (weights[i] ?? 0);
    }
    out[k] = v / total;
  }
  return out;
}

/** Stick model 2's tweaked siblings: full push on the first is the second's pose. */
const TWEAKED: Record<string, string> = { mute: 'japan' };

/**
 * Body pose for named grab `name`, `tweak` deep: that anchor exactly, blended toward its
 * tweaked sibling where it has one. Body keys only, like `grabBody`, with the posed shifty
 * moved onto the hips.
 */
export function namedGrabBody(out: RigDrivers, name: string, tweak: number): RigDrivers {
  const pose = ANCHORS[name];
  if (!pose) return out;
  const sibling = TWEAKED[name];
  const tweaked = sibling ? ANCHORS[sibling] : undefined;
  const w = tweaked ? tweak : 0;
  for (const k of BODY_KEYS) {
    const to = tweaked ? tweaked[k] : pose[k];
    out[k] = pose[k] + (to - pose[k]) * w;
  }
  const shifty = pose.shifty + ((tweaked ? tweaked.shifty : pose.shifty) - pose.shifty) * w;
  out.hipYaw -= shifty;
  return out;
}
