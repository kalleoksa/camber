import type { Pane } from 'tweakpane';
import type { Layout } from '../park/layout.ts';
import { LEGEND, type OverlayName, type Overlays } from '../render/debugOverlays.ts';

/**
 * The park folder: which park, the generator's seed, layouts in and out as JSON, and the debug
 * overlays. A new seed reloads the page on it (?seed=N), so the whole world is rebuilt from the layout
 * and the URL can be shared; ?overlay=slope|speed|arcs|lines|graph starts with that overlay showing,
 * &view=top with the overview camera, &preview=1 with the trajectory preview, &at=x,z[,deg] at
 * that spot.
 */
export type ParkHandlers = { onOverview(on: boolean): void; onTrajectory(on: boolean): void; onExport(): void; onLoadLayout(json: string): void };

export function addParkFolder(pane: Pane, layout: Layout, seedAsked: number, overlays: Overlays, handlers: ParkHandlers): void {
  const park = layout.seed !== undefined ? `${layout.name}${layout.roll ? ` (re-roll ${layout.roll})` : ''}` : layout.name;
  const seed = layout.seed ?? seedAsked;
  const query = new URLSearchParams(location.search);
  const start = query.get('overlay');
  const overlay: OverlayName = start === 'slope' || start === 'speed' || start === 'arcs' || start === 'lines' || start === 'graph' ? start : 'none';
  const state = { park, seed, overlay, legend: LEGEND[overlay], overview: query.get('view') === 'top', trajectory: query.get('preview') === '1' };
  overlays.show(overlay);
  handlers.onOverview(state.overview);
  handlers.onTrajectory(state.trajectory);
  const folder = pane.addFolder({ title: 'park', expanded: false });
  folder.addBinding(state, 'park', { readonly: true });
  folder.addBinding(state, 'seed', { step: 1, min: 1, format: (v: number) => v.toFixed(0) });
  const go = (s: number): void => {
    location.search = `?seed=${s}${state.overlay !== 'none' ? `&overlay=${state.overlay}` : ''}${state.overview ? '&view=top' : ''}${state.trajectory ? '&preview=1' : ''}`;
  };
  folder.addButton({ title: 'load seed' }).on('click', () => go(Math.round(state.seed)));
  folder.addButton({ title: 'regenerate (new seed)' }).on('click', () => go(1 + Math.floor(Math.random() * 99999)));
  folder.addButton({ title: 'old park (fallback)' }).on('click', () => {
    location.search = '?park=home';
  });
  // Layouts as files: the generated one out, any (hand-built later) in — same format.
  folder.addButton({ title: 'export layout JSON' }).on('click', handlers.onExport);
  folder.addButton({ title: 'load layout JSON' }).on('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', () => void input.files?.[0]?.text().then(handlers.onLoadLayout));
    input.click();
  });
  const legend = folder.addBinding(state, 'legend', { readonly: true, multiline: true, rows: 4, label: 'key' });
  folder
    .addBinding(state, 'overlay', { options: { none: 'none', 'slope heatmap': 'slope', 'speed map': 'speed', 'design arcs': 'arcs', lines: 'lines', 'connection graph': 'graph' } })
    .on('change', (ev) => {
      overlays.show(ev.value);
      state.legend = LEGEND[ev.value];
      legend.refresh();
    });
  // A camera high above the rider looking down the hill, for reading the overlays (&view=top).
  folder.addBinding(state, 'overview', { label: 'overview camera' }).on('change', (ev) => handlers.onOverview(ev.value));
  // The air you'd get off the next lip at the speed you carry, coloured by how it lands (&preview=1).
  folder.addBinding(state, 'trajectory', { label: 'trajectory preview' }).on('change', (ev) => handlers.onTrajectory(ev.value));
}
