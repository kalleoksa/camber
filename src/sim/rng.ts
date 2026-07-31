/**
 * Seeded PRNG (mulberry32). Every random number in the sim comes from here so a
 * take replays identically. Render-side particles may use Math.random.
 */
export type Rng = {
  seed: number;
  state: number;
};

export function createRng(seed: number): Rng {
  return { seed, state: seed >>> 0 };
}

export function reseed(rng: Rng, seed: number): void {
  rng.seed = seed;
  rng.state = seed >>> 0;
}

/** Uniform 0..1. */
export function next(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform -1..1. */
export function nextSigned(rng: Rng): number {
  return next(rng) * 2 - 1;
}
