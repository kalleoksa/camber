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

  // Natural zones: a long steep pitch and a flatter run-out that gives the height back, laid on
  // top of the bands — somewhere for booters and cliff drops to land. The fill tries those first,
  // at each zone's top edge.
  natural: {
    count: [1, 2], // zones per park
    steep: [30, 36], // ° of the steep pitch
    length: [30, 45], // m of it
    maxOffset: 16, // m it may sink the ground below the base plane; shorter if it would sink more
    side: 20, // ° at most across its sides: they fade over 1.5 × depth / tan(side) at least (smoothstep's steepest is 1.5× its mean)
    recover: [6, 9], // ° of the run-out after it: flatter than the base, so the height comes back
    at: [150, 550], // m down the zone where one may start
    halfWidth: [18, 30],
    edge: [15, 25],
    blend: 26, // m, as the bands: a crest at speed must bend over more than v²/g or it launches you
    yaw: 15, // ° off the fall line
    tries: 3, // spots across each zone's top edge the fill tries
    lead: [18, 30], // m uphill of the zone's start a booter's takeoff goes: its airs carry 30–50 m
    shelf: 40, // m further uphill a cliff drop's shelf starts, so its edge comes near the zone's start
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
    mix: { kicker: 0.42, stepUp: 0.08, hip: 0.1, rail: 0.15, roller: 0.08, spine: 0.07, mini: 0.06, euroGap: 0.04, gapToRail: 0.04, jibTable: 0.06, stepDownHip: 0.03 }, // relative odds per feature
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
    mix: { kicker: 0.28, stepUp: 0.05, hip: 0.13, rail: 0.15, roller: 0.08, spine: 0.08, mini: 0.08, euroGap: 0.03, gapToRail: 0.03, jibTable: 0.05, knoll: 0.07, log: 0.04, miniPipe: 0.04, booter: 0.04, drop: 0.04, corner: 0.05, wedge: 0.06, funBox: 0.02, berm: 0.04, wallRide: 0.03, stepDownHip: 0.03, hipQuarter: 0.03 },
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
  // Hips, sized from flight (kit.ts designHip). Takeoff presets from the hip jump spec (Claude
  // Docs "Camber — Hip Jump Spec"); the deck's height above the ground and the landing grades are
  // solved: the lowest deck whose landings take a medium air at the middle speed clean at every
  // aim. The lip stands `lip` m above the deck. Speeds are the kickers' sizes, which play has
  // set; the spec's (S 8–11 … XL 17–21 m/s) land sketchy at L and XL on any deck searched.
  hip: {
    single: 0.6, // odds of a single hip (one landing side) rather than a double
    sizes: {
      S: { speed: [7, 10], lipAngle: 20, straightLip: 1, lip: 1.0, width: 5, table: [0, 6], aim: [10, 25], knuckleRadius: 3 },
      M: { speed: [9, 13], lipAngle: 23, straightLip: 1.5, lip: 1.5, width: 7, table: [0, 10], aim: [10, 30], knuckleRadius: 3.5 },
      L: { speed: [12, 15], lipAngle: 26, straightLip: 2, lip: 2.2, width: 9, table: [0, 15], aim: [10, 30], knuckleRadius: 4 },
      XL: { speed: [15, 18], lipAngle: 26 /* the spec's 30° lands sketchy on any deck searched */, straightLip: 2, lip: 3.0, width: 11, table: [0, 25], aim: [15, 30], knuckleRadius: 5 },
    },
    deck: [1.5, 14, 1], // m the deck may stand above the ground: lowest, highest, step searched
    grades: [10, 40, 5], // ° landing grades searched (just past the knuckle, and before the bottom): from, to, step
    spread: 20, // ° the landing may steepen by, at most, from knuckle to bottom
    bottomRadius: 10, // m, the transition into the outrun
    knuckleClear: 1, // m the table ends short of where the middle air at the lowest aim comes down to deck height
  },
  quarter: { height: [3, 4.5], angle: 83, radius: [3.5, 5], width: [12, 20], deck: 3, sideTaper: 3 },
  // Two quarter-pipe sections meeting at an inside corner (the second bent toward the rider): airs
  // along the coping come down on the next section (npm run hip-quarter). Height, face and radius as `quarter`.
  hipQuarter: { width: [10, 14], angle: [30, 60], end: 0.3, outside: 0.4 }, // width: m per section; angle: ° between them; end: odds a line ends in one instead of a straight quarter; outside: odds the corner bends away from the rider (an outside hip) rather than toward
  spine: { height: [2, 3.5], angle: 30, knuckleRadius: 6, footRadius: 10, width: [8, 14], taper: 3 },
  roller: { height: [0.8, 1.6], length: [10, 16], width: [10, 18], taper: 4 },
  sideHit: { height: [0.8, 1.5], angle: 25, back: 2, width: [3, 5], taper: 1.5 },
  rail: { length: [8, 16], height: [0.4, 0.7], boxWidth: 0.5, kink: 0.35 }, // kink: rise of a flat-down's flat part, m

  // Obstacles from docs/obstacles-plan.md, build step 2.
  mini: { height: [0.3, 0.7], angle: [10, 18], back: 1.5, width: [3, 5], taper: 1, speed: [5, 12] }, // a painted side hit; speed: m/s it's made for
  knoll: { height: [1, 3], radius: [4, 10], back: [0.6, 1] }, // back: downhill radius as a fraction of `radius`
  log: { length: [3, 6], height: [0.3, 0.5], mound: 0.3, moundLength: 4 }, // a round rail on a low mound
  miniPipe: { height: [1, 2], angle: [60, 70], radius: [2, 3], flat: [3, 6], length: [30, 60], deck: 1.5, backAngle: 20, sideTaper: 4, grade: [10, 15], yaw: 10 }, // grade: ° of ground it goes on; yaw: ° off the fall line at most
  euroGap: {
    sizes: ['M', 'L'],
    table: [8, 18], // m
    rail: { start: 1.5, setBack: 2, length: [4, 8], height: [0.3, 1], clear: 0.5 }, // m: past the lip, short of the knuckle, along, above the table, slowest air over its top
  },
  gapToRail: {
    height: [0.6, 1], angle: 22, back: 1.5, width: 3, taper: 1, speed: [3, 8], // the takeoff, a painted side hit; m/s: a gap to rail is hit slow, or the air sails past the rail
    gap: [1, 4], // m from the takeoff's back to the rail
    rail: { length: [4, 8], height: [0.5, 2.5], end: 0.5, over: 0.15, steep: 0.75 }, // a down rail. height: m above the snow at its start; end: at its end; over: m above its top the air is where it starts; steep: fraction of rail.captureAngle the air may meet it at
  },
  // Build step 3: solved over the real ground (kit.ts groundFrame).
  stepDown: { drop: [0.5, 6], probe: 30 }, // drop: m the ground below falls away from the run-in's grade, `probe` m past the takeoff — generated ground is gentle, so a kicker that has it is called a step-down
  booter: { height: [2.5, 4], angle: [28, 32], back: 2.5, width: [5, 6], taper: 1.5, speed: [8, 16], landing: [22, 38], span: 2 }, // a natural kicker, no landing built: lands on ground at `landing`° (from horizontal); span: m/s of speeds that must work
  drop: { height: [2, 6], rise: [30, 50], top: [6, 10], face: 70, width: [8, 14], taper: 3, speed: [6, 14] }, // a cliff built as a shelf: rise, top in m; face in °
  corner: { yaw: [45, 70], sizes: ['S', 'M'] }, // ° off the fall line the takeoff faces: past ~70° its axis is nearly a traverse and fast airs overshoot onto flat ground
  // Build step 4: new shapes.
  wedge: { height: [1.5, 3], faceAngle: [20, 25], baseRadius: 4, top4: [3, 6], top2: [1, 2], width: [8, 14], taper: 2, four: 0.6 }, // four: odds of a 4-faced pyramid over a 2-faced ridge
  funBox: { top: [5, 8], box: { height: 0.3, width: 0.5, inset: 0.5 }, rail: 0.4 }, // a pyramid with a box along its deck and a rail down its downhill face; m
  berm: { radius: [10, 20], sweep: [60, 120], bank: [30, 40], height: [1.5, 3], taper: 4 }, // radius m, sweep and bank °. Bank capped at 40°: steeper ones bailed a steered rider off the top or cost speed (ride check 2026-10-07)
  wallRide: { angle: [60, 80], height: [1.5, 4], length: [8, 30], radius: [2, 3], top: 1, taper: 3, offset: 1.5 }, // offset: m from the approach to the foot of its transition
  stepDownHip: { drop: [1, 4] }, // m the lip is built above the deck and knuckle line, in place of the size's own
  jibTable: { lip: 1.5, lipAngle: 23, width: 8, deck: [12, 20], sideTaper: 3, landingAngle: 20, knuckleRadius: 10, runoutRadius: 10, rail: { start: 1, end: 2, length: [6, 12], height: [0.3, 0.5] }, box: 0.5 },
};

export type GenConfig = typeof GEN;
