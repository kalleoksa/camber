import * as THREE from 'three';
import type { FolderApi, Pane } from 'tweakpane';
import type { Layout } from '../park/layout.ts';
import type { PatchConfig } from '../sim/heightfield.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';
import { patchStep } from './edits.ts';

/**
 * The ground folder: base pitch, banks and the heightfield's band patches as data — not
 * sculpting. The selected patch is outlined on the snow (inner line: full height, outer: where
 * its edge fade ends). Changes apply on release: the field re-bakes and the park is rebuilt.
 */
export type GroundPanel = {
  refresh(): void;
  /** Select patch `i` (−1: none), as a click on the snow does. */
  select(i: number): void;
  selected(): number;
  /** Redraw the selected patch's outline: while it is dragged, before the snow is re-baked. */
  outline(): void;
  show(on: boolean): void;
  dispose(): void;
};

const DEG = 180 / Math.PI;

export function addGroundFolder(
  pane: Pane,
  scene: THREE.Scene,
  get: () => Layout,
  terrain: () => Terrain,
  focus: () => { x: number; z: number },
  changed: () => void,
  heatmap: (on: boolean) => void,
  selected: (i: number) => void,
): GroundPanel {
  const folder = pane.addFolder({ title: 'ground', expanded: false });
  const outline = new THREE.Group();
  scene.add(outline);
  const state = { patch: -1, heatmap: false, step: '—' };
  let body: FolderApi | undefined;
  const c = createContact();

  const patches = (): PatchConfig[] => get().ground.field?.patches ?? [];

  const stepOf = (p: PatchConfig): number => patchStep(p, get().ground.field?.pitch ?? get().ground.pitch);

  const drawOutline = (): void => {
    for (const o of outline.children) (o as THREE.Line).geometry.dispose();
    outline.clear();
    const p = patches()[state.patch];
    if (!p) return;
    let total = 0;
    for (const [len] of p.segs) total += len;
    const cs = Math.cos(p.yaw);
    const sn = Math.sin(p.yaw);
    // The patch frame (heightfield.ts): `along` down its axis from (x, z), `across` its width.
    const at = (along: number, across: number): THREE.Vector3 => {
      const x = p.x + across * cs + along * sn;
      const z = p.z - along * cs + across * sn;
      return new THREE.Vector3(x, terrain().sample(x, z, c).height + 0.25, z);
    };
    for (const [w, colour] of [
      [p.halfWidth, 0x1f6fd6],
      [p.halfWidth + p.edge, 0x8fb6e8],
    ] as const) {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= total; s += 2) pts.push(at(s, -w));
      for (let a = -w; a <= w; a += 2) pts.push(at(total, a));
      for (let s = total; s >= 0; s -= 2) pts.push(at(s, w));
      for (let a = w; a >= -w; a -= 2) pts.push(at(0, a));
      outline.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: colour, depthTest: false })));
    }
    // Segment boundaries across it, so you can tell which is which.
    let s = 0;
    for (const [len] of p.segs.slice(0, -1)) {
      s += len;
      const pts: THREE.Vector3[] = [];
      for (let a = -p.halfWidth; a <= p.halfWidth; a += 2) pts.push(at(s, a));
      outline.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x1f6fd6, depthTest: false })));
    }
  };

  const apply = (): void => {
    changed();
    drawOutline();
    const p = patches()[state.patch];
    state.step = p ? `${stepOf(p).toFixed(2)} m` : '—';
  };

  const build = (): void => {
    body?.dispose();
    const g = get().ground;
    const f = g.field;
    body = folder.addFolder({ title: f ? 'heightfield' : 'plane', expanded: true });
    const base = { pitch: g.pitch * DEG };
    body.addBinding(base, 'pitch', { label: 'base pitch °', min: 0, max: 40, step: 0.1 }).on('change', (ev) => {
      if (!ev.last) return;
      g.pitch = base.pitch / DEG;
      if (f) f.pitch = g.pitch;
      apply();
    });
    if (!f) return;
    body.addBinding(f, 'bankWidth', { label: 'bank width m', min: 0, max: 40, step: 0.5 }).on('change', (ev) => ev.last && apply());
    body.addBinding(f, 'bankHeight', { label: 'bank height m', min: 0, max: 15, step: 0.1 }).on('change', (ev) => ev.last && apply());

    const options: Record<string, number> = { none: -1 };
    f.patches.forEach((p, i) => (options[`${i}${p.natural ? ' (natural)' : ''} at z ${p.z.toFixed(0)}`] = i));
    if (state.patch >= f.patches.length) state.patch = -1;
    body.addBinding(state, 'patch', { options }).on('change', () => {
      selected(state.patch);
      later();
    });
    body.addButton({ title: 'add patch here' }).on('click', () => {
      const at = focus();
      f.patches.push({ x: at.x, z: at.z, yaw: 0, halfWidth: 8, edge: 4, blend: 4, segs: [[20, g.pitch * 0.5], [10, g.pitch * 2]] });
      state.patch = f.patches.length - 1;
      apply();
      selected(state.patch);
      later();
    });
    const p = f.patches[state.patch];
    drawOutline();
    if (!p) return;
    state.step = `${stepOf(p).toFixed(2)} m`;
    body.addButton({ title: 'remove patch' }).on('click', () => {
      f.patches.splice(state.patch, 1);
      state.patch = -1;
      apply();
      selected(-1);
      later();
    });
    const frame = { yaw: p.yaw * DEG };
    body.addBinding(p, 'x', { step: 0.5 }).on('change', (ev) => ev.last && apply());
    body.addBinding(p, 'z', { step: 0.5 }).on('change', (ev) => ev.last && apply());
    body.addBinding(frame, 'yaw', { label: 'yaw °', min: -60, max: 60, step: 1 }).on('change', (ev) => {
      if (!ev.last) return;
      p.yaw = frame.yaw / DEG;
      apply();
    });
    body.addBinding(p, 'halfWidth', { label: 'half width m', min: 1, max: 60, step: 0.5 }).on('change', (ev) => ev.last && apply());
    body.addBinding(p, 'edge', { label: 'edge fade m', min: 0.5, max: 30, step: 0.5 }).on('change', (ev) => ev.last && apply());
    body.addBinding(p, 'blend', { label: 'blend m', min: 0.5, max: 30, step: 0.5 }).on('change', (ev) => ev.last && apply());
    body.addBinding(state, 'step', { readonly: true, label: 'step at end' });
    p.segs.forEach((seg, i) => {
      const s = { length: seg[0], pitch: seg[1] * DEG };
      const row = body?.addFolder({ title: `segment ${i + 1}`, expanded: true });
      row?.addBinding(s, 'length', { label: 'length m', min: 0.5, max: 120, step: 0.5 }).on('change', (ev) => {
        if (!ev.last) return;
        seg[0] = s.length;
        apply();
      });
      row?.addBinding(s, 'pitch', { label: 'pitch °', min: -10, max: 60, step: 0.5 }).on('change', (ev) => {
        if (!ev.last) return;
        seg[1] = s.pitch / DEG;
        apply();
      });
    });
    body.addButton({ title: 'add segment' }).on('click', () => {
      p.segs.push([10, g.pitch]);
      apply();
      later();
    });
    body.addButton({ title: 'remove last segment' }).on('click', () => {
      if (p.segs.length < 2) return;
      p.segs.pop();
      apply();
      later();
    });
  };

  // Rebuilt after the event that asked for it: a folder can't be disposed inside its own handler.
  const later = (): void => void setTimeout(build, 0);
  folder.addBinding(state, 'heatmap', { label: 'slope heatmap' }).on('change', (ev) => heatmap(ev.value));
  build();
  return {
    refresh: build,
    select(i) {
      state.patch = i;
      if (i >= 0) folder.expanded = true;
      later();
      drawOutline();
    },
    selected: () => state.patch,
    outline: drawOutline,
    show(on) {
      outline.visible = on;
    },
    dispose() {
      for (const o of outline.children) (o as THREE.Line).geometry.dispose();
      scene.remove(outline);
      folder.dispose();
    },
  };
}
