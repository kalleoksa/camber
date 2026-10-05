import { createLoop, TICK_DT } from './core/loop.ts';
import { padRawSummary, padSummary, pollGamepad, pollHelp, pollMark, pollPause, rumble } from './input/gamepad.ts';
import { mergeKeyboard } from './input/keyboard.ts';
import {
  buildTake,
  createRecorder,
  createReplayCursor,
  makeNote,
  verifyTake,
  type Feedback,
  type Note,
  type NoteTag,
  type ReplayCursor,
  type Take,
} from './input/recorder.ts';
import { neutralInput, quantizeInput } from './input/snapshot.ts';
import { createAudioLayers } from './audio/layers.ts';
import { createChaseCamera } from './render/camera.ts';
import { createSpray } from './render/effects.ts';
import { ANCHORS } from './render/poses.ts';
import {
  blendToGrab,
  copyDrivers,
  gripWeight,
  neutralDrivers,
  smoothstep,
  type RigDrivers,
} from './render/rig.ts';
import { createScene, interpolateRider } from './render/scene.ts';
import { createTrickReader, describe } from './render/tricks.ts';
import { createControlsHelp } from './render/controlsHelp.ts';
import { createTrickText } from './render/trickText.ts';
import { createInputOverlay } from './render/inputOverlay.ts';
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
import { toSlopeConfig } from './park/layout.ts';
import { HOME, PARKS } from './park/parks.ts';
import { PARK_GRAVITY, REAL_GRAVITY } from './park/scale.ts';
import { length } from './sim/vec3.ts';
import { createPanel, download, type FeedbackState, type Readout } from './tuning/panel.ts';

const SEED = 1;
// Parks are layouts (src/park/layout.ts). The home park (src/park/park.ts) by default;
// ?park=sochi for Sochi 2014, ?park=slopestyle for the first park. All full size under real
// gravity. A take stores its terrain and params, so takes from before (16 m/s², 0.61-scale
// parks) replay as they were.
const query = new URLSearchParams(location.search);
const layout = PARKS[query.get('park') ?? 'home'] ?? HOME;
const slopeConfig: SlopeConfig = toSlopeConfig(layout);
// ?spin=0 starts on the older spin model (air.spinModel in the panel switches live).
if (query.get('spin') === '0') params.air.spinModel = 0;

const terrain = createSlope(slopeConfig);
const spawn = {
  position: { x: layout.spawn.x, y: terrain.sample(layout.spawn.x, layout.spawn.z, createContact()).height + 1.5, z: layout.spawn.z },
  heading: layout.spawn.heading,
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

/**
 * Feedback (docs/feedback.md). Every run records from its reset, so a mark never needs a
 * record button pressed in advance. A run is its notes plus, once finished, its take; runs
 * with notes are kept for the feedback file, the rest are dropped at the next reset.
 */
type Run = { take: Take | null; notes: Note[]; latched: boolean; index: number };
const MAX_RUN_TICKS = 120 * 60 * 10; // 10 min — past this a run stops recording until the next reset
let run: Run = { take: null, notes: [], latched: false, index: 0 };
let runCount = 0;
const kept: Run[] = [];
let replaying: Run | null = null;
let pendingMark: NoteTag | null = null;
const feedback: FeedbackState = { tester: '', status: 'none yet — View/Back or M to mark' };

const readout: Readout = {
  rail: '—',
  mode: state.mode,
  session: 'live',
  pad: 'none — press a button on the pad',
  padRaw: '—',
  speed: 0,
  tick: 0,
  clearance: 0,
  air: 0,
  reach: '—',
  knees: '—',
  spin: 0,
  rotated: 0,
  landing: 'none',
  trick: '—',
  determinism: '—',
};

// Trick names (render/tricks.ts): read off the state after every tick, shown on screen,
// in the panel, and kept with the run and its notes.
const tricks = createTrickReader();
const trickText = createTrickText();
const inputOverlay = createInputOverlay();
let runTricks: { tick: number; text: string }[] = [];

const chase = createChaseCamera(params);
// Parks are full size, their features 1.63× the old: so is the coarse grid cell.
const view = createScene(slopeConfig, terrain, chase.camera, 0.75 * (PARK_GRAVITY / REAL_GRAVITY));
addEventListener('resize', view.resize);
// The canvas follows the visible screen by CSS; whenever its size changes — including iPad
// Safari's toolbars sliding, which doesn't always fire a resize — the buffer follows.
new ResizeObserver(() => view.resize()).observe(view.renderer.domElement);
view.resize();

const spray = createSpray();
view.scene.add(spray.object);

// AudioContext can only start from a gesture, and the pad alone doesn't count as one.
const audio = createAudioLayers();
addEventListener('pointerdown', () => audio.start(), { once: true });
addEventListener('keydown', () => audio.start(), { once: true });

const liveInput = neutralInput();
const tickInput = neutralInput();

// A pad stays invisible to the page until it reports something, so "no pad" and "pad you
// haven't touched yet" look identical. Log the arrival so the distinction is visible.
addEventListener('gamepadconnected', ({ gamepad: pad }) => {
  console.log(
    `pad connected: slot ${pad.index}, "${pad.id}", mapping "${pad.mapping}", ` +
      `${pad.axes.length} axes, ${pad.buttons.length} buttons`,
  );
});
addEventListener('gamepaddisconnected', ({ gamepad: pad }) => {
  console.log(`pad disconnected: slot ${pad.index}`);
});

let poseMode = false;
let anchorIndex = 0;

/**
 * Anchors written in pose mode persist in this browser, so re-tuning a grab survives a
 * reload. "save anchors" exports the whole set for committing to poses.ts; browser
 * storage is a convenience, never the record.
 */
const ANCHOR_STORE = 'camber.anchors';

/** An anchor's board attitude drives the sim in play (grabs.ts), so it goes to params too. */
function anchorToParams(name: string, anchor: RigDrivers): void {
  const g = params.grab as Record<string, number>;
  if (`${name}Pitch` in g) g[`${name}Pitch`] = anchor.boardPitch;
  if (`${name}Roll` in g) g[`${name}Roll`] = anchor.tweakRoll;
  if (`${name}Yaw` in g) g[`${name}Yaw`] = anchor.turn;
}

function applyAnchors(saved: Record<string, Partial<RigDrivers>>): void {
  for (const [name, pose] of Object.entries(saved)) {
    const anchor = ANCHORS[name];
    if (!anchor) continue;
    copyDrivers(anchor, { ...neutralDrivers(), ...anchor, ...pose });
    anchorToParams(name, anchor);
  }
}

function persistAnchors(): void {
  try {
    localStorage.setItem(ANCHOR_STORE, JSON.stringify(ANCHORS));
  } catch {
    // Private window or blocked storage: anchors still work for this session.
  }
}

try {
  const raw = localStorage.getItem(ANCHOR_STORE);
  if (raw) applyAnchors(JSON.parse(raw) as Record<string, Partial<RigDrivers>>);
} catch {
  // Unreadable or blocked: start from the anchors in poses.ts.
}

/**
 * Grab transition preview. A pose held still and a pose arrived at read differently, and the
 * milestone 4 gate is a judgement about the pose, so it has to be judgeable in motion.
 *
 * Plays crouch → the pose you are editing → crouch on the reach/hold/release envelope. Still
 * authoring, not gameplay: nothing here reads input or touches the sim, and the envelope is
 * shared by every anchor rather than authored per grab (invariant 3).
 *
 * `target` is the whole reason this is safe. Pose mode's contract is that the drivers *are*
 * the document, so playing a blend into them would overwrite what you were editing. The pose
 * is snapshotted on play and restored on stop.
 */
const preview = { play: false, loop: true, phase: 0 };
const previewTarget = neutralDrivers();
const previewBase = neutralDrivers();
let previewing = false;

function previewTotal(): number {
  const g = params.grab;
  return Math.max(g.reachTime + g.holdTime + g.releaseTime, 1e-3);
}

/** Envelope position → body blend weight. Ramp in, flat, ramp out. */
function previewWeight(phase: number): number {
  const g = params.grab;
  const t = phase * previewTotal();
  if (t < g.reachTime) return smoothstep(t / Math.max(g.reachTime, 1e-3));
  if (t < g.reachTime + g.holdTime) return 1;
  return 1 - smoothstep((t - g.reachTime - g.holdTime) / Math.max(g.releaseTime, 1e-3));
}

function applyPreview(): void {
  const body = previewWeight(preview.phase);
  blendToGrab(view.drivers, previewBase, previewTarget, body, gripWeight(body, params.grab.gripDelay));
}

function startPreview(): void {
  if (previewing) return;
  previewing = true;
  copyDrivers(previewTarget, view.drivers);
  const crouch = ANCHORS.crouch;
  copyDrivers(previewBase, crouch ?? neutralDrivers());
}

function stopPreview(): void {
  if (!previewing) return;
  previewing = false;
  copyDrivers(view.drivers, previewTarget);
  panel.refresh();
}

function updatePreview(dt: number): void {
  if (!preview.play) {
    // Scrubbing: hold any point of the transition still, which is how you catch the frame
    // where a pose passes through something it should not.
    if (preview.phase > 0) {
      startPreview();
      applyPreview();
    } else {
      stopPreview();
    }
    return;
  }
  startPreview();
  preview.phase += dt / previewTotal();
  if (preview.phase >= 1) {
    if (preview.loop) preview.phase -= 1;
    else {
      preview.phase = 0;
      preview.play = false;
    }
  }
  applyPreview();
}

// [ and ] step through the anchors without reaching for the panel, which is the whole
// workflow when you are comparing one grab against another.
addEventListener('keydown', (ev) => {
  if (!poseMode) return;
  if (ev.key === '[') stepAnchor(-1);
  else if (ev.key === ']') stepAnchor(1);
});

/**
 * Haptics (params.haptics): a pulse on pop, rail lock, landing and bail, from the state
 * change this tick made. Live riding only — a replay doesn't buzz.
 */
function feel(before: RiderState, after: RiderState): void {
  const h = params.haptics;
  if (h.on <= 0) return;
  // Wind-up gauge: a tick each time it passes a third.
  if (Math.floor(Math.abs(after.windUp) * 3 + 1e-6) > Math.floor(Math.abs(before.windUp) * 3 + 1e-6)) rumble(0, h.wind, h.ms * 0.6);
  if (before.popLatch && !after.popLatch && after.mode === 'airborne') rumble(h.pop * 0.4, h.pop, h.ms);
  if (before.mode !== 'railed' && after.mode === 'railed') rumble(h.rail, h.rail * 0.6, h.ms);
  if (before.mode !== 'bailed' && after.mode === 'bailed') rumble(h.bail, h.bail * 0.5, h.ms * 3);
  else if (before.mode === 'airborne' && (after.mode === 'grounded' || after.mode === 'walled')) {
    const m = after.landing === 'sketchy' ? h.sketchy : h.land;
    rumble(m, m * 0.5, after.landing === 'sketchy' ? h.ms * 2 : h.ms);
  }
}

// Pause: P or the pad's Options/Start. The sim and the take stop; the frozen frame keeps
// drawing, for a screenshot. `.` steps one tick while paused.
let paused = false;
let stepOnce = false;
let sessionBeforePause = '';
function togglePause(): void {
  paused = !paused;
  if (paused) {
    sessionBeforePause = readout.session;
    readout.session = 'paused — P or Options to resume, . steps a tick';
  } else readout.session = sessionBeforePause;
}
// The controls sheet pauses while it's open, and resumes on close only if it was what paused.
let pausedByHelp = false;
const help = createControlsHelp((open) => {
  if (open && !paused) {
    togglePause();
    pausedByHelp = true;
  } else if (!open) {
    if (pausedByHelp && paused) togglePause();
    pausedByHelp = false;
  }
});
/** Pause pressed: with the sheet up it closes the sheet (and resumes), else it toggles. */
function pausePressed(): void {
  if (help.isOpen()) help.toggle();
  else togglePause();
}
addEventListener('keydown', (ev) => {
  const t = ev.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (ev.key === 'p' || ev.key === 'P') pausePressed();
  else if (ev.key === '.' && paused) stepOnce = true;
});

function step(): void {
  // Pose mode disconnects gameplay entirely — the rider is frozen and the drivers are
  // the only thing moving (design §7.8, build order step 2).
  if (poseMode) return;
  if (paused) {
    if (!stepOnce) return;
    stepOnce = false;
  }
  copyRiderState(previous, state);
  copySecondary(secondaryPrevious, secondary);

  let input = quantizeInput(mergeKeyboard(pollGamepad(liveInput), TICK_DT), tickInput);
  if (cursor) {
    const frame = cursor.next();
    if (!frame) {
      cursor = null;
      replaying = null;
      readout.session = 'live — reset (Y) to record a new run';
    } else {
      input = frame;
    }
  }

  const replay = cursor !== null;
  if (recorder.recording && !replay) recorder.capture(input);
  tick(state, input, params, terrain, TICK_DT);
  stepSecondary(secondary, state, params, TICK_DT);
  if (recorder.recording && !replay) {
    liveHashes.push(hashState(state));
    liveSecondaryHashes.push(hashSecondary(secondary));
  }

  inputOverlay.push(input);
  if (!replay) feel(previous, state);

  const trick = tricks.step(state, TICK_DT, params);
  if (trick) {
    const text = describe(trick);
    readout.trick = text;
    trickText.show(text);
    if (recorder.recording && !replay) runTricks.push({ tick: recorder.frames.length, text });
  }

  // Marks come after the tick, so a note sits right after the moment it marks.
  const mark = pollMark() ?? pendingMark;
  pendingMark = null;
  if (mark) addMark(mark);

  if (replay) return;
  // Y reset in the sim: that run is over and the next one starts here, from a state that
  // is exactly a fresh one with the reset latched — so it replays from its own reset.
  if (input.y && state.tick === 0 && state.resetLatch) {
    finishRun();
    resetSecondary(secondary);
    startRun(true);
  } else if (recorder.recording && recorder.frames.length >= MAX_RUN_TICKS) {
    finishRun();
    readout.session = 'run over 10 min — reset (Y) to record again';
  }
}

function startRun(latched: boolean): void {
  cursor = null;
  replaying = null;
  liveHashes = [];
  liveSecondaryHashes = [];
  run = { take: null, notes: [], latched, index: ++runCount };
  runTricks = [];
  tricks.reset();
  recorder.start();
  readout.session = `live — run ${run.index} recording`;
}

function addMark(tag: NoteTag): void {
  const target = cursor && replaying ? replaying : recorder.recording ? run : null;
  if (!target) {
    feedback.status = 'not recording — reset (Y) first';
    return;
  }
  const at = cursor && replaying ? cursor.index : recorder.frames.length;
  const note = makeNote(at, tag, state);
  if (readout.trick !== '—') note.trick = readout.trick;
  target.notes.push(note);
  if (target.take) {
    target.take.notes = target.notes;
    if (!kept.includes(target)) kept.push(target);
  }
  const label = `run ${target.index} · ${(at * TICK_DT).toFixed(1)} s`;
  panel.addNote(note, label, () => watchAgain(target, note));
  updateFeedbackStatus();
}

function updateFeedbackStatus(): void {
  const runs = kept.filter((r) => r !== run).length + (run.notes.length > 0 ? 1 : 0);
  const count = kept.reduce((n, r) => (r === run ? n : n + r.notes.length), 0) + run.notes.length;
  feedback.status = `${count} mark${count === 1 ? '' : 's'} in ${runs} run${runs === 1 ? '' : 's'}`;
}

/** Replay a marked run from two seconds before the note, fast-forwarded to there. */
function watchAgain(target: Run, note: Note): void {
  if (!target.take) finishRun();
  const take = target.take;
  if (!take) return;
  resetRiderState(state);
  state.resetLatch = take.startLatched === true;
  resetSecondary(secondary);
  cursor = createReplayCursor(take.frames);
  replaying = target;
  const from = Math.max(0, note.tick - 2 / TICK_DT);
  for (let i = 0; i < from; i++) {
    const frame = cursor.next();
    if (!frame) break;
    tick(state, frame, params, terrain, TICK_DT);
    stepSecondary(secondary, state, params, TICK_DT);
  }
  copyRiderState(previous, state);
  copySecondary(secondaryPrevious, secondary);
  tricks.reset();
  chase.snap(interpolateRider(previous, state, 1), params);
  readout.session = `watching run ${target.index} — marks now go on this run`;
}

async function downloadFeedback(): Promise<void> {
  // The run being ridden goes in as it stands, without stopping it.
  const runs: Take[] = kept.filter((r) => r !== run && r.take).map((r) => r.take as Take);
  if (run.notes.length > 0 && recorder.recording) {
    const take = buildTake({
      seed: SEED,
      dt: TICK_DT,
      spawn,
      terrain: slopeConfig,
      params,
      frames: recorder.frames.slice(),
      startLatched: run.latched,
    });
    take.notes = run.notes;
    if (runTricks.length > 0) take.tricks = runTricks.slice();
    runs.push(take);
  } else if (run.take && run.notes.length > 0) {
    runs.push(run.take);
  }
  if (runs.length === 0) {
    feedback.status = 'nothing marked yet';
    return;
  }
  const file: Feedback = {
    kind: 'camber-feedback',
    version: 1,
    build: __BUILD__,
    tester: feedback.tester,
    created: new Date().toISOString(),
    runs,
  };
  const json = JSON.stringify(file);
  const who = (feedback.tester || 'tester').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const stamp = file.created.slice(0, 16).replace(/[:T]/g, '-');
  // Gzipped where the browser can: takes are repetitive, so this is roughly a tenth the size.
  if (typeof CompressionStream !== 'undefined') {
    const gz = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    saveBlob(`camber-feedback-${who}-${stamp}.json.gz`, gz);
  } else {
    download(`camber-feedback-${who}-${stamp}.json`, json);
  }
}

function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// M marks from the keyboard, unless you are typing a note into the panel.
addEventListener('keydown', (ev) => {
  const t = ev.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (ev.key === 'm' || ev.key === 'M') pendingMark = 'note';
});

let lastLanding: RiderState['landing'] = 'none';
let lastRender = performance.now();
let refreshCounter = 0;

function render(alpha: number): void {
  if (pollPause() && !poseMode) pausePressed();
  if (pollHelp() && !poseMode) help.toggle();
  // Paused, the last tick exactly: blending toward it from the one before would shake.
  if (paused) alpha = 1;
  const now = performance.now();
  const dt = Math.min((now - lastRender) / 1000, 0.1);
  lastRender = now;

  const rider = interpolateRider(previous, state, alpha);
  // The preview is authoring state, not sim state, so it keeps the real render dt. The hip
  // spring no longer does — it is stepped on the sim tick and sampled here.
  if (poseMode) updatePreview(dt);
  sampleSecondary(secondaryView, secondaryPrevious, secondary, alpha);
  view.updateRider(rider, params, poseMode, secondaryView, dt);
  if (poseMode) {
    orbit.update(rider);
  } else {
    spray.update(rider, params, paused ? 0 : dt);
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
  inputOverlay.draw();

  if (++refreshCounter % 6 === 0) {
    readout.pad = padSummary();
    readout.padRaw = padRawSummary();
    readout.mode = state.mode;
    readout.rail =
      state.mode === 'railed'
        ? `slide ${Math.round((state.slide * 180) / Math.PI)}°  lean ${state.balance.toFixed(2)} / ${params.rail.balanceMax}`
        : '—';
    readout.speed = length(state.velocity);
    readout.tick = state.tick;
    readout.clearance = state.clearance;
    readout.air = state.mode === 'airborne' ? state.airTime : 0;
    const st = view.strain;
    const sf = view.shortfall;
    // Centimetres short, not just the ratio: while you are dragging a slider what you need to
    // know is how much further to go, and "8 cm SHORT" answers that where "1.12" doesn't.
    const hand = (reach: number, miss: number) =>
      reach === 0
        ? '—'
        : miss > 0.0001
          ? `${reach.toFixed(2)} ${(miss * 100).toFixed(0)}cm SHORT`
          : reach > params.grab.reachWarn
            ? `${reach.toFixed(3)} SNUG`
            : reach.toFixed(2);
    readout.reach =
      st.front === 0 && st.back === 0
        ? 'no grab'
        : `front ${hand(st.front, sf.front)}   back ${hand(st.back, sf.back)}`;
    const legs = view.legSpan;
    const flex = (d: number) => {
      const t = params.rig.thigh;
      const sh = params.rig.shin;
      const c = (t * t + sh * sh - Math.min(d, t + sh - 1e-3) ** 2) / (2 * t * sh);
      return (180 - (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI).toFixed(0);
    };
    readout.knees = `front ${flex(legs.front)}°  back ${flex(legs.back)}°`;
    readout.spin = state.spinRate;
    readout.rotated = (state.airYaw * 180) / Math.PI;
    readout.landing = state.landing;
    panel.refresh();
  }
}

function stepAnchor(delta: number): void {
  const names = Object.keys(ANCHORS);
  anchorIndex = (anchorIndex + delta + names.length) % names.length;
  const name = names[anchorIndex];
  const anchor = name ? ANCHORS[name] : undefined;
  if (!name || !anchor) return;
  stopPreview();
  copyDrivers(view.drivers, anchor);
  readout.session = `pose mode — ${name}`;
  panel.refresh();
}

function startReplay(): void {
  finishRun();
  if (!currentTake) return;
  resetRiderState(state);
  state.resetLatch = currentTake.startLatched === true;
  tricks.reset();
  copyRiderState(previous, state);
  // Without this the springs would enter the replay carrying the end of the live run, and
  // the take's secondary stream would never match no matter how correct the stepping is.
  resetSecondary(secondary);
  copySecondary(secondaryPrevious, secondary);
  cursor = createReplayCursor(currentTake.frames);
  replaying = kept.find((r) => r.take === currentTake) ?? null;
  readout.session = `replay (${currentTake.frames.length} ticks, live params)`;
}

function finishRun(): void {
  if (!recorder.recording) return;
  recorder.stop();
  if (recorder.frames.length === 0) return;
  currentTake = buildTake({
    seed: SEED,
    dt: TICK_DT,
    spawn,
    terrain: slopeConfig,
    params,
    frames: recorder.frames,
    startLatched: run.latched,
  });
  run.take = currentTake;
  if (runTricks.length > 0) currentTake.tricks = runTricks;
  if (run.notes.length > 0) {
    currentTake.notes = run.notes;
    if (!kept.includes(run)) kept.push(run);
  }
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

const panel = createPanel(params, readout, view.drivers, preview, feedback, {
  onDownloadFeedback: () => void downloadFeedback(),
  onTrickText: (on) => trickText.setEnabled(on),
  onInputOverlay: (on) => inputOverlay.setEnabled(on),
  onDressed: (on) => view.setDressed(on),
  onPoseMode: (on) => {
    // Leaving pose mode mid-preview would leave a half-blended pose in the document.
    if (!on) {
      preview.play = false;
      preview.phase = 0;
      stopPreview();
    }
    poseMode = on;
    orbit.setEnabled(on);
    view.setStage(on);
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
      anchorIndex = Object.keys(ANCHORS).indexOf(name); // so "write to anchor" targets this one
      stopPreview(); // so the snapshot is retaken against the anchor being switched to
      copyDrivers(view.drivers, anchor);
      panel.refresh();
    }
  },
  onStepAnchor: stepAnchor,
  onWriteAnchor: () => {
    stopPreview();
    const name = Object.keys(ANCHORS)[anchorIndex];
    const anchor = name ? ANCHORS[name] : undefined;
    if (!name || !anchor || name === 'neutral') return;
    copyDrivers(anchor, view.drivers);
    anchorToParams(name, anchor);
    persistAnchors();
    panel.refresh();
  },
  onSaveAnchors: () => download('anchors.json', JSON.stringify(ANCHORS, null, 2)),
  onLoadAnchors: (json) => {
    applyAnchors(JSON.parse(json) as Record<string, Partial<RigDrivers>>);
    persistAnchors();
    panel.refresh();
  },
  // Save the authored pose, never a half-blended preview frame.
  onSavePose: () => {
    stopPreview();
    download('pose.json', JSON.stringify(view.drivers, null, 2));
  },
  onLoadPose: (json) => {
    stopPreview();
    const loaded = { ...neutralDrivers(), ...(JSON.parse(json) as Partial<RigDrivers>) };
    copyDrivers(view.drivers, loaded);
    panel.refresh();
  },
  // Reset and record are the same now: every run records from its reset.
  onReset: () => restart(),
  onRecord: () => {
    restart();
    readout.determinism = '—';
  },
  onStopRecord: finishRun,
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
    // The run being ridden, not the last one a reset finished — saving mid-session used
    // to hand over whatever short run came before. Recording resumes at the next reset.
    if (recorder.recording && !cursor) {
      finishRun();
      readout.session = `take saved (${currentTake?.frames.length ?? 0} ticks) — reset (Y) to record again`;
    }
    if (currentTake) download(`take-${currentTake.frames.length}.json`, JSON.stringify(currentTake));
  },
  onLoadTake: (json) => {
    finishRun(); // keep the live run's marks; replay then plays the loaded take, not it
    currentTake = JSON.parse(json) as Take;
    readout.session = `take loaded (${currentTake.frames.length} ticks)`;
  },
  onSavePreset: () => download('preset.json', JSON.stringify(cloneParams(params), null, 2)),
  onLoadPreset: (json) => {
    applyParams(params, JSON.parse(json) as Params);
    panel.refresh();
  },
});

function restart(): void {
  finishRun();
  resetRiderState(state);
  copyRiderState(previous, state);
  resetSecondary(secondary);
  copySecondary(secondaryPrevious, secondary);
  chase.snap(interpolateRider(previous, state, 1), params);
  startRun(false);
}

startRun(false);
chase.snap(interpolateRider(previous, state, 1), params);
createLoop(step, render).start();
