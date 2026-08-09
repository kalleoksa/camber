import { hashState } from '../sim/hash.ts';
import { cloneParams, withDefaults, type Params } from '../sim/params.ts';
import { tick } from '../sim/rider.ts';
import { createRiderState, type RiderState, type Spawn } from '../sim/state.ts';
import { createSlope, type SlopeConfig } from '../sim/terrain.ts';
import { createSecondary, hashSecondary, stepSecondary, type Secondary } from '../render/secondary.ts';
import { copyInput, neutralInput, quantizeInput, type InputSnapshot } from './snapshot.ts';

/** 2 added `secondaryHashes`. A v1 take still replays; its secondary stream is unchecked. */
export const TAKE_VERSION = 2;

/**
 * Everything needed to reproduce a run: the world, the params it was recorded under,
 * and one input snapshot per tick. Params travel with the take so a take recorded
 * before a tuning session still replays exactly as it was ridden.
 */
export type Take = {
  version: number;
  seed: number;
  dt: number;
  spawn: Spawn;
  terrain: SlopeConfig;
  params: Params;
  frames: InputSnapshot[];
  hashes: string[]; // one per tick, for locating a divergence
  /**
   * One per tick for the render-side springs. A replay that reproduces the sim exactly can
   * still look wrong if secondary motion drifts, and cloth will ride this same stream, so
   * it is checked rather than trusted. Absent in v1 takes.
   */
  secondaryHashes?: string[];
};

export type Recorder = {
  recording: boolean;
  start(): void;
  capture(input: InputSnapshot): void;
  stop(): void;
  frames: InputSnapshot[];
};

export function createRecorder(): Recorder {
  const self: Recorder = {
    recording: false,
    frames: [],
    start() {
      self.frames = [];
      self.recording = true;
    },
    capture(input) {
      if (self.recording) self.frames.push(quantizeInput(input));
    },
    stop() {
      self.recording = false;
    },
  };
  return self;
}

export type ReplayCursor = {
  done: boolean;
  index: number;
  length: number;
  next(): InputSnapshot | null;
};

/** `next()` returns a reused buffer — consume it within the tick, never retain it. */
export function createReplayCursor(frames: InputSnapshot[]): ReplayCursor {
  let index = 0;
  const out = neutralInput();
  return {
    get done() {
      return index >= frames.length;
    },
    get index() {
      return index;
    },
    get length() {
      return frames.length;
    },
    next() {
      const frame = frames[index];
      if (!frame) return null;
      index++;
      return copyInput(out, frame);
    },
  };
}

export function buildTake(opts: {
  seed: number;
  dt: number;
  spawn: Spawn;
  terrain: SlopeConfig;
  params: Params;
  frames: InputSnapshot[];
}): Take {
  const take: Take = {
    version: TAKE_VERSION,
    seed: opts.seed,
    dt: opts.dt,
    spawn: opts.spawn,
    terrain: opts.terrain,
    params: cloneParams(opts.params),
    frames: opts.frames.map((frame) => quantizeInput(frame)),
    hashes: [],
  };
  const sim = simulateTake(take);
  take.hashes = sim.hashes;
  take.secondaryHashes = sim.secondaryHashes;
  return take;
}

/** Headless replay. Used by the determinism check and by the in-browser verify button. */
export function simulateTake(take: Take): {
  hashes: string[];
  secondaryHashes: string[];
  state: RiderState;
  secondary: Secondary;
} {
  const terrain = createSlope(take.terrain);
  const state = createRiderState(take.spawn);
  const secondary = createSecondary();
  // Resolved once, outside the loop — the loop body stays allocation-free (invariant 7).
  const params = withDefaults(take.params);
  const hashes: string[] = [];
  const secondaryHashes: string[] = [];
  for (const frame of take.frames) {
    tick(state, frame, params, terrain, take.dt);
    // Same order as the live loop: the springs see the tick the sim just produced.
    stepSecondary(secondary, state, params, take.dt);
    hashes.push(hashState(state));
    secondaryHashes.push(hashSecondary(secondary));
  }
  return { hashes, secondaryHashes, state, secondary };
}

export type VerifyResult = {
  ok: boolean;
  ticks: number;
  divergedAt: number; // -1 when clean
  /** Which hash stream broke. 'none' when clean, and 'sim' wins when both do. */
  stream: 'none' | 'sim' | 'secondary';
  expected: string;
  actual: string;
};

export function verifyTake(take: Take): VerifyResult {
  const { hashes, secondaryHashes } = simulateTake(take);

  const sim = compareStream(hashes, take.hashes, 'sim');
  if (!sim.ok) return sim;

  // A v1 take has no secondary stream to check. Skipping is right — it was recorded before
  // the springs stepped on the tick, so its render motion genuinely was not reproducible.
  const recorded = take.secondaryHashes;
  if (recorded && recorded.length > 0) {
    const secondary = compareStream(secondaryHashes, recorded, 'secondary');
    if (!secondary.ok) return secondary;
  }

  return sim;
}

function compareStream(actual: string[], expected: string[], stream: 'sim' | 'secondary'): VerifyResult {
  const count = Math.min(actual.length, expected.length);
  for (let i = 0; i < count; i++) {
    if (actual[i] !== expected[i]) {
      return {
        ok: false,
        ticks: actual.length,
        divergedAt: i,
        stream,
        expected: expected[i] ?? '',
        actual: actual[i] ?? '',
      };
    }
  }
  const ok = actual.length === expected.length;
  return {
    ok,
    ticks: actual.length,
    divergedAt: ok ? -1 : count,
    stream: ok ? 'none' : stream,
    expected: expected[expected.length - 1] ?? '',
    actual: actual[actual.length - 1] ?? '',
  };
}
