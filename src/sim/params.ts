/**
 * Every number that affects feel. Flat groups of plain numbers so the tuning panel
 * can bind them generically and presets can serialize them wholesale.
 */
export const params = {
  world: {
    gravity: 16.0, // m/s² — above real 9.81 for snappier airtime
    terminalSpeed: 26.0, // m/s
  },
  ground: {
    gripFlat: 0.8, // 1/s lateral damping, flat base — skiddy
    gripEdge: 14.0, // 1/s lateral damping, full edge — locked carve
    gripCurve: 1.6, // exponent on |edge| between the two — the carve curve, tune first
    carveHold: 0.85, // 0..1 of scrubbed lateral speed handed back to forward
    carveYaw: 1.0, // rad/s at full edge, at plateau speed — design said 2.6, but see below
    speedFactorKnee: 6.0, // m/s where yaw authority reaches ~80%
    pivotSpeed: 2.5, // m/s below which skid-pivot is allowed
    pivotYaw: 1.1, // rad/s, low-authority skid pivot at a standstill
    drag: 0.0016, // quadratic, 1/m
    edgeDrag: 0.35, // fraction of scrubbed speed lost outright at full edge
    stanceYawGain: 0.55, // extra yaw authority at full nose/tail press
    stanceGripLoss: 0.35, // grip lost at full press
    brakeDecel: 9.0, // m/s² at full LT
    brakeGripLoss: 0.7, // grip lost at full LT — the scrub half of brake/scrub
    normalSmoothing: 12.0, // 1/s, board-to-terrain alignment rate
    edgeResponse: 9.0, // 1/s, stick-to-edge-angle rate
  },
  pop: {
    chargeTime: 0.25, // s to full compress
    decay: 0.4, // 1/s bleed after full
    base: 2.0, // m/s uncharged
    charged: 5.0, // m/s added at full charge
    stanceBias: 0.3, // ollie/nollie pop multiplier range
    trigger: 0.15, // RT above this counts as held; dropping below it releases
  },
  air: {
    detachClearance: 0.12, // m
    authority: 1.2, // 1/s, how fast in-air stick pulls spin toward its target
    tuckMultiplier: 1.25, // spin rate while grabbed
    extendMultiplier: 0.85, // spin rate while stretched
    spinMax: 9.0, // rad/s cap
    axisTiltMax: 1.1, // rad, max cork axis lerp
    spinTakeoff: 7.0, // rad/s at full whip on takeoff
    /**
     * 0..1, how much of a held carve is discounted from the takeoff stick read. At 0 the
     * stick position sets spin, which means a hard carve *is* a request for a 360 whether
     * or not you wanted one. At 1 only a whip beyond the carve counts.
     */
    spinCarveReject: 1.0,
    spinRefRate: 5.0, // 1/s the carve baseline follows the stick — lower widens the whip window
    spinArmBand: 0.25, // |stick| below this arms in-air spin control after takeoff
  },
  land: {
    clean: 0.44, // rad ≈ 25°
    sketchy: 0.87, // rad ≈ 50°
    rollClean: 0.35, // rad, board-up vs contact normal
    sketchySpeedLoss: 0.25, // fraction
    absorbTime: 0.22, // s
    headingSnap: 18.0, // 1/s, heading correction onto velocity — fast, but not a teleport
  },
  bail: {
    drag: 16.0, // m/s² while tumbling
    recoverSpeed: 2.5, // m/s below which the rider gets back up
    minTime: 0.9, // s before recovery is allowed at all
    tumbleRate: 8.0, // rad/s, visual tumble while down
  },
  rail: {
    captureRadius: 0.35, // m
    captureAngle: 0.6, // rad
    friction: 0.4, // m/s² along spline
    driftBase: 0.9, // balance drift rate
    balanceMax: 1.0,
    correctionGain: 2.2,
  },
  wall: {
    minAngle: 1.13, // rad ≈ 65° from up
    minSpeed: 8.0, // m/s
    gravityScale: 0.35,
    drag: 3.0, // m/s² while walled
  },
  butter: {
    threshold: 0.65, // |stance|
    maxSpeed: 12.0, // m/s
    grip: 0.3, // multiplier on gripEdge
    yawAuthority: 3.2, // rad/s
  },
  /**
   * Grab timing. `reach` and `release` are the real feel numbers — the rate the rider blends
   * toward an anchor and back — and gameplay will use them unchanged once grabs are wired.
   * `hold` only exists for the pose-mode preview, where nothing is holding a button.
   */
  grab: {
    reachTime: 0.18, // s, crouch to full grab
    holdTime: 0.4, // s at full grab — preview envelope only, gameplay holds while held
    releaseTime: 0.14, // s, grab back to crouch. Quicker than the reach: you snap back to land
    /**
     * 0..1 of the body blend completed before the hand starts closing on the board. Without
     * it every grab passes through an unreachable pose mid-transition, because crouch is a
     * shallower crouch than any grab and the halfway body is further from the board than
     * either end. Raise it if an arm still snaps on the way in.
     *
     * 0.75 is measured, not guessed: it is the lowest value at which all eight grabs stay
     * under reach 1.0 across the whole path. At 0.65 melon still peaks at 1.01, and at 0 every
     * single grab is invalid somewhere in the middle.
     */
    gripDelay: 0.75,
    /**
     * Reach above this tints the arm amber in pose mode; above 1.0 it goes red.
     *
     * The red-only overlay was a cliff, and it turned out to *teach* posing at the limit: you
     * push a slider until the red just disappears and stop, which lands you on the boundary.
     * Six of the eight authored grabs came back between 0.97 and 1.00, one at 0.9994. That is
     * the worst place to be — at full extension the elbow is confined to a few centimetres and
     * the arm cannot route around anything. Amber marks "valid but no margin left".
     *
     * 0.90 lights every current anchor amber, and that is the honest answer rather than a
     * broken threshold: the eight run 0.934 to 0.999, so the whole set really is at full
     * extension. Do not raise this to make the indicator look discriminating — that is fitting
     * the instrument to the data. Real elbow freedom wants 0.85 or below (17 cm of pole radius
     * against 12 cm at 0.93), so if the amber ever goes away it means the poses improved.
     */
    reachWarn: 0.9,
  },
  rig: {
    thigh: 0.44, // m
    shin: 0.44, // m
    upperArm: 0.33, // m
    forearm: 0.33, // m, to the grip rather than the wrist — 0.66 total, adult shoulder-to-grip
    hipWidth: 0.18, // m between leg roots
    shoulderWidth: 0.36, // m between arm roots, along the board
    stanceWidth: 0.52, // m between bindings
    hipHeight: 0.86, // m above the deck, uncompressed
    spine: 0.52, // m hips to shoulders
    neck: 0.16, // m shoulders to head
    crouchDepth: 0.28, // m the hips drop at full compress
    /**
     * rad of board-vs-clean-frame at full tweak. A method wants 70–100°; at the old 1.15
     * (66°) the board could not physically reach the angle that makes one, so tweak looked
     * like a weak lean however far you pushed it. Anatomy still clamps below this.
     */
    tweakMax: 1.75,
    /**
     * rad of roll about the board's own long axis at full `tweakRoll` — the base turning to
     * face away from the rider. Deliberately much smaller than `tweakMax`: the roll is part
     * of the look but a method is predominantly a pitch, and one scalar driving both meant
     * retuning either moved the other.
     */
    tweakRollMax: 0.6,
    hipStiffness: 250.0, // ω² for the hip spring — ω = sqrt of this, so 250 is ~15.8 rad/s
    hipDamping: 1.0, // ζ — 1.0 is critically damped
  },
  spray: {
    rate: 900, // particles/s at full scrub
    scrubRef: 18.0, // m/s² of edge scrub that saturates emission — measured carve range is 3..23
    life: 0.5, // s
    launch: 3.4, // m/s away from the edge
    spread: 2.2, // m/s random scatter
    rise: 1.6, // m/s upward bias
    size: 0.16, // m
    gravity: 6.0, // m/s²
  },
  audio: {
    /**
     * Muted for now — not wanted at this stage. Every layer and the landing thump run through
     * this one gain, so 0 silences the lot, and the slider brings it back live without a
     * reload. Was 0.55.
     */
    master: 0,
    edgeGain: 0.5, // edge bite at full scrub
    edgeFilterBase: 380, // Hz at a standstill
    edgeFilterGain: 95, // Hz per m/s
    edgeQ: 4.0,
    baseGain: 0.22, // base chatter on snow
    baseFilter: 700, // Hz lowpass
    windGain: 0.4,
    windSpeedRef: 22.0, // m/s where wind is full
    thumpGain: 0.7, // landing thump at full impact
    thumpRef: 12.0, // m/s of normal impact that saturates the thump
    thumpFilter: 220, // Hz lowpass — a thud, not a crack
    thumpDecay: 0.28, // s
  },
  camera: {
    springStiffness: 9.0,
    distance: 5.5, // m, behind the rider along heading
    height: 1.8, // m, along the contact normal
    lookAhead: 6.0, // m down the fall line — keeps the slope in frame, not the sky
    fovBase: 62, // deg
    fovSpeedGain: 0.5, // deg per m/s
    rollGain: 0.18, // rad per unit edge
  },
};

export type Params = typeof params;
export type ParamGroup = keyof Params;

export function cloneParams(src: Params): Params {
  return JSON.parse(JSON.stringify(src)) as Params;
}

/** Overwrite `target` in place so live references (sim, panel) see the new values. */
export function applyParams(target: Params, src: Params): void {
  for (const group of Object.keys(target) as ParamGroup[]) {
    const dstGroup = target[group] as Record<string, number>;
    const srcGroup = src[group] as Record<string, number> | undefined;
    if (!srcGroup) continue;
    for (const key of Object.keys(dstGroup)) {
      const value = srcGroup[key];
      if (typeof value === 'number') dstGroup[key] = value;
    }
  }
}

/** The values as authored, captured at load before any tuning session mutates `params`. */
const DEFAULTS = cloneParams(params);

/**
 * Params for replaying a serialized take or preset. What it recorded wins; groups that did
 * not exist when it was recorded fall back to the authored defaults — the v1 takes predate
 * `params.rig` entirely. The fallback is the defaults and never the live values, so a take
 * stays immune to the tuning session it is being replayed inside of.
 */
export function withDefaults(src: Params): Params {
  const merged = cloneParams(DEFAULTS);
  applyParams(merged, src);
  return merged;
}
