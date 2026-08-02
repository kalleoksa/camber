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
    chargeTime: 0.35, // s to full compress
    decay: 0.4, // 1/s bleed after full
    base: 2.0, // m/s uncharged
    charged: 5.0, // m/s added at full charge
    stanceBias: 0.3, // ollie/nollie pop multiplier range
    trigger: 0.15, // RT above this counts as held; dropping below it releases
  },
  air: {
    detachClearance: 0.12, // m
    authority: 0.35, // 0..1 in-flight torque vs takeoff-set rotation
    tuckMultiplier: 1.25, // spin rate while grabbed
    extendMultiplier: 0.85, // spin rate while stretched
    spinMax: 9.0, // rad/s cap
    axisTiltMax: 1.1, // rad, max cork axis lerp
    spinTakeoff: 7.0, // rad/s at full stick on takeoff
  },
  land: {
    clean: 0.44, // rad ≈ 25°
    sketchy: 0.87, // rad ≈ 50°
    rollClean: 0.35, // rad, board-up vs contact normal
    sketchySpeedLoss: 0.25, // fraction
    absorbTime: 0.22, // s
  },
  bail: {
    drag: 7.0, // m/s² while tumbling
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
    master: 0.55,
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
