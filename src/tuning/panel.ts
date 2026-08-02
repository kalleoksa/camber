import { Pane } from 'tweakpane';
import type { Params, ParamGroup } from '../sim/params.ts';

export type Readout = {
  mode: string;
  session: string;
  speed: number;
  tick: number;
  clearance: number;
  air: number;
  landing: string;
  determinism: string;
};

export type PanelHandlers = {
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

export function createPanel(params: Params, readout: Readout, handlers: PanelHandlers): { refresh(): void } {
  const pane = new Pane({ title: 'camber' });

  const status = pane.addFolder({ title: 'status' });
  status.addBinding(readout, 'session', { readonly: true });
  status.addBinding(readout, 'mode', { readonly: true });
  status.addBinding(readout, 'speed', { readonly: true, format: (v: number) => v.toFixed(2) });
  status.addBinding(readout, 'tick', { readonly: true, format: (v: number) => v.toFixed(0) });
  status.addBinding(readout, 'clearance', { readonly: true, format: (v: number) => v.toFixed(2) });
  status.addBinding(readout, 'air', { readonly: true, format: (v: number) => v.toFixed(2) });
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
