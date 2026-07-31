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
    carveYaw: 2.6, // rad/s at full edge, at plateau speed
    speedFactorKnee: 6.0, // m/s where yaw authority reaches ~80%
    pivotSpeed: 2.5, // m/s below which skid-pivot is allowed
    drag: 0.0016, // quadratic, 1/m
    edgeDrag: 0.35, // speed loss coefficient from carving
    normalSmoothing: 12.0, // 1/s, board-to-terrain alignment rate
    edgeResponse: 9.0, // 1/s, stick-to-edge-angle rate
  },
  pop: {
    chargeTime: 0.35, // s to full compress
    decay: 0.4, // 1/s bleed after full
    base: 2.0, // m/s uncharged
    charged: 5.0, // m/s added at full charge
    stanceBias: 0.3, // ollie/nollie pop multiplier range
  },
  air: {
    detachClearance: 0.12, // m
    authority: 0.35, // 0..1 in-flight torque vs takeoff-set rotation
    tuckMultiplier: 1.25, // spin rate while grabbed
    extendMultiplier: 0.85, // spin rate while stretched
    spinMax: 9.0, // rad/s cap
    axisTiltMax: 1.1, // rad, max cork axis lerp
  },
  land: {
    clean: 0.44, // rad ≈ 25°
    sketchy: 0.87, // rad ≈ 50°
    rollClean: 0.35, // rad, board-up vs contact normal
    sketchySpeedLoss: 0.25, // fraction
    absorbTime: 0.22, // s
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
