import type { Pane } from 'tweakpane';
import { LEGEND, type OverlayName, type Overlays } from '../render/debugOverlays.ts';

/**
 * The park folder: which park, the generator's seed, and the debug overlays. A new seed
 * reloads the page on it (?park=gen&seed=N), so the whole world is rebuilt from the layout
 * and the URL can be shared; ?overlay=slope|speed starts with that overlay showing.
 */
export function addParkFolder(pane: Pane, park: string, seed: number, overlays: Overlays): void {
  const query = new URLSearchParams(location.search);
  const start = query.get('overlay');
  const overlay: OverlayName = start === 'slope' || start === 'speed' ? start : 'none';
  const state = { park, seed, overlay, legend: LEGEND[overlay] };
  overlays.show(overlay);
  const folder = pane.addFolder({ title: 'park', expanded: false });
  folder.addBinding(state, 'park', { readonly: true });
  folder.addBinding(state, 'seed', { step: 1, min: 1, format: (v: number) => v.toFixed(0) });
  const go = (s: number): void => {
    location.search = `?park=gen&seed=${s}${state.overlay !== 'none' ? `&overlay=${state.overlay}` : ''}`;
  };
  folder.addButton({ title: 'load seed' }).on('click', () => go(Math.round(state.seed)));
  folder.addButton({ title: 'regenerate (new seed)' }).on('click', () => go(1 + Math.floor(Math.random() * 99999)));
  folder.addButton({ title: 'old park (fallback)' }).on('click', () => {
    location.search = '?park=home';
  });
  const legend = folder.addBinding(state, 'legend', { readonly: true, multiline: true, rows: 4, label: 'key' });
  folder
    .addBinding(state, 'overlay', { options: { none: 'none', 'slope heatmap': 'slope', 'speed map': 'speed' } })
    .on('change', (ev) => {
      overlays.show(ev.value);
      state.legend = LEGEND[ev.value];
      legend.refresh();
    });
}
