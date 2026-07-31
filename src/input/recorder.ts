import { hashState } from '../sim/hash.ts';
import { cloneParams, type Params } from '../sim/params.ts';
import { tick } from '../sim/rider.ts';
import { createRiderState, type RiderState, type Spawn } from '../sim/state.ts';
import { createSlope, type SlopeConfig } from '../sim/terrain.ts';
import { cloneInput, quantizeInput, type InputSnapshot } from './snapshot.ts';

export const TAKE_VERSION = 1;

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

export function createReplayCursor(frames: InputSnapshot[]): ReplayCursor {
  let index = 0;
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
      return cloneInput(frame);
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
    frames: opts.frames.map(quantizeInput),
    hashes: [],
  };
  take.hashes = simulateTake(take).hashes;
  return take;
}

/** Headless replay. Used by the determinism check and by the in-browser verify button. */
export function simulateTake(take: Take): { hashes: string[]; state: RiderState } {
  const terrain = createSlope(take.terrain);
  const state = createRiderState(take.spawn);
  const hashes: string[] = [];
  for (const frame of take.frames) {
    tick(state, frame, take.params, terrain, take.dt);
    hashes.push(hashState(state));
  }
  return { hashes, state };
}

export type VerifyResult = {
  ok: boolean;
  ticks: number;
  divergedAt: number; // -1 when clean
  expected: string;
  actual: string;
};

export function verifyTake(take: Take): VerifyResult {
  const { hashes } = simulateTake(take);
  const count = Math.min(hashes.length, take.hashes.length);
  for (let i = 0; i < count; i++) {
    if (hashes[i] !== take.hashes[i]) {
      return {
        ok: false,
        ticks: hashes.length,
        divergedAt: i,
        expected: take.hashes[i] ?? '',
        actual: hashes[i] ?? '',
      };
    }
  }
  const ok = hashes.length === take.hashes.length;
  return {
    ok,
    ticks: hashes.length,
    divergedAt: ok ? -1 : count,
    expected: take.hashes[take.hashes.length - 1] ?? '',
    actual: hashes[hashes.length - 1] ?? '',
  };
}
