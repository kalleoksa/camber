import { createLoop, TICK_DT } from './core/loop.ts';
import { pollGamepad } from './input/gamepad.ts';
import {
  buildTake,
  createRecorder,
  createReplayCursor,
  verifyTake,
  type ReplayCursor,
  type Take,
} from './input/recorder.ts';
import { neutralInput, quantizeInput } from './input/snapshot.ts';
import { createAudioLayers } from './audio/layers.ts';
import { createChaseCamera } from './render/camera.ts';
import { createSpray } from './render/effects.ts';
import { ANCHORS } from './render/poses.ts';
import { copyDrivers, neutralDrivers, type RigDrivers } from './render/rig.ts';
import { createScene, interpolateRider } from './render/scene.ts';
import {
  copySecondary,
  createSecondary,
  hashSecondary,
  resetSecondary,
  sampleSecondary,
  seedSecondary,
  stepSecondary,
} from './render/secondary.ts';
import { createPoseOrbit } from './render/orbit.ts';
import { hashState } from './sim/hash.ts';
import { applyParams, cloneParams, params, type Params } from './sim/params.ts';
import { tick } from './sim/rider.ts';
import {
  cloneRiderState,
  copyRiderState,
  createRiderState,
  resetRiderState,
  type RiderState,
} from './sim/state.ts';
import { createContact, createSlope, type SlopeConfig } from './sim/terrain.ts';
import { length } from './sim/vec3.ts';
import { createPanel, download, type Readout } from './tuning/panel.ts';

const SEED = 1;
const slopeConfig: SlopeConfig = { length: 400, width: 120, pitch: 0.28 };

const terrain = createSlope(slopeConfig);
const spawn = {
  position: { x: 0, y: terrain.sample(0, 0, createContact()).height + 1.5, z: 0 },
  heading: Math.PI, // nose down the fall line (-Z)
};

const state = createRiderState(spawn);
const previous = cloneRiderState(state);
const recorder = createRecorder();

// Render-side springs, kept in the same prev/current pair as sim state so the frame can
// interpolate between two ticks instead of integrating on its own cadence.
const secondary = createSecondary();
const secondaryPrevious = createSecondary();
const secondaryView = createSecondary();

let liveHashes: string[] = [];
let liveSecondaryHashes: string[] = [];
let currentTake: Take | null = null;
let cursor: ReplayCursor | null = null;

const readout: Readout = {
  mode: state.mode,
  session: 'live',
  speed: 0,
  tick: 0,
  clearance: 0,
  air: 0,
  reach: '—',
  spin: 0,
  rotated: 0,
  landing: 'none',
  determinism: '—',
};

const chase = createChaseCamera(params);
const view = createScene(slopeConfig, terrain, chase.camera);
addEventListener('resize', view.resize);

const spray = createSpray();
view.scene.add(spray.object);

// AudioContext can only start from a gesture, and the pad alone doesn't count as one.
const audio = createAudioLayers();
addEventListener('pointerdown', () => audio.start(), { once: true });
addEventListener('keydown', () => audio.start(), { once: true });

const liveInput = neutralInput();
const tickInput = neutralInput();

let poseMode = false;

function step(): void {
  // Pose mode disconnects gameplay entirely — the rider is frozen and the drivers are
  // the only thing moving (design §7.8, build order step 2).
  if (poseMode) return;
  copyRiderState(previous, state);
  copySecondary(secondaryPrevious, secondary);

  let input = quantizeInput(pollGamepad(0, liveInput), tickInput);
  if (cursor) {
    const frame = cursor.next();
    if (!frame) {
      cursor = null;
      readout.session = 'live';
    } else {
      input = frame;
    }
  }

  if (recorder.recording) recorder.capture(input);
  tick(state, input, params, terrain, TICK_DT);
  stepSecondary(secondary, state, params, TICK_DT);
  if (recorder.recording) {
    liveHashes.push(hashState(state));
    liveSecondaryHashes.push(hashSecondary(secondary));
  }
}

let lastLanding: RiderState['landing'] = 'none';
let lastRender = performance.now();
let refreshCounter = 0;

function render(alpha: number): void {
  const now = performance.now();
  const dt = Math.min((now - lastRender) / 1000, 0.1);
  lastRender = now;

  const rider = interpolateRider(previous, state, alpha);
  sampleSecondary(secondaryView, secondaryPrevious, secondary, alpha);
  view.updateRider(rider, params, poseMode, secondaryView);
  if (poseMode) {
    orbit.update(rider);
  } else {
    spray.update(rider, params, dt);
    chase.update(rider, params, dt);
  }
  if (audio.running) {
    audio.update(rider, params);
    // Fire once per touchdown, on the tick the sim reports one.
    if (state.landing !== lastLanding) {
      if (state.landing === 'clean' || state.landing === 'sketchy') audio.thump(state.impact, params);
      lastLanding = state.landing;
    }
  } else {
    lastLanding = state.landing;
  }
  view.renderer.render(view.scene, chase.camera);

  if (++refreshCounter % 6 === 0) {
    readout.mode = state.mode;
    readout.speed = length(state.velocity);
    readout.tick = state.tick;
    readout.clearance = state.clearance;
    readout.air = state.mode === 'airborne' ? state.airTime : 0;
    const st = view.strain;
    readout.reach =
      st.front === 0 && st.back === 0
        ? 'no grab'
        : `front ${st.front ? st.front.toFixed(2) : '—'}  back ${st.back ? st.back.toFixed(2) : '—'}${
            Math.max(st.front, st.back) > 1 ? '  SHORT' : ''
          }`;
    readout.spin = state.spinRate;
    readout.rotated = (state.airYaw * 180) / Math.PI;
    readout.landing = state.landing;
    panel.refresh();
  }
}

function startReplay(): void {
  if (!currentTake) return;
  resetRiderState(state);
  copyRiderState(previous, state);
  // Without this the springs would enter the replay carrying the end of the live run, and
  // the take's secondary stream would never match no matter how correct the stepping is.
  resetSecondary(secondary);
  copySecondary(secondaryPrevious, secondary);
  cursor = createReplayCursor(currentTake.frames);
  readout.session = `replay (${currentTake.frames.length} ticks, live params)`;
}

function finishRecording(): void {
  if (!recorder.recording) return;
  recorder.stop();
  currentTake = buildTake({
    seed: SEED,
    dt: TICK_DT,
    spawn,
    terrain: slopeConfig,
    params,
    frames: recorder.frames,
  });
  readout.session = `take: ${currentTake.frames.length} ticks`;

  // The gate: the live run and a headless re-sim of the same inputs must agree exactly, in
  // the sim and in the render-side springs alike.
  const diverged = currentTake.hashes.findIndex((h, i) => h !== liveHashes[i]);
  const recorded = currentTake.secondaryHashes ?? [];
  const divergedSecondary = recorded.findIndex((h, i) => h !== liveSecondaryHashes[i]);
  if (diverged !== -1 || currentTake.hashes.length !== liveHashes.length) {
    readout.determinism = `live diverged @ ${diverged}`;
  } else if (divergedSecondary !== -1 || recorded.length !== liveSecondaryHashes.length) {
    readout.determinism = `live springs diverged @ ${divergedSecondary}`;
  } else {
    readout.determinism = `live matches replay (${liveHashes.length} ticks)`;
  }
}

const orbit = createPoseOrbit(chase.camera, view.renderer.domElement);

const panel = createPanel(params, readout, view.drivers, {
  onPoseMode: (on) => {
    poseMode = on;
    orbit.setEnabled(on);
    readout.session = on ? 'pose mode — gameplay disconnected' : 'live';
    if (!on) {
      seedSecondary(secondary, view.drivers.hipY);
      copySecondary(secondaryPrevious, secondary);
      chase.snap(interpolateRider(previous, state, 1), params);
    }
  },
  onAnchor: (name) => {
    const anchor = ANCHORS[name];
    if (anchor) {
      copyDrivers(view.drivers, anchor);
      panel.refresh();
    }
  },
  onSavePose: () => download('pose.json', JSON.stringify(view.drivers, null, 2)),
  onLoadPose: (json) => {
    const loaded = { ...neutralDrivers(), ...(JSON.parse(json) as Partial<RigDrivers>) };
    copyDrivers(view.drivers, loaded);
    panel.refresh();
  },
  onReset: () => {
    resetRiderState(state);
    copyRiderState(previous, state);
    resetSecondary(secondary);
    copySecondary(secondaryPrevious, secondary);
    chase.snap(interpolateRider(previous, state, 1), params);
  },
  onRecord: () => {
    resetRiderState(state);
    copyRiderState(previous, state);
    resetSecondary(secondary);
    copySecondary(secondaryPrevious, secondary);
    cursor = null;
    liveHashes = [];
    liveSecondaryHashes = [];
    recorder.start();
    readout.session = 'recording';
    readout.determinism = '—';
  },
  onStopRecord: finishRecording,
  onReplay: startReplay,
  onVerify: () => {
    if (!currentTake) {
      readout.determinism = 'no take';
      return;
    }
    const result = verifyTake(currentTake);
    readout.determinism = result.ok
      ? `deterministic (${result.ticks} ticks)`
      : `${result.stream} diverged @ ${result.divergedAt}`;
  },
  onSaveTake: () => {
    if (currentTake) download(`take-${currentTake.frames.length}.json`, JSON.stringify(currentTake));
  },
  onLoadTake: (json) => {
    currentTake = JSON.parse(json) as Take;
    readout.session = `take loaded (${currentTake.frames.length} ticks)`;
  },
  onSavePreset: () => download('preset.json', JSON.stringify(cloneParams(params), null, 2)),
  onLoadPreset: (json) => {
    applyParams(params, JSON.parse(json) as Params);
    panel.refresh();
  },
});

chase.snap(interpolateRider(previous, state, 1), params);
createLoop(step, render).start();
