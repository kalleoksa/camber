import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Pane, type FolderApi } from 'tweakpane';
import { GEN } from '../gen/config.ts';
import type { Kind } from '../gen/lines.ts';
import type { Size } from '../gen/kit.ts';
import { popRange } from '../gen/flight.ts';
import type { Design, FeatureSpec, Layout } from '../park/layout.ts';
import type { PatchConfig } from '../sim/heightfield.ts';
import type { OverlayName } from '../render/debugOverlays.ts';
import type { Rect } from '../render/terrainMesh.ts';
import type { Params } from '../sim/params.ts';
import type { Spawn } from '../sim/state.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';
import { createEditCamera } from './camera.ts';
import {
  design,
  designOf,
  designSpeed,
  featureAt,
  freeGroup,
  groundOf,
  groupOf,
  mirrored,
  moved,
  newPatch,
  originOf,
  patchAt,
  printOf,
  rectOf,
  removeFeatures,
  replaceParts,
  rideSpawn,
  sizesOf,
  type Place,
} from './edits.ts';
import { lipOf, takeoffOf, validate, type Verdict } from './airs.ts';
import { addGroundFolder } from './groundPanel.ts';
import { createMarks } from './marks.ts';
import { createProfile } from './profile.ts';
import { createHistory, dropCopy, hashOf, keepCopy, localCopy, parkKey } from './store.ts';

/**
 * The park editor (docs/park-editor-plan.md), loaded only when edit mode is first opened. It
 * edits the layout and nothing else: every change goes back through `setPark`, which builds the
 * terrain from the layout as a load does, and every shape comes from the kit or the configs.
 */
export type EditorHost = {
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  params: Params;
  layout(): Layout;
  /** The park as shipped (before any local copy): for reset, and to notice it changed. */
  original: Layout;
  terrain(): Terrain;
  setPark(layout: Layout, changed?: readonly Rect[]): void;
  /** Leave edit mode and ride: from `spawn` when given, else from the last start. */
  ride(spawn?: Spawn): void;
  /** Show one of the park's overlays (render/debugOverlays.ts), or none. */
  overlay(name: OverlayName): void;
  download(name: string, json: string): void;
};

export type Editor = { camera: THREE.PerspectiveCamera; enter(): void; leave(): void; update(dt: number): void };

const KINDS: Kind[] = ['kicker', 'stepUp', 'stepDown', 'hip', 'stepDownHip', 'corner', 'euroGap', 'booter', 'drop', 'quarter', 'hipQuarter', 'wallRide', 'berm', 'rail', 'jibTable', 'gapToRail', 'funBox', 'log', 'wedge', 'mini', 'miniPipe', 'roller', 'spine', 'sideHit', 'knoll'];
const AUTOSAVE = 30; // s between saves of the local copy while editing
const DEG = 180 / Math.PI;
const CLICK = 6; // px a pointer may move and still be a click

export function createEditor(host: EditorHost): Editor {
  const view = createEditCamera(host.canvas);
  const c = createContact();
  const heightAt = (x: number, z: number): number => host.terrain().sample(x, z, c).height;
  let layout = host.layout();
  const history = createHistory(layout);
  const key = parkKey(host.original);
  const base = hashOf(host.original);
  let active = false;
  let dirty = false;
  let sinceSave = 0;
  let pending: Rect[] | null = null; // a rebuild asked for this frame: where
  let framed = false;

  // --- the ground alone, which the kit designs over; the same until the ground changes ---
  let groundKey = '';
  let ground: Terrain = host.terrain();
  const groundNow = (): Terrain => {
    const k = JSON.stringify(layout.ground);
    if (k !== groundKey) {
      groundKey = k;
      ground = groundOf(layout, host.terrain().field);
    }
    return ground;
  };

  // --- panels ---
  const pane = new Pane({ title: 'park editor' });
  const box = pane.element.parentElement;
  if (box) {
    box.style.left = '52px';
    box.style.right = 'auto';
    box.style.maxHeight = CSS.supports('height', '100dvh') ? 'calc(100dvh - 16px)' : 'calc(100vh - 16px)';
    box.style.overflowY = 'auto';
    box.style.overscrollBehavior = 'contain';
    box.style.display = 'none';
  }
  const status = { text: 'click a feature, or pick one from "place" and click the snow' };
  const say = (text: string): void => {
    status.text = text;
  };

  // --- selection and the gizmo: features, or one terrain patch ---
  let sel: number[] = [];
  let patch = -1;
  const patchOf = (): PatchConfig | undefined => layout.ground.field?.patches[patch];
  const basePitch = (): number => layout.ground.field?.pitch ?? layout.ground.pitch;
  /** m along a patch's axis from its start to the bottom of the park: as long as it may run. */
  const reachOf = (p: PatchConfig): number => Math.max(1, (p.z + layout.ground.length) / Math.max(0.2, Math.cos(p.yaw)));
  const pivot = new THREE.Object3D();
  host.scene.add(pivot);
  const gizmo = new TransformControls(view.camera, host.canvas);
  gizmo.setSpace('world');
  gizmo.attach(pivot);
  const helper = gizmo.getHelper();
  host.scene.add(helper);
  const setMode = (mode: 'translate' | 'rotate'): void => {
    gizmo.setMode(mode);
    gizmo.showX = mode === 'translate';
    gizmo.showZ = mode === 'translate';
    gizmo.showY = mode === 'rotate';
  };
  setMode('translate');
  gizmo.addEventListener('dragging-changed', (ev) => {
    view.controls.enabled = active && !ev.value;
    if (ev.value) startDrag();
    else endDrag();
  });
  gizmo.addEventListener('objectChange', () => drag());

  const placeOf = (parts: readonly number[]): Place => {
    const d = designOf(layout, parts);
    if (d) return { ...d.design.place };
    const f = layout.features[parts[0] ?? -1];
    return f ? originOf(f) : { x: 0, z: 0, yaw: 0 };
  };
  const seatPivot = (): void => {
    const pa = patchOf();
    const on = (sel.length > 0 || !!pa) && active;
    helper.visible = on;
    gizmo.enabled = on;
    if (pa) {
      pivot.position.set(pa.x, heightAt(pa.x, pa.z), pa.z);
      pivot.rotation.set(0, -pa.yaw, 0);
      return;
    }
    if (!sel.length) return;
    const p = placeOf(sel);
    pivot.position.set(p.x, heightAt(p.x, p.z), p.z);
    pivot.rotation.set(0, -p.yaw, 0); // a feature's yaw turns toward +X; Three's turns the other way
  };
  const rectsOf = (idx: readonly number[]): Rect[] => idx.flatMap((i) => {
    const f = layout.features[i];
    return f ? [rectOf(printOf(f))] : [];
  });

  const select = (idx: number[]): void => {
    // Ascending: a group's parts were added in the kit's order, which a re-solve returns them in.
    sel = [...new Set(idx)].filter((i) => i >= 0 && i < layout.features.length).sort((a, b) => a - b);
    if (patch >= 0) {
      patch = -1;
      groundPanel.select(-1);
    }
    seatPivot();
    buildFeature();
    profile.set(shown());
    describe();
  };
  /** Select terrain patch `i` (−1: none): the gizmo moves and turns it, the profile shows its section. */
  const selectPatch = (i: number, fromPanel = false): void => {
    sel = [];
    patch = i;
    if (!fromPanel) groundPanel.select(i);
    seatPivot();
    buildFeature();
    const p = patchOf();
    if (p) profile.setPatch(p, i, basePitch(), reachOf(p));
    else profile.set(undefined);
  };
  /** The part of the selection the profile shows: the one that takes off, else the first. */
  const shown = (): FeatureSpec | undefined => {
    const parts = sel.map((i) => layout.features[i]).filter((f): f is FeatureSpec => !!f);
    return parts.find((f) => takeoffOf(f)) ?? parts[0];
  };

  // --- checks: validation dots, impact on landings, the profile ---
  const [pop0, pop1] = popRange(host.params);
  const checks = { profile: true, dots: true, impact: false, overlay: 'none' as OverlayName, popMin: pop0, popMax: pop1, turn: 0 };
  const pops = (): [number, number] => [Math.min(checks.popMin, checks.popMax), Math.max(checks.popMin, checks.popMax)];
  const marks = createMarks(host.scene);
  marks.show(false);
  // The park start: an arrow on the snow, the way runs set off.
  const startArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 12, 0x1f6fd6, 4, 2.5);
  startArrow.visible = false;
  host.scene.add(startArrow);
  const showStart = (): void => {
    const s = layout.spawn;
    startArrow.position.set(s.x, heightAt(s.x, s.z) + 0.6, s.z);
    startArrow.setDirection(new THREE.Vector3(Math.sin(s.heading), 0, Math.cos(s.heading)));
    startArrow.visible = active;
  };
  let verdicts: Map<number, Verdict> | undefined;
  const verdictText = { text: '' };
  /** The selected feature's verdict, in words. */
  const describe = (): void => {
    const v = sel.map((i) => verdicts?.get(i)).find((x) => x);
    verdictText.text = !checks.dots ? 'validation off' : !v ? 'not checked' : `${v.colour}${v.why.length ? ': ' + v.why.join('; ') : ''}`;
  };
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  /** Checks run a moment after the last change, not on every frame of a drag. */
  const recheck = (): void => {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      if (!active) return;
      verdicts = checks.dots ? validate(layout, host.terrain(), host.params, pops()) : undefined;
      marks.dots(layout, host.terrain(), verdicts);
      marks.impact(checks.impact ? layout : undefined, host.terrain(), host.params, pops());
      describe();
    }, 300);
  };
  const profile = createProfile({
    keepStep: () => groundPanel.keepStep(),
    editPatch: (change, final) => {
      const p = patchOf();
      if (!p) return;
      change(p);
      groundPanel.outline();
      if (!final) return profile.redraw();
      rebuild();
      commit();
      groundPanel.refresh();
    },
    terrain: host.terrain,
    ground: () => groundNow(),
    params: host.params,
    pops,
    turn: () => checks.turn,
    edit: (change, final) => {
      const f = shown();
      const i = f ? layout.features.indexOf(f) : -1;
      if (!f || i < 0) return;
      const old = rectsOf([i]);
      const next = structuredClone(f);
      change(next);
      if (next.meta && (next.kind === 'kicker' || next.kind === 'corner')) next.meta.lip = lipOf(next);
      layout.features[i] = next;
      if (!final) {
        pending = [...(pending ?? []), ...old, ...rectsOf([i])];
        return;
      }
      rebuild();
      commit();
      buildFeature();
    },
  });

  /** A finished edit: keep it for undo, mark the local copy stale. */
  const commit = (): void => {
    history.push(layout);
    dirty = true;
  };
  const rebuild = (rects?: readonly Rect[]): void => {
    host.setPark(layout, rects);
    showStart();
    const p = patchOf();
    if (p) profile.setPatch(p, patch, basePitch(), reachOf(p));
    else profile.set(shown());
    recheck();
  };

  // --- dragging: the parts move rigidly while held; a designed obstacle re-solves on release ---
  let start: { parts: FeatureSpec[]; place: Place; rects: Rect[]; x: number; z: number; rot: number } | undefined;
  let patchStart: { x: number; z: number; yaw: number; px: number; pz: number; rot: number } | undefined;
  const startDrag = (): void => {
    const p = patchOf();
    if (p) {
      patchStart = { x: p.x, z: p.z, yaw: p.yaw, px: pivot.position.x, pz: pivot.position.z, rot: pivot.rotation.y };
      return;
    }
    if (!sel.length) return;
    start = {
      parts: sel.map((i) => structuredClone(layout.features[i] as FeatureSpec)),
      place: placeOf(sel),
      rects: rectsOf(sel),
      x: pivot.position.x,
      z: pivot.position.z,
      rot: pivot.rotation.y,
    };
  };
  const oneGroup = (): boolean => new Set(sel.map((i) => layout.features[i]?.meta?.group ?? `#${i}`)).size === 1;
  const dragged = (): Place | undefined => {
    if (!start) return undefined;
    return { x: start.place.x + pivot.position.x - start.x, z: start.place.z + pivot.position.z - start.z, yaw: start.place.yaw - (pivot.rotation.y - start.rot) };
  };
  const drag = (): void => {
    const p = patchOf();
    if (p && patchStart) {
      // The patch's data and outline follow the gizmo; the snow re-bakes on release.
      p.x = patchStart.x + pivot.position.x - patchStart.px;
      p.z = patchStart.z + pivot.position.z - patchStart.pz;
      p.yaw = patchStart.yaw - (pivot.rotation.y - patchStart.rot);
      groundPanel.outline();
      return;
    }
    const to = dragged();
    if (!start || !to) return;
    const dx = to.x - start.place.x;
    const dz = to.z - start.place.z;
    const dyaw = to.yaw - start.place.yaw;
    start.parts.forEach((p, k) => {
      const i = sel[k];
      if (i !== undefined) layout.features[i] = moved(p, start?.place.x ?? 0, start?.place.z ?? 0, dx, dz, dyaw);
    });
    pending = [...start.rects, ...rectsOf(sel)];
  };
  const endDrag = (): void => {
    if (patchStart) {
      patchStart = undefined;
      rebuild();
      commit();
      seatPivot();
      groundPanel.refresh();
      return;
    }
    if (!start) return;
    const was = start;
    start = undefined;
    // One designed obstacle re-solves where it was put; several move as they are.
    const d = oneGroup() ? designOf(layout, sel) : undefined;
    if (d) {
      const parts = resolve(d.design, d.design);
      if (!parts) {
        // Can't go there: back where it was.
        was.parts.forEach((p, k) => {
          const i = sel[k];
          if (i !== undefined) layout.features[i] = p;
        });
        rebuild([...was.rects, ...rectsOf(sel)]);
        seatPivot();
        return;
      }
    } else {
      rebuild([...was.rects, ...rectsOf(sel)]);
    }
    pending = null;
    seatPivot();
    commit();
    buildFeature();
  };

  /**
   * Design the selected obstacle again from `next`; its parts replace the old ones. Undefined,
   * and nothing changed, when the kit can't build it there.
   */
  const resolve = (was: Design, next: Design): FeatureSpec[] | undefined => {
    const old = rectsOf(sel);
    const id = layout.features[sel[0] ?? -1]?.meta?.group ?? freeGroup(layout);
    const parts = design(next, groundNow(), host.params, id, rangesFor(next));
    if (!parts.length) {
      say(`a ${was.kind} can't be built there`);
      return undefined;
    }
    sel = replaceParts(layout, sel, parts);
    rebuild([...old, ...rectsOf(sel)]);
    say(`${next.kind} re-solved`);
    return parts;
  };

  // Input ranges, as the kit draws them, per obstacle and size.
  const ranges = new Map<string, Record<string, readonly number[]>>();
  const rangesFor = (d: Design): Record<string, readonly number[]> => {
    const k = `${d.kind}/${d.size}`;
    let r = ranges.get(k);
    if (!r) {
      r = {};
      ranges.set(k, r);
    }
    return r;
  };

  // --- the editor folder: modes and every key action as a button, for touch ---
  const edit = pane.addFolder({ title: 'edit' });
  edit.addBinding(status, 'text', { readonly: true, multiline: true, rows: 2, label: '' });
  edit.addButton({ title: 'ride from here (Enter)' }).on('click', () => rideHere());
  edit.addButton({ title: 'ride from the park start' }).on('click', () => {
    const s = layout.spawn;
    host.ride({ position: { x: s.x, y: 0, z: s.z }, heading: s.heading });
  });
  edit.addButton({ title: 'set park start: then click the snow' }).on('click', () => {
    palette.armed = true;
    palette.patch = false;
    palette.start = true;
    say('click the snow where runs start (Esc cancels)');
  });
  edit.addButton({ title: 'back to riding (Tab)' }).on('click', () => host.ride());
  edit.addButton({ title: 'move (G)' }).on('click', () => setMode('translate'));
  edit.addButton({ title: 'rotate (R)' }).on('click', () => setMode('rotate'));
  edit.addButton({ title: 'frame selection (F)' }).on('click', () => frame());
  // Jump along the park: what the arrows do from the keyboard, for touch.
  const hill = { at: 0 };
  const hillBlade = edit.addBinding(hill, 'at', { label: 'hill position m (↑ ↓ keys)', min: 0, max: layout.ground.length, step: 5 });
  hillBlade.on('change', (ev) => view.goTo(-ev.value, heightAt));
  edit.addButton({ title: 'duplicate (Ctrl/Cmd-D)' }).on('click', () => duplicate());
  edit.addButton({ title: 'mirror (M)' }).on('click', () => mirror());
  edit.addButton({ title: 'delete (Del)' }).on('click', () => remove());
  edit.addButton({ title: 'undo (Ctrl/Cmd-Z)' }).on('click', () => undo());
  edit.addButton({ title: 'redo (Shift-Ctrl/Cmd-Z)' }).on('click', () => redo());
  edit.addButton({ title: 're-solve designed features' }).on('click', () => resolveAll());

  const file = pane.addFolder({ title: 'file', expanded: false });
  file.addButton({ title: 'export JSON' }).on('click', () => host.download(`${layout.name}.json`, JSON.stringify(layout, null, 1) + '\n'));
  file.addButton({ title: 'import JSON' }).on('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', () =>
      void input.files?.[0]?.text().then((json) => {
        try {
          const l = JSON.parse(json) as Layout;
          if (l.version !== 1 || !l.ground || !Array.isArray(l.features)) throw new Error('not a Camber layout');
          replaceLayout(l);
          commit();
          say(`imported ${l.name}`);
        } catch (e) {
          say(`couldn't import: ${(e as Error).message}`);
        }
      }),
    );
    input.click();
  });
  file.addButton({ title: 'reset to the shipped park' }).on('click', () => {
    dropCopy(key);
    replaceLayout(structuredClone(host.original));
    commit();
    dirty = false;
    say('back to the park as shipped; the local copy is gone');
  });

  // --- palette ---
  const palette = { kind: 'kicker' as Kind, size: 'M' as Size, align: true, armed: false, patch: false, start: false };
  const place = pane.addFolder({ title: 'place', expanded: false });
  const kindOptions: Record<string, Kind> = {};
  for (const k of KINDS) kindOptions[k] = k;
  let sizeBlade: ReturnType<FolderApi['addBinding']> | undefined;
  const sizeList = (): void => {
    sizeBlade?.dispose();
    const sizes = sizesOf(palette.kind);
    if (!sizes.includes(palette.size)) palette.size = sizes[Math.min(1, sizes.length - 1)] ?? 'S';
    const options: Record<string, Size> = {};
    for (const s of sizes) options[s] = s;
    sizeBlade = place.addBinding(palette, 'size', { options, index: 1 });
  };
  place.addBinding(palette, 'kind', { options: kindOptions }).on('change', () => sizeList());
  sizeList();
  place.addBinding(palette, 'align', { label: 'align to fall line (Alt: the other)', index: 2 });
  place.addButton({ title: 'add terrain patch: then click the snow' }).on('click', () => {
    if (!layout.ground.field) return say("this park's ground is a plane: it has no patches");
    palette.armed = true;
    palette.patch = true;
    palette.start = false;
    say('click the snow where the patch starts (Esc cancels)');
  });
  place.addButton({ title: 'place: then click the snow', index: 3 }).on('click', () => {
    palette.armed = true;
    palette.patch = false;
    palette.start = false;
    say(`click the snow to place a ${palette.size} ${palette.kind} (Esc cancels)`);
  });

  const placeAt = (x: number, z: number, alt: boolean): void => {
    palette.armed = false;
    let yaw = 0;
    if (palette.align !== alt) {
      const n = groundNow().sample(x, z, c).normal;
      if (Math.hypot(n.x, n.z) > 0.01) yaw = Math.atan2(n.x, -n.z);
    }
    if (palette.start) {
      // Where every run starts: facing down the fall line there (Alt: straight down −Z).
      layout.spawn = { x, z, heading: Math.PI - yaw };
      showStart();
      commit();
      return say('park start set: "ride from the park start" to try it');
    }
    const list = layout.ground.field?.patches;
    if (palette.patch && list) {
      list.push(newPatch(x, z, yaw, basePitch()));
      rebuild();
      commit();
      groundPanel.refresh();
      selectPatch(list.length - 1);
      return say('patch added: drag it with the gizmo, shape it in the profile');
    }
    const d: Design = { kind: palette.kind, place: { x, z, yaw }, size: palette.size, speed: designSpeed(palette.kind, palette.size, host.params), inputs: {} };
    const parts = design(d, groundNow(), host.params, freeGroup(layout), rangesFor(d));
    if (!parts.length) {
      say(`a ${palette.kind} can't be built there`);
      return;
    }
    const at = parts.map((p) => layout.features.push(p) - 1);
    rebuild(rectsOf(at));
    commit();
    select(at);
    say(`placed a ${palette.size} ${palette.kind}`);
  };

  // --- the selected feature's panel ---
  let featureFolder: FolderApi | undefined;
  // Rebuilt after the event that asked for it: a folder can't be disposed inside its own handler.
  let rebuildQueued = false;
  const buildFeature = (): void => {
    if (rebuildQueued) return;
    rebuildQueued = true;
    setTimeout(() => {
      rebuildQueued = false;
      featureNow();
    }, 0);
  };
  const featureNow = (): void => {
    featureFolder?.dispose();
    featureFolder = undefined;
    const i = sel[0];
    const f = i === undefined ? undefined : layout.features[i];
    if (i === undefined || !f) return;
    const d = oneGroup() ? designOf(layout, sel) : undefined;
    const type = f.meta?.design?.kind ?? f.meta?.type ?? (f.kind === 'shape' ? f.cfg.kind : f.kind);
    featureFolder = pane.addFolder({ title: `${type} #${i}${sel.length > 1 ? ` (+${sel.length - 1} parts)` : ''} — ${d ? 'designed' : 'hand'}` });
    featureFolder.addBinding(verdictText, 'text', { readonly: true, multiline: true, rows: 3, label: 'check' });
    if (d) designPanel(featureFolder, d.design);
    else handPanel(featureFolder, i, f);
  };

  const designPanel = (folder: FolderApi, was: Design): void => {
    const apply = (next: Design): void => {
      if (resolve(was, next)) commit();
      seatPivot();
      buildFeature();
    };
    const sizes = sizesOf(was.kind as Kind);
    if (sizes.length > 1) {
      const options: Record<string, string> = {};
      for (const s of sizes) options[s] = s;
      const s = { size: was.size };
      folder.addBinding(s, 'size', { options }).on('change', (ev) =>
        apply({ ...was, size: ev.value, speed: designSpeed(was.kind as Kind, ev.value as Size, host.params) }),
      );
    }
    const speed = { min: was.speed[0], max: was.speed[1] };
    if (was.speed[1] < 1e6) {
      folder.addBinding(speed, 'min', { label: 'speed min m/s', min: 0, max: 30, step: 0.5 }).on('change', (ev) => ev.last && apply({ ...was, speed: [speed.min, Math.max(speed.min, speed.max)] }));
      folder.addBinding(speed, 'max', { label: 'speed max m/s', min: 0, max: 30, step: 0.5 }).on('change', (ev) => ev.last && apply({ ...was, speed: [Math.min(speed.min, speed.max), speed.max] }));
    }
    const r = rangesFor(was);
    const inputs = { ...was.inputs };
    for (const k of Object.keys(was.inputs)) {
      const range = r[k];
      const opts = range ? { min: range[0], max: range[1], step: range[2] ?? ((range[1] ?? 1) - (range[0] ?? 0)) / 100 } : {};
      folder.addBinding(inputs, k, opts).on('change', (ev) => ev.last && apply({ ...was, inputs: { ...inputs } }));
    }
    folder.addBlade({ view: 'separator' });
    const solved = { note: 'shape solved from flight and the inputs above' };
    folder.addBinding(solved, 'note', { readonly: true, label: '' });
  };

  const handPanel = (folder: FolderApi, i: number, f: FeatureSpec): void => {
    // Top-level numbers of its config, angles in degrees; position and turn go by the gizmo.
    const cfg = f.cfg as unknown as Record<string, unknown>;
    const angle = (k: string): boolean => /angle|yaw|pitch/i.test(k);
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(cfg)) if (typeof v === 'number' && k !== 'x' && k !== 'z') values[k] = angle(k) ? v * DEG : v;
    for (const k of Object.keys(values)) {
      folder.addBinding(values, k, { label: angle(k) ? `${k} °` : k }).on('change', (ev) => {
        if (!ev.last) return;
        const old = rectsOf([i]);
        const next = structuredClone(layout.features[i] as FeatureSpec);
        const n = next.cfg as unknown as Record<string, number>;
        n[k] = angle(k) ? (values[k] ?? 0) / DEG : (values[k] ?? 0);
        if (next.meta && (next.kind === 'kicker' || next.kind === 'corner')) next.meta.lip = lipOf(next);
        layout.features[i] = next;
        rebuild([...old, ...rectsOf([i])]);
        commit();
      });
    }
    const meta = f.meta;
    if (meta?.speed) {
      // The speeds it is checked at (profile, validation): a hand feature's are only a label.
      const speed = { min: meta.speed[0], max: meta.speed[1] };
      const set = (): void => {
        meta.speed = [Math.min(speed.min, speed.max), Math.max(speed.min, speed.max)];
        profile.redraw();
        recheck();
        commit();
      };
      folder.addBinding(speed, 'min', { label: 'speed min m/s', min: 0, max: 30, step: 0.5 }).on('change', (ev) => ev.last && set());
      folder.addBinding(speed, 'max', { label: 'speed max m/s', min: 0, max: 30, step: 0.5 }).on('change', (ev) => ev.last && set());
    }
  };

  // --- ground ---
  const groundPanel = addGroundFolder(
    pane,
    host.scene,
    () => layout,
    host.terrain,
    () => ({ x: view.controls.target.x, z: view.controls.target.z }),
    () => {
      rebuild();
      commit();
    },
    (on) => {
      checks.overlay = on ? 'slope' : 'none';
      host.overlay(checks.overlay);
      pane.refresh();
    },
    (i) => selectPatch(i, true),
  );

  // --- checks folder ---
  const checkFolder = pane.addFolder({ title: 'checks', expanded: false });
  checkFolder.addBinding(checks, 'profile', { label: 'profile (section)' }).on('change', (ev) => profile.show(active && ev.value));
  checkFolder.addBinding(checks, 'dots', { label: 'validation dots' }).on('change', () => recheck());
  checkFolder.addBinding(checks, 'impact', { label: 'impact on landings' }).on('change', () => recheck());
  checkFolder
    .addBinding(checks, 'overlay', { options: { none: 'none', 'slope heatmap': 'slope', 'connection graph': 'graph', 'design arcs': 'arcs', 'lines and footprints': 'lines' } })
    .on('change', (ev) => host.overlay(ev.value));
  const popChanged = (): void => {
    profile.redraw();
    recheck();
  };
  checkFolder.addBinding(checks, 'popMin', { label: 'pop min m/s', min: 0, max: 6, step: 0.1 }).on('change', (ev) => ev.last && popChanged());
  checkFolder.addBinding(checks, 'popMax', { label: 'pop max m/s', min: 0, max: 6, step: 0.1 }).on('change', (ev) => ev.last && popChanged());
  checkFolder.addBinding(checks, 'turn', { label: 'section heading °', min: -90, max: 90, step: 1 }).on('change', () => profile.redraw());

  // --- actions ---
  const replaceLayout = (l: Layout): void => {
    layout = l;
    sel = [];
    rebuild();
    seatPivot();
    buildFeature();
    groundPanel.refresh();
  };
  const undo = (): void => {
    const l = history.undo();
    if (!l) return say('nothing to undo');
    replaceLayout(l);
    dirty = true;
    say('undone');
  };
  const redo = (): void => {
    const l = history.redo();
    if (!l) return say('nothing to redo');
    replaceLayout(l);
    dirty = true;
    say('redone');
  };
  const remove = (): void => {
    const p = patchOf();
    if (p) {
      layout.ground.field?.patches.splice(patch, 1);
      selectPatch(-1);
      rebuild();
      commit();
      groundPanel.refresh();
      return say('patch deleted');
    }
    if (!sel.length) return;
    const old = rectsOf(sel);
    removeFeatures(layout, sel);
    sel = [];
    rebuild(old);
    commit();
    seatPivot();
    buildFeature();
    say('deleted');
  };
  const duplicate = (): void => {
    const pa = patchOf();
    if (pa) {
      // Beside it, across its axis, clear of its edge fade.
      const w = 2 * (pa.halfWidth + pa.edge);
      const copy: PatchConfig = { ...structuredClone(pa), natural: undefined, x: pa.x + Math.cos(pa.yaw) * w, z: pa.z + Math.sin(pa.yaw) * w };
      delete copy.natural;
      const list = layout.ground.field?.patches;
      if (!list) return;
      list.push(copy);
      rebuild();
      commit();
      selectPatch(list.length - 1);
      return say(`patch duplicated ${w.toFixed(0)} m across`);
    }
    if (!sel.length) return;
    const p = printOf(layout.features[sel[0] ?? 0] as FeatureSpec);
    const shift = p.w1 - p.w0 + 4; // beside it, clear of it
    const id = freeGroup(layout);
    const copies = sel.map((i) => {
      const f = moved(layout.features[i] as FeatureSpec, 0, 0, shift, 0, 0);
      if (f.meta?.group !== undefined) f.meta.group = id;
      return f;
    });
    const at = copies.map((f) => layout.features.push(f) - 1);
    rebuild(rectsOf(at));
    commit();
    select(at);
    say(`duplicated ${shift.toFixed(0)} m across`);
  };
  const mirror = (): void => {
    const pa = patchOf();
    if (pa) {
      pa.yaw = -pa.yaw;
      rebuild();
      commit();
      seatPivot();
      groundPanel.refresh();
      return say('patch mirrored');
    }
    if (!sel.length) return;
    const d = oneGroup() ? designOf(layout, sel) : undefined;
    if (d) {
      const inputs = { ...d.design.inputs };
      if (inputs.left !== undefined) inputs.left = 1 - inputs.left;
      const next = { ...d.design, inputs, place: { ...d.design.place, yaw: -d.design.place.yaw } };
      if (resolve(d.design, next)) commit();
    } else {
      const old = rectsOf(sel);
      const px = placeOf(sel).x;
      for (const i of sel) layout.features[i] = mirrored(layout.features[i] as FeatureSpec, px);
      rebuild([...old, ...rectsOf(sel)]);
      commit();
    }
    seatPivot();
    buildFeature();
    say('mirrored');
  };
  /** Every designed obstacle designed again over the ground as it is now (after a ground edit). */
  const resolveAll = (): void => {
    const designed = layout.features.filter((f) => f.meta?.design);
    let failed = 0;
    for (const f of designed) {
      const i = layout.features.indexOf(f);
      const d = f.meta?.design;
      if (i < 0 || !d) continue;
      sel = groupOf(layout, i).sort((a, b) => a - b);
      if (!resolve(d, d)) failed++;
    }
    sel = [];
    seatPivot();
    buildFeature();
    commit();
    say(`${designed.length - failed} re-solved${failed ? `, ${failed} can't stand where they are` : ''}`);
  };
  const frame = (): void => {
    const pa = patchOf();
    const p = pa ?? (sel.length ? placeOf(sel) : layout.spawn);
    view.frame(p.x, heightAt(p.x, p.z), p.z, 45);
  };
  const rideHere = (): void => {
    const f = layout.features[sel[0] ?? -1];
    if (!f) return say('select a feature to ride at');
    const s = rideSpawn(f, host.terrain(), GEN.clear.runIn);
    host.ride(s);
  };
  const save = (): void => {
    if (!dirty) return;
    if (keepCopy(key, layout, base)) {
      dirty = false;
      sinceSave = 0;
    } else say("this browser won't keep a copy — export the JSON to keep your changes");
  };

  // --- pointer: a click (not a drag) places or selects ---
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number } | undefined;
  /** Where the pointer's ray meets the snow: marched, then bisected. */
  const snowAt = (ev: PointerEvent): { x: number; z: number } | undefined => {
    const r = host.canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, view.camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    const below = (t: number): boolean => o.y + d.y * t < heightAt(o.x + d.x * t, o.z + d.z * t);
    let t0 = 0;
    let t1 = -1;
    for (let t = 1; t < 1500; t += 1) {
      if (below(t)) {
        t1 = t;
        break;
      }
      t0 = t;
    }
    if (t1 < 0) return undefined;
    for (let k = 0; k < 20; k++) {
      const m = (t0 + t1) / 2;
      if (below(m)) t1 = m;
      else t0 = m;
    }
    return { x: o.x + d.x * t1, z: o.z + d.z * t1 };
  };
  host.canvas.addEventListener('pointerdown', (ev) => {
    down = active ? { x: ev.clientX, y: ev.clientY } : undefined;
  });
  host.canvas.addEventListener('pointerup', (ev) => {
    if (!active || !down || gizmo.dragging) return;
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    down = undefined;
    if (moved > CLICK || (gizmo.axis !== null && helper.visible)) return;
    const at = snowAt(ev);
    if (!at) return;
    if (palette.armed) return placeAt(at.x, at.z, ev.altKey);
    const i = featureAt(layout, at.x, at.z);
    if (i === undefined) {
      // No feature there: the terrain patch under it, if any.
      const pi = patchAt(layout.ground.field?.patches ?? [], at.x, at.z);
      if (pi !== undefined && !ev.shiftKey) {
        selectPatch(pi);
        return say(`terrain patch ${pi} — drag the gizmo, shape it in the profile, Esc to let go`);
      }
      if (!ev.shiftKey) select([]);
      return;
    }
    const parts = groupOf(layout, i);
    select(ev.shiftKey ? [...sel, ...parts] : parts);
    say(`${layout.features[i]?.meta?.type ?? layout.features[i]?.kind} #${i} — drag the gizmo, G move, R rotate, Enter ride`);
  });

  // --- keys, edit mode only ---
  const held = new Set<string>();
  const typing = (t: EventTarget | null): boolean => {
    const e = t as HTMLElement | null;
    return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA');
  };
  addEventListener('keydown', (ev) => {
    if (!active || typing(ev.target)) return;
    held.add(ev.code);
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'Enter') rideHere();
    else if (mod && (ev.key === 'z' || ev.key === 'Z')) {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
    } else if (mod && (ev.key === 'y' || ev.key === 'Y')) {
      ev.preventDefault();
      redo();
    } else if (mod && (ev.key === 'd' || ev.key === 'D')) {
      ev.preventDefault();
      duplicate();
    } else if (mod) return;
    else if (ev.key === 'g' || ev.key === 'G') setMode('translate');
    else if (ev.key === 'r' || ev.key === 'R') setMode('rotate');
    else if (ev.key === 'f' || ev.key === 'F') frame();
    else if (ev.key === 'm' || ev.key === 'M') mirror();
    else if (ev.key === 'Delete' || ev.key === 'Backspace') remove();
    else if (ev.key === 'Escape') {
      if (palette.armed) {
        palette.armed = false;
        say('placing cancelled');
      } else if (patch >= 0) selectPatch(-1);
      else select([]);
    }
  });
  addEventListener('keyup', (ev) => held.delete(ev.code));
  addEventListener('blur', () => held.clear());

  const local = localCopy(key);
  if (local && local.base !== base) say('the shipped park changed since this local copy was made — "reset to the shipped park" takes the new one');

  return {
    camera: view.camera,
    enter() {
      active = true;
      layout = host.layout();
      // Editing a generated park forks it: its own name, the seed kept for reference.
      if (layout.seed !== undefined && layout.name === 'generated') layout.name = `gen-${layout.seed}`;
      if (box) box.style.display = '';
      view.setEnabled(true);
      groundPanel.show(true);
      if (!framed) {
        framed = true;
        const s = layout.spawn;
        view.controls.target.set(s.x, heightAt(s.x, s.z - 60), s.z - 60);
        view.camera.position.set(s.x + 50, heightAt(s.x, s.z) + 45, s.z + 10);
      }
      seatPivot();
      groundPanel.refresh();
      buildFeature();
      hill.at = Math.max(0, -view.controls.target.z);
      hillBlade.refresh();
      marks.show(true);
      showStart();
      profile.show(checks.profile);
      profile.set(shown());
      host.overlay(checks.overlay);
      recheck();
    },
    leave() {
      save();
      active = false;
      held.clear();
      palette.armed = false;
      if (box) box.style.display = 'none';
      view.setEnabled(false);
      helper.visible = false;
      gizmo.enabled = false;
      groundPanel.show(false);
      marks.show(false);
      startArrow.visible = false;
      profile.show(false);
      host.overlay('none');
    },
    update(dt) {
      if (!active) return;
      if (pending) {
        rebuild(pending);
        pending = null;
      }
      view.update(dt, held, heightAt);
      sinceSave += dt;
      if (sinceSave > AUTOSAVE) {
        sinceSave = 0;
        save();
      }
    },
  };
}
