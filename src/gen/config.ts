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
};

export type GenConfig = typeof GEN;
