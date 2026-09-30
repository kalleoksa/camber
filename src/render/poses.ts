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
    spineBend: 0.56,
    spineSide: 0.02,
    spineTwist: 0.03,
    frontHandEdge: -0.09,
    headYaw: 0.94,
    kneeSplay: 0.62,
    frontShoulderSwing: 0.04,
    frontShoulderOut: -0.58,
    frontElbow: 0.88,
    frontElbowPole: -3.1,
    backShoulderSwing: 0.36,
    backShoulderOut: -0.71,
    backElbow: 0.62,
    backElbowPole: -0.68,
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
    frontElbowPole: -3.45, // the free arm routed round, which is what the pole is for (was 2.83: same angle, −2π, so blends from neutral's −π take the short way)
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
    /**
     * Authored at −0.62, dropped 1 cm. At −0.62 the endpoint was reach 0.9994 and the
     * *transition* peaked at 1.0028 — invalid by under 2 mm of arm, for a few frames, which
     * the two-decimal readout rounded to a passing 1.00. One centimetre here takes the path
     * peak to 0.9900. The alternative was raising gripDelay to 0.90 globally, which barely
     * cleared and would snap every other grab's hand shut over the last tenth of its blend.
     */
    hipY: -0.63,
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
    backShoulderSwing: 0.93, // free arm brought down and in from the first pass
    backShoulderOut: -1,
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
    frontElbowPole: -3.32, // free arm routed right round, same trick as indy and stalefish (was 2.96, −2π as above)
    spineBend: 0,
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
for (const [name, pose] of Object.entries(ANCHORS)) {
  if (name === 'neutral' || name === 'crouch' || Math.max(pose.frontGrip, pose.backGrip) <= 0) continue;
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
      const p = s.tweaked ? s.pose[k] + (s.tweaked[k] - s.pose[k]) * tweak : s.pose[k];
      v += p * (weights[i] ?? 0);
    }
    out[k] = v / total;
  }
  return out;
}
