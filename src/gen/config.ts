/**
 * Every number the park generator uses, in one place. Lengths in m, angles in degrees (the
 * generator converts), speeds in m/s. A change here changes what a seed generates: the
 * config's hash goes into the cache key, and a take keeps the terrain it was ridden on.
 */
export const GEN = {
  zone: { width: 300, length: 800 },
  cell: 2, // m between heightfield nodes
  basePitch: [12, 15], // the zone's overall grade: steep enough to get going again from standing after a fall
  bank: { width: 25, height: 5 }, // the zone's edges roll up over this
  noise: { amp: 1.2, wavelength: 70, octaves: 2 }, // smooth undulation on top of the bands
  speedMap: { cell: 2, startSpeed: 5 }, // m between cells; m/s a run starts at the top

  // Steepness bands: patches laid down the hill in a few columns across it, each a run of
  // segments that gives back the height it takes, so neighbouring columns meet again.
  bands: {
    columns: 3,
    gap: [8, 40], // m between one patch's end and the next in a column
    blend: 26, // m over which the grade changes between segments: a crest at 25 m/s must bend over more than v²/g ≈ 64 m or it launches you
    edge: [25, 45], // m over which a patch fades out across the slope
    yaw: 25, // ° a patch's axis may turn off the fall line
    maxOffset: { bench: 6, runIn: 8, steep: 10 }, // m a patch may lift or sink the ground off the base plane
    kinds: { bench: 0.25, runIn: 0.4, steep: 0.35 }, // relative odds
    flat: [5, 8], // bench grade: above snow friction's ~3.4°, so a rider stopped on it still rolls
    flatLength: [18, 40],
    runIn: [15, 25],
    runInLength: [25, 50],
    steep: [28, 35],
    steepLength: [18, 35],
    cruise: [10, 20], // the grade a patch recovers on
    maxPitch: 35, // no recovery segment steeper than this; it runs longer instead
  },

  // Spine lines (lines.ts): traced down the fall line with some wander, features placed along
  // each so the speed it arrives with is the speed the next feature is sized for.
  lines: {
    starts: [-90, 0, 90], // m across the top where each line begins (jittered)
    jitter: 15,
    step: 2, // m per step along a line
    wander: 22, // ° a line drifts off the fall line, at most
    wanderLength: 70, // m over which the drift changes
    maxTurn: 60, // ° off straight down the hill a line may ever head
    minGap: 40, // m a line keeps from the lines traced before it
    repel: 25, // ° it turns away when closer
    spacing: [15, 40], // m between one feature's run-out and the next one's run-in
    lead: 30, // m of riding before the first feature
    endMargin: 60, // m before the zone's bottom to stop placing
    mix: { kicker: 0.45, stepUp: 0.08, hip: 0.1, rail: 0.2, roller: 0.1, spine: 0.07 }, // relative odds per feature
    hero: 0.55, // fraction of the way down a line where its hero (an L/XL kicker or a big hip) goes
    railSpeed: [4, 10], // m/s a rail or box is ridden at
    spineSpeed: 9, // m/s to get up and over a spine
    speedMargin: 1.15, // straight-line speed must beat a feature's slowest design speed by this — riding a line carves some off
    brakeMargin: 8, // m of run-in on top of what checking speed down to a feature's top speed takes
  },
  // Clearance (footprint.ts): every feature keeps its own ground plus clear run-in before its
  // takeoff; features from different lines, and fill, may not overlap those.
  clear: { runIn: 20, margin: 3, path: 5 }, // m; path: how far fill keeps from a line's path

  // Fill (fill.ts): extra features scattered between and around the lines, spaced apart,
  // turned off the fall line, sized to the straight-line speed where they stand.
  fill: {
    count: 30,
    attempts: 1500,
    spacing: 30, // m at least between a fill feature and any other feature's origin
    yaw: 60, // ° off the fall line, at most
    mix: { kicker: 0.35, stepUp: 0.05, hip: 0.15, rail: 0.25, roller: 0.1, spine: 0.1 },
    sideHit: 0.15, // odds a fill feature is a side hit near the zone's edge instead
  },

  // Connection graph (graph.ts): from every takeoff, airs at `speeds` speeds across its range
  // and `headings` headings within ±`heading`° of straight; clean landings link on.
  graph: {
    speeds: 3,
    headings: 7,
    heading: 30, // °
    reach: [8, 90], // m from touchdown to the next lip
    steer: [6, 0.6], // m off its axis a touchdown may be: this much plus this × the distance
    shapeSpeed: [0.6, 0.9], // side hits, rollers: of the straight-line speed there
    top: 120, // m from the top within which a feature needs no way in (you start there)
    chainLinks: 4, // a chain this many links long counts as a line
    minChains: 3, // fewer than this and the seed re-rolls
    rolls: 4, // re-rolls before keeping the best try
  },

  // Feature kit (kit.ts). Kicker landings are solved from the flight, never set by hand: these
  // are the inputs and the rules the solve follows (terrain spec, jump generator).
  kicker: {
    lipAngle: 30, // ° above the ground under it
    sizes: {
      S: { lip: 1.5, speed: [7, 10] }, // m lip height, m/s at the lip
      M: { lip: 2.5, speed: [9, 13] },
      L: { lip: 3.5, speed: [12, 15] },
      XL: { lip: 5, speed: [15, 18] },
    },
    knuckleFraction: 0.5, // knuckle height as a fraction of the lip's, to start from
    knuckleClear: 1, // m short of where the slowest, unpopped air comes down to knuckle height
    knuckleRadius: 10,
    runoutRadius: 20,
    landing: [28, 35], // ° from horizontal
    sweetOffset: 4, // ° the landing is laid back from the flight at the sweet spot
    landingMargin: 0.2, // landing runs this much past the fastest air's touchdown (vMax, medium pop)
    knuckleMax: 1, // knuckle height cap, × lip: higher than the lip is a step-up
    width: 5, // m of takeoff
    landingExtra: 6, // m the landing hill is wider than the takeoff
    sideTaper: 1, // m the takeoff's sides roll off over
    deckTaper: 4, // m the landing hill's sides roll off over
    iterations: 12,
  },
  stepUp: { size: 'M', rise: [1.5, 3], face: 2, landingOnTop: 2, topMargin: 3 }, // rise: m the top stands above the lip; land this far onto it at vMin
  // Hips: sizes and speeds as the home corner (scaled S/M/L); shape from the hip jump spec.
  hip: {
    scale: { S: 0.55, M: 0.75, L: 1 },
    lip: 8.2,
    lipAngle: 49,
    deckLength: 22.8,
    deckWidth: 11.4,
    single: 0.6, // odds of a single hip (one landing side) rather than a double
    straightLip: 2,
    landingStart: 30, // ° just past the knuckle — a 49° lip brings airs down at ~63°, so steeper than the spec
    landingEnd: 45, // ° before the bottom transition
    knuckleRadius: 4,
    bottomRadius: 13,
  },
  quarter: { height: [3, 4.5], angle: 83, radius: [3.5, 5], width: [12, 20], deck: 3, sideTaper: 3 },
  spine: { height: [2, 3.5], angle: 30, knuckleRadius: 6, footRadius: 10, width: [8, 14], taper: 3 },
  roller: { height: [0.8, 1.6], length: [10, 16], width: [10, 18], taper: 4 },
  sideHit: { height: [0.8, 1.5], angle: 25, back: 2, width: [3, 5], taper: 1.5 },
  rail: { length: [8, 16], height: [0.4, 0.7], boxWidth: 0.5, kink: 0.35 }, // kink: rise of a flat-down's flat part, m
};

export type GenConfig = typeof GEN;
