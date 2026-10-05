/**
 * Every number the park generator uses, in one place. Lengths in m, angles in degrees (the
 * generator converts), speeds in m/s. A change here changes what a seed generates: the
 * config's hash goes into the cache key, and a take keeps the terrain it was ridden on.
 */
export const GEN = {
  zone: { width: 300, length: 800 },
  cell: 2, // m between heightfield nodes
  basePitch: [10, 13], // the zone's overall grade
  bank: { width: 25, height: 5 }, // the zone's edges roll up over this
  noise: { amp: 1.2, wavelength: 70, octaves: 2 }, // smooth undulation on top of the bands
  speedMap: { cell: 2, startSpeed: 5 }, // m between cells; m/s a run starts at the top

  // Steepness bands: patches laid down the hill in a few columns across it, each a run of
  // segments that gives back the height it takes, so neighbouring columns meet again.
  bands: {
    columns: 3,
    gap: [8, 40], // m between one patch's end and the next in a column
    blend: 8, // m over which the grade changes between segments (spec: at least 4–6)
    edge: [25, 45], // m over which a patch fades out across the slope
    yaw: 25, // ° a patch's axis may turn off the fall line
    maxOffset: { bench: 6, runIn: 8, steep: 10 }, // m a patch may lift or sink the ground off the base plane
    kinds: { bench: 0.35, runIn: 0.35, steep: 0.3 }, // relative odds
    flat: [0, 5], // bench grade
    flatLength: [18, 40],
    runIn: [15, 25],
    runInLength: [25, 50],
    steep: [28, 35],
    steepLength: [18, 35],
    cruise: [10, 20], // the grade a patch recovers on
    maxPitch: 35, // no recovery segment steeper than this; it runs longer instead
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
  hip: { scale: { S: 0.55, M: 0.75, L: 1 }, lip: 8.2, lipAngle: 49, deckLength: 22.8, deckWidth: 11.4, landingAngle: 29, knuckleRadius: 8, runoutRadius: 29, flare: 4, edgeSlope: 1.7 },
  quarter: { height: [3, 4.5], angle: 83, radius: [3.5, 5], width: [12, 20], deck: 3, sideTaper: 3 },
  spine: { height: [2, 3.5], angle: 30, knuckleRadius: 6, footRadius: 10, width: [8, 14], taper: 3 },
  roller: { height: [0.8, 1.6], length: [10, 16], width: [10, 18], taper: 4 },
  sideHit: { height: [0.8, 1.5], angle: 25, back: 2, width: [3, 5], taper: 1.5 },
  rail: { length: [8, 16], height: [0.4, 0.7], boxWidth: 0.5, kink: 0.35 }, // kink: rise of a flat-down's flat part, m
};

export type GenConfig = typeof GEN;
