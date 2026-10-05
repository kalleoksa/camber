import type { Pane } from 'tweakpane';
import { BAND_LEGEND, type Overlays } from '../render/debugOverlays.ts';

/**
 * The park folder: which park, the generator's seed, and the debug overlays. A new seed
 * reloads the page on it (?park=gen&seed=N), so the whole world is rebuilt from the layout
 * and the URL can be shared.
 */
export function addParkFolder(pane: Pane, park: string, seed: number, overlays: Overlays): void {
  // ?overlay=heatmap starts with it on, for sharing a link to what's being looked at.
  const state = { park, seed, heatmap: new URLSearchParams(location.search).get('overlay') === 'heatmap', legend: BAND_LEGEND };
  overlays.setHeatmap(state.heatmap);
  const folder = pane.addFolder({ title: 'park', expanded: false });
  folder.addBinding(state, 'park', { readonly: true });
  folder.addBinding(state, 'seed', { step: 1, min: 1, format: (v: number) => v.toFixed(0) });
  const go = (s: number): void => {
    location.search = `?park=gen&seed=${s}${state.heatmap ? '&overlay=heatmap' : ''}`;
  };
  folder.addButton({ title: 'load seed' }).on('click', () => go(Math.round(state.seed)));
  folder.addButton({ title: 'regenerate (new seed)' }).on('click', () => go(1 + Math.floor(Math.random() * 99999)));
  folder.addButton({ title: 'old park (fallback)' }).on('click', () => {
    location.search = '?park=home';
  });
  folder.addBinding(state, 'heatmap', { label: 'slope heatmap' }).on('change', (ev) => overlays.setHeatmap(ev.value));
  folder.addBinding(state, 'legend', { readonly: true, multiline: true, rows: 3, label: 'bands' });
}
