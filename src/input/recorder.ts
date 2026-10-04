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
 * For params that switched on new behaviour: the value that reproduces the sim from
 * before the param existed. A take that predates one gets this, not today's default, so
 * it replays as it was ridden. Anything not listed falls back to the default.
 */
// spinArmBand 2: |stick| is always under it, so the spin is always armed — no disarm.
const BEFORE_PARAM = { air: { checkRate: 0, takeoffWindow: 0, spinCarveReject: 0, spinArmBand: 2, levelRate: 0, levelWhole: 0, corkDeadzone: 0, corkRecover: 0, flipRate: 0, switchFlips: 0, spinModel: 0, windLandReset: 0, windAdds: 0 }, butter: { press: 2, edgeGrip: 1 }, ground: { friction: 0, switchEdges: 0, switchCarry: 0 }, grab: { switchMirror: 0, stickModel: 0, indyYaw: 0, muteYaw: 0, japanYaw: 0, melonYaw: 0, methodYaw: 0, stalefishYaw: 0, nosegrabYaw: 0, tailgrabYaw: 0 }, wall: { lipTakeoff: 0, vertExit: 0 }, land: { impactSketchy: 1e9, impactBail: 1e9 }, bail: { faceDownhill: 0 }, rail: { rideOn: 1e9, trickModel: 0 }, rig: { terrainAbsorb: 0 } } as unknown as Params;

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
  /**
   * The run began on a reset with Y still held: the sim's reset debounce is latched at
   * tick 0. A reset leaves the state exactly a fresh one with the latch set, so every run
   * can start at its own reset. Absent means false.
   */
  startLatched?: boolean;
  /** Feedback marks (docs/feedback.md). Not hashed, not replayed — commentary on the run. */
  notes?: Note[];
  /** Tricks as the reader named them live (render/tricks.ts). Commentary, like notes. */
  tricks?: { tick: number; text: string }[];
};

export type NoteTag = 'note' | 'good' | 'bad' | 'bug' | 'look';
export const NOTE_TAGS: NoteTag[] = ['note', 'good', 'bad', 'bug', 'look'];

/**
 * A mark in a run: which tick, what kind, what the rider wrote, and a short picture of
 * the state there so the file reads on its own. The true state is always the replay's.
 */
export type Note = {
  tick: number; // frames into the take: the note sits after this many ticks
  tag: NoteTag;
  text: string;
  trick?: string; // the last trick named before the mark
  at: { mode: string; speed: number; landing: string; impact: number; airTime: number; spinRate: number };
};

export function makeNote(tick: number, tag: NoteTag, state: RiderState): Note {
  const v = state.velocity;
  const r = (x: number): number => Math.round(x * 100) / 100;
  return {
    tick,
    tag,
    text: '',
    at: {
      mode: state.mode,
      speed: r(Math.hypot(v.x, v.y, v.z)),
      landing: state.landing,
      impact: r(state.impact),
      airTime: r(state.airTime),
      spinRate: r(state.spinRate),
    },
  };
}

/** What a tester sends back: every run they marked, the build it was ridden on, and who. */
export type Feedback = {
  kind: 'camber-feedback';
  version: 1;
  build: string; // commit the runs were recorded on — a take replays only on its own code
  tester: string;
  created: string; // ISO time, for sorting files; never read by the sim
  runs: Take[];
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
  startLatched?: boolean;
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
  if (opts.startLatched) take.startLatched = true;
  const sim = simulateTake(take);
  take.hashes = sim.hashes;
  take.secondaryHashes = sim.secondaryHashes;
  return take;
}

/** Headless replay. Used by the determinism check and by the in-browser verify button. */
export function simulateTake(
  take: Take,
  visit?: (tick: number, state: RiderState, frame: InputSnapshot) => void,
): {
  hashes: string[];
  secondaryHashes: string[];
  state: RiderState;
  secondary: Secondary;
} {
  const terrain = createSlope(take.terrain);
  const state = createRiderState(take.spawn);
  state.resetLatch = take.startLatched === true;
  const secondary = createSecondary();
  // Resolved once, outside the loop — the loop body stays allocation-free (invariant 7).
  const params = withDefaults(take.params, BEFORE_PARAM);
  const hashes: string[] = [];
  const secondaryHashes: string[] = [];
  for (const frame of take.frames) {
    tick(state, frame, params, terrain, take.dt);
    // Same order as the live loop: the springs see the tick the sim just produced.
    stepSecondary(secondary, state, params, take.dt);
    hashes.push(hashState(state));
    secondaryHashes.push(hashSecondary(secondary));
    if (visit) visit(hashes.length, state, frame);
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
