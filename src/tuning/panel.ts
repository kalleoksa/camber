import { Pane } from 'tweakpane';
import { ANCHOR_NAMES } from '../render/poses.ts';
import type { RigDrivers } from '../render/rig.ts';
import type { Params, ParamGroup } from '../sim/params.ts';

/** Slider ranges for the driver vector, so posing by hand is actually workable. */
const DRIVER_RANGE: Record<keyof RigDrivers, { min: number; max: number }> = {
  hipX: { min: -0.35, max: 0.35 },
  hipY: { min: -0.8, max: 0.2 },
  hipZ: { min: -0.45, max: 0.45 },
  hipYaw: { min: -1.2, max: 1.2 },
  hipPitch: { min: -0.8, max: 0.8 },
  hipRoll: { min: -0.8, max: 0.8 },
  spineBend: { min: -1.6, max: 1.6 },
  spineSide: { min: -0.9, max: 0.9 },
  spineTwist: { min: -1.2, max: 1.2 },
  frontHandEdge: { min: -1, max: 1 },
  frontHandT: { min: 0, max: 1 },
  backHandEdge: { min: -1, max: 1 },
  backHandT: { min: 0, max: 1 },
  frontGrip: { min: 0, max: 1 },
  backGrip: { min: 0, max: 1 },
  tweak: { min: 0, max: 1 },
  headYaw: { min: -1.4, max: 1.4 },
  headPitch: { min: -0.8, max: 0.8 },
  kneeSplay: { min: -1.2, max: 3.1 }, // past pi/2 the knees break back — a method needs it
  stanceScale: { min: 0.7, max: 1.4 },
  boardLift: { min: 0, max: 0.7 },
  boardBack: { min: -0.2, max: 0.7 },
  freeArmRaise: { min: 0, max: 1 },
};

export type Readout = {
  mode: string;
  session: string;
  pad: string;
  padRaw: string;
  speed: number;
  tick: number;
  clearance: number;
  air: number;
  reach: string;
  spin: number;
  rotated: number;
  landing: string;
  determinism: string;
};

export type PanelHandlers = {
  onPoseMode(on: boolean): void;
  onAnchor(name: string): void;
  onSavePose(): void;
  onLoadPose(json: string): void;
  onReset(): void;
  onRecord(): void;
  onStopRecord(): void;
  onReplay(): void;
  onVerify(): void;
  onSaveTake(): void;
  onLoadTake(json: string): void;
  onSavePreset(): void;
  onLoadPreset(json: string): void;
};

export function download(filename: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function pickFile(onRead: (json: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then(onRead);
  });
  input.click();
}

/** Tweakpane infers nothing useful about scale, so derive a step from the value itself. */
function stepFor(value: number): number {
  if (value === 0) return 0.01;
  return Math.max(10 ** (Math.floor(Math.log10(Math.abs(value))) - 2), 1e-5);
}

export function createPanel(
  params: Params,
  readout: Readout,
  drivers: RigDrivers,
  handlers: PanelHandlers,
): { refresh(): void } {
  const pane = new Pane({ title: 'camber' });

  const status = pane.addFolder({ title: 'status' });
  status.addBinding(readout, 'session', { readonly: true });
  status.addBinding(readout, 'pad', { readonly: true });
  status.addBinding(readout, 'padRaw', { readonly: true, label: 'pad raw' });
  status.addBinding(readout, 'mode', { readonly: true });
  status.addBinding(readout, 'speed', { readonly: true, format: (v: number) => v.toFixed(2) });
  status.addBinding(readout, 'tick', { readonly: true, format: (v: number) => v.toFixed(0) });
  status.addBinding(readout, 'clearance', { readonly: true, format: (v: number) => v.toFixed(2) });
  status.addBinding(readout, 'air', { readonly: true, format: (v: number) => v.toFixed(2) });
  status.addBinding(readout, 'reach', { readonly: true });
  status.addBinding(readout, 'spin', { readonly: true, format: (v: number) => v.toFixed(2) });
  status.addBinding(readout, 'rotated', { readonly: true, format: (v: number) => `${v.toFixed(0)}°` });
  status.addBinding(readout, 'landing', { readonly: true });
  status.addBinding(readout, 'determinism', { readonly: true });

  const take = pane.addFolder({ title: 'take' });
  take.addButton({ title: 'reset (Y)' }).on('click', handlers.onReset);
  take.addButton({ title: 'record' }).on('click', handlers.onRecord);
  take.addButton({ title: 'stop' }).on('click', handlers.onStopRecord);
  take.addButton({ title: 'replay' }).on('click', handlers.onReplay);
  take.addButton({ title: 'verify determinism' }).on('click', handlers.onVerify);
  take.addButton({ title: 'save take' }).on('click', handlers.onSaveTake);
  take.addButton({ title: 'load take' }).on('click', () => pickFile(handlers.onLoadTake));

  // Pose mode: gameplay disconnected, every driver on a slider. Build order step 2, and
  // the milestone 4 gate — a method has to be reachable here before gameplay touches it.
  const poseState = { poseMode: false, anchor: ANCHOR_NAMES[0] ?? 'neutral' };
  const pose = pane.addFolder({ title: 'pose mode', expanded: false });
  pose.addBinding(poseState, 'poseMode', { label: 'enabled' }).on('change', (ev) => {
    handlers.onPoseMode(ev.value);
  });
  pose
    .addBinding(poseState, 'anchor', {
      options: Object.fromEntries(ANCHOR_NAMES.map((n) => [n, n])),
    })
    .on('change', (ev) => handlers.onAnchor(String(ev.value)));
  pose.addButton({ title: 'save pose' }).on('click', handlers.onSavePose);
  pose.addButton({ title: 'load pose' }).on('click', () => pickFile(handlers.onLoadPose));

  const driverFolder = pose.addFolder({ title: 'drivers', expanded: true });
  for (const key of Object.keys(drivers) as (keyof RigDrivers)[]) {
    const range = DRIVER_RANGE[key];
    driverFolder.addBinding(drivers, key, { min: range.min, max: range.max, step: 0.01 });
  }

  const preset = pane.addFolder({ title: 'preset' });
  preset.addButton({ title: 'save preset' }).on('click', handlers.onSavePreset);
  preset.addButton({ title: 'load preset' }).on('click', () => pickFile(handlers.onLoadPreset));

  for (const name of Object.keys(params) as ParamGroup[]) {
    const group = params[name] as Record<string, number>;
    const folder = pane.addFolder({ title: name, expanded: name === 'ground' });
    for (const key of Object.keys(group)) {
      folder.addBinding(group, key, { step: stepFor(group[key] ?? 0) });
    }
  }

  return { refresh: () => pane.refresh() };
}
