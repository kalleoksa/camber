import type { FeatureSpec } from '../park/layout.ts';
import type { PatchConfig } from '../sim/heightfield.ts';
import type { Params } from '../sim/params.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';
import { designedAirs, lipOf, sweep, takeoffOf, type Air } from './airs.ts';
import { mergeAt, originOf, patchStep, splitSegment, zeroStep } from './edits.ts';

/**
 * The profile editor: a side section, true to scale, drawn by sampling the terrain.
 *
 * A feature: along its axis (or its takeoff's heading). The designed airs over it (slowest, no
 * pop: blue; middle: green; fastest: red), and the snow coloured by how hard airs across the
 * speeds come down there. A hand-built kicker gets handles: lip height and angle at the lip,
 * table length at the knuckle, and with a knuckle height, step up/down. A designed feature's
 * shape is solved: change its inputs in the panel.
 *
 * A terrain patch: along its axis through its middle. Its segments as designed (dashed yellow)
 * over the snow as baked, the base grade dashed grey; a handle at each segment's end (drag for
 * its length) and middle (drag up or down for its pitch). The snow re-bakes on release.
 *
 * Drag a handle, or tap it to type a value.
 */
export type ProfileHost = {
  terrain(): Terrain;
  ground(): Terrain;
  params: Params;
  pops(): [number, number];
  /** Degrees the section turns off the takeoff's heading (the heading picker). */
  turn(): number;
  /** Change the selected hand feature: live while dragging, `final` on release. */
  edit(change: (f: FeatureSpec) => void, final: boolean): void;
  /** When a segment changes, set its neighbour's pitch so the patch leaves no step. */
  keepStep(): boolean;
  /** Change the selected patch: its data only while dragging (no re-bake), `final` on release. */
  editPatch(change: (p: PatchConfig) => void, final: boolean): void;
};

export type Profile = {
  set(f: FeatureSpec | undefined): void;
  /**
   * Show patch `index` instead; `basePitch` the field's grade, rad; `reach` m along its axis to
   * the bottom of the park, which its segments can't run past.
   */
  setPatch(p: PatchConfig | undefined, index: number, basePitch: number, reach: number): void;
  redraw(): void;
  show(on: boolean): void;
};

const IMPACT = { green: '#3fae5a', amber: '#ec9a2c', red: '#d9452b' };
const AIRS = ['#3d7bd9', '#4fbf5a', '#d9452b'];
const DEG = 180 / Math.PI;

/** A handle on the section: where it is, and what dragging or typing it does. */
type Grip = {
  name: string;
  s: number;
  y: number;
  value(): number; // in the units typed
  begin(): void;
  move(ds: number, dy: number, s: number, y: number): void;
  done(): void;
  type(v: number): void;
  /** Double-tap: take the point away (a patch segment's end). */
  remove?(): void;
};

/** A point on a rail at `s` along the section, between the two it falls between, at their height. */
function insertPoint(points: [number, number, number][], s: number, along: (x: number, z: number) => number): void {
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    if (!a || !b) continue;
    const sa = along(a[0], a[2]);
    const sb = along(b[0], b[2]);
    if (s <= sa + 0.3 || s >= sb - 0.3) continue;
    const t = (s - sa) / (sb - sa);
    points.splice(k, 0, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    return;
  }
}

export function createProfile(host: ProfileHost): Profile {
  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;left:316px;right:8px;bottom:8px;height:220px;width:calc(100% - 324px);z-index:2;border-radius:6px;background:rgba(18,24,32,0.88);touch-action:none;display:none';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const c = createContact();
  let feature: FeatureSpec | undefined;
  let patch: { p: PatchConfig; index: number; base: number; reach: number } | undefined;
  let visible = false;
  let grips: Grip[] = [];
  let drag: { g: Grip; x: number; y: number; moved: boolean } | undefined;
  let designLine: [number, number][] = []; // a patch's design line or a rail, for taps on it
  let addOnLine: ((s: number) => void) | undefined; // double-tap on it: add a point at s
  // Section to canvas: s along the section (m), y height (m).
  let scale = 1;
  let toX = (s: number): number => s;
  let toY = (y: number): number => y;
  let fromX = (x: number): number => x;
  let fromY = (y: number): number => y;

  /** Fit [s0, s1] × [y0, y1] true to scale — unless a handle is being dragged: then hold still. */
  const fit = (W: number, H: number, s0: number, s1: number, y0: number, y1: number): void => {
    if (drag) return;
    const pad = 18;
    scale = Math.min((W - 2 * pad) / (s1 - s0), (H - 2 * pad - 14) / Math.max(1, y1 - y0));
    const midY = (y0 + y1) / 2;
    toX = (s) => pad + (s - s0) * scale;
    toY = (y) => H / 2 + 7 - (y - midY) * scale;
    fromX = (x) => s0 + (x - pad) / scale;
    fromY = (y) => midY - (y - H / 2 - 7) / scale;
  };

  // --- drawing helpers, valid inside a redraw ---
  let g2: CanvasRenderingContext2D;
  const line = (pts: [number, number][], style: string, width: number, dash: number[] = []): void => {
    g2.strokeStyle = style;
    g2.lineWidth = width;
    g2.setLineDash(dash);
    g2.beginPath();
    pts.forEach(([s, y], i) => (i ? g2.lineTo(toX(s), toY(y)) : g2.moveTo(toX(s), toY(y))));
    g2.stroke();
    g2.setLineDash([]);
  };
  const grid = (W: number, H: number, s0: number, s1: number): void => {
    g2.strokeStyle = 'rgba(255,255,255,0.06)';
    g2.lineWidth = 1;
    for (let s = Math.ceil(s0 / 5) * 5; s <= s1; s += 5) {
      g2.beginPath();
      g2.moveTo(toX(s), 0);
      g2.lineTo(toX(s), H);
      g2.stroke();
    }
    for (let y = Math.ceil(fromY(H) / 5) * 5; y <= fromY(0); y += 5) {
      g2.beginPath();
      g2.moveTo(0, toY(y));
      g2.lineTo(W, toY(y));
      g2.stroke();
    }
  };
  const snowFill = (snow: [number, number][], H: number): void => {
    g2.fillStyle = 'rgba(232,238,244,0.16)';
    g2.beginPath();
    snow.forEach(([s, y], i) => (i ? g2.lineTo(toX(s), toY(y)) : g2.moveTo(toX(s), toY(y))));
    g2.lineTo(toX(snow[snow.length - 1]?.[0] ?? 0), H);
    g2.lineTo(toX(snow[0]?.[0] ?? 0), H);
    g2.fill();
  };
  const drawGrips = (): void => {
    for (const h of grips) {
      g2.fillStyle = '#ffd34d';
      g2.strokeStyle = '#1b2430';
      g2.lineWidth = 1.5;
      g2.beginPath();
      g2.arc(toX(h.s), toY(h.y), 6, 0, Math.PI * 2);
      g2.fill();
      g2.stroke();
    }
  };
  const caption = (W: number, H: number, top: string, bottom: string): void => {
    g2.font = '12px system-ui, sans-serif';
    g2.fillStyle = '#c9d4de';
    g2.fillText(top, 10, 15);
    g2.fillStyle = '#8fa3b5';
    g2.fillText(bottom, 10, H - 8);
    g2.strokeStyle = '#c9d4de';
    g2.beginPath();
    g2.moveTo(W - 10 - 5 * scale, H - 10);
    g2.lineTo(W - 10, H - 10);
    g2.stroke();
    g2.fillStyle = '#c9d4de';
    g2.fillText('5 m', W - 34 - 5 * scale, H - 6);
  };

  /** A feature's handles: hand-built kickers (and plain corners) seen straight along their axis. */
  const featureGrips = (f: FeatureSpec, height: (s: number) => number, base: (s: number) => number): Grip[] => {
    if ((f.kind !== 'kicker' && f.kind !== 'corner') || f.meta?.design || host.turn() !== 0 || (f.kind === 'corner' && f.cfg.hip)) return [];
    const k = f.cfg;
    const beta = Math.atan((base(-2) - base(2)) / 4); // the ground's fall along the section at the lip
    const a = k.lipAngle - beta;
    const lipY = height(0);
    type K = typeof k;
    // Each handle edits a copy of the feature as it was when the drag began.
    const grip = (name: string, s: number, y: number, value: () => number, move: (n: K, was: K, ds: number, dy: number, s: number, y: number) => void, type: (n: K, v: number) => void): Grip => {
      let was: K = k;
      return {
        name,
        s,
        y,
        value,
        begin: () => (was = structuredClone(k)),
        move: (ds, dy, s2, y2) => host.edit((g) => move(g.cfg as K, was, ds, dy, s2, y2), false),
        done: () => host.edit(() => undefined, true),
        type: (v) => host.edit((g) => type(g.cfg as K, v), true),
      };
    };
    const out = [
      grip('lip height m', 0, lipY, () => k.lipHeight, (n, was, _ds, dy) => (n.lipHeight = Math.max(0.2, Math.min(8, was.lipHeight + dy))), (n, v) => (n.lipHeight = Math.max(0.2, v))),
      grip(
        'lip angle °',
        3 * Math.cos(a),
        lipY + 3 * Math.sin(a),
        () => k.lipAngle * DEG,
        (n, _was, _ds, _dy, s, y) => (n.lipAngle = Math.max(5 / DEG, Math.min(50 / DEG, Math.atan2(y - lipY, Math.max(0.1, s)) + beta))),
        (n, v) => (n.lipAngle = Math.max(5, Math.min(50, v)) / DEG),
      ),
      grip('table length m', k.deckLength, height(k.deckLength), () => k.deckLength, (n, was, ds) => (n.deckLength = Math.max(0, was.deckLength + ds)), (n, v) => (n.deckLength = Math.max(0, v))),
    ];
    if (f.kind === 'kicker' && f.cfg.knuckleHeight !== undefined) {
      const kh = (x: K): number => ('knuckleHeight' in x ? (x.knuckleHeight ?? 0) : 0);
      out.push(
        grip(
          'knuckle height m (step up/down)',
          k.deckLength + 1.5,
          height(k.deckLength) + 1.2,
          () => kh(k),
          (n, was, _ds, dy) => {
            if ('knuckleHeight' in n) n.knuckleHeight = Math.max(0.2, kh(was) + dy);
          },
          (n, v) => {
            if ('knuckleHeight' in n) n.knuckleHeight = Math.max(0.2, v);
          },
        ),
      );
    }
    return out;
  };

  /**
   * Handles on a hand-built rail (each point: height, and along the rail but the first, which the
   * gizmo moves), block (roof height, length, its ramp's length) and panel (height, length).
   */
  const builtGrips = (f: FeatureSpec, height: (s: number) => number, along: (x: number, z: number) => number): Grip[] => {
    if (f.meta?.design || host.turn() !== 0) return [];
    // Each handle edits the feature as it was when the drag began.
    const grip = <C,>(cfg: C, name: string, s: number, y: number, value: () => number, move: (n: C, was: C, ds: number, dy: number) => void, type: (n: C, v: number) => void, remove?: () => void): Grip => {
      let was = cfg;
      return {
        name,
        s,
        y,
        value,
        begin: () => (was = structuredClone(cfg)),
        move: (ds, dy) => host.edit((g) => move(g.cfg as C, was, ds, dy), false),
        done: () => host.edit(() => undefined, true),
        type: (v) => host.edit((g) => type(g.cfg as C, v), true),
        ...(remove ? { remove } : {}),
      };
    };
    if (f.kind === 'rail') {
      const pts = f.cfg.points;
      const sOf = (p: [number, number, number]): number => along(p[0], p[2]);
      const dx = Math.sin(originOf(f).yaw);
      const dz = -Math.cos(originOf(f).yaw);
      return pts.map((p, k) =>
        grip(
          f.cfg,
          `point ${k + 1} height m`,
          sOf(p),
          host.terrain().sample(p[0], p[2], c).height + p[1],
          () => p[1],
          (n, was, ds, dy) => {
            const w = was.points[k];
            const q = n.points[k];
            if (!w || !q) return;
            q[1] = Math.max(0, Math.min(3, w[1] + dy));
            if (k === 0) return;
            // Along, kept between its neighbours.
            const prev = was.points[k - 1];
            const next = was.points[k + 1];
            const lo = prev ? sOf(prev) + 0.3 : -Infinity;
            const hi = next ? sOf(next) - 0.3 : Infinity;
            const d = Math.max(lo, Math.min(hi, sOf(w) + ds)) - sOf(w);
            q[0] = w[0] + dx * d;
            q[2] = w[2] + dz * d;
          },
          (n, v) => {
            const q = n.points[k];
            if (q) q[1] = Math.max(0, Math.min(3, v));
          },
          k > 0 && pts.length > 2 ? () => host.edit((g) => void (g.kind === 'rail' && g.cfg.points.splice(k, 1)), true) : undefined,
        ),
      );
    }
    if (f.kind === 'block') {
      const b = f.cfg;
      const out = [
        grip(b, 'height m', 0, height(0), () => b.height, (n, was, _ds, dy) => (n.height = Math.max(0.5, Math.min(15, was.height + dy))), (n, v) => (n.height = Math.max(0.5, Math.min(15, v)))),
        grip(b, 'length m', b.length / 2, height(b.length / 2 - 0.1), () => b.length, (n, was, ds) => (n.length = Math.max(2, was.length + 2 * ds)), (n, v) => (n.length = Math.max(2, v))),
      ];
      const r = b.ramp;
      if (r) {
        const foot = -b.length / 2 - r.length;
        out.push(
          grip(b, 'ramp length m', foot, height(foot), () => r.length, (n, was, ds) => {
            if (n.ramp && was.ramp) n.ramp.length = Math.max(2, was.ramp.length - ds);
          }, (n, v) => {
            if (n.ramp) n.ramp.length = Math.max(2, v);
          }),
        );
      }
      return out;
    }
    if (f.kind === 'panel') {
      const p = f.cfg;
      const top = (s: number): number => height(s) + p.foot + p.height * Math.cos(p.lean);
      return [
        grip(p, 'height m', p.length / 2, top(p.length / 2), () => p.height, (n, was, _ds, dy) => (n.height = Math.max(0.5, Math.min(6, was.height + dy / Math.cos(was.lean)))), (n, v) => (n.height = Math.max(0.5, Math.min(6, v)))),
        grip(p, 'length m', p.length, top(p.length), () => p.length, (n, was, ds) => (n.length = Math.max(1, was.length + ds)), (n, v) => (n.length = Math.max(1, v))),
      ];
    }
    return [];
  };

  const drawFeature = (f: FeatureSpec, W: number, H: number): void => {
    const terrain = host.terrain();
    const ground = host.ground();
    const params = host.params;
    const turn = host.turn() / DEG;
    const t = takeoffOf(f, turn);
    const o = originOf(f);
    const ox = t?.x ?? o.x;
    const oz = t?.z ?? o.z;
    const dx = t?.dirX ?? Math.sin(o.yaw + turn);
    const dz = t?.dirZ ?? -Math.cos(o.yaw + turn);
    const height = (s: number): number => terrain.sample(ox + dx * s, oz + dz * s, c).height;
    const base = (s: number): number => ground.sample(ox + dx * s, oz + dz * s, c).height;
    const along = (x: number, z: number): number => (x - ox) * dx + (z - oz) * dz;

    const airs: Air[] = t ? designedAirs(t, terrain, params, host.pops()) : [];
    const lands = t ? sweep(t, terrain, params, host.pops(), 32) : [];
    // From before its transition to past where the fastest airs come down: the part worth reading.
    let far = 25;
    for (const a of lands) far = Math.max(far, along(a.flight.x, a.flight.z) + 12);
    let s0 = t ? -Math.max(12, lipOf(f) + 6) : -15;
    let s1 = t ? Math.min(far, 120) : 35;
    if (f.kind === 'rail') {
      const last = f.cfg.points[f.cfg.points.length - 1];
      s0 = -6;
      s1 = (last ? along(last[0], last[2]) : 0) + 6;
    }
    if (f.kind === 'block') {
      s0 = -f.cfg.length / 2 - (f.cfg.ramp?.length ?? 0) - 10;
      s1 = f.cfg.length / 2 + 15;
    }
    if (f.kind === 'panel') s1 = Math.max(s1, f.cfg.length + 10);
    const snow: [number, number][] = [];
    const under: [number, number][] = [];
    for (let s = s0; s <= s1; s += 0.25) {
      snow.push([s, height(s)]);
      under.push([s, base(s)]);
    }
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [, y] of [...snow, ...under]) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (const a of airs) for (let i = 1; i < a.flight.points.length; i += 3) y1 = Math.max(y1, a.flight.points[i] ?? y1);
    // A rail, or a panel's top edge: not part of the snow, drawn over it.
    const built: [number, number][] = [];
    if (f.kind === 'rail') for (const [x, y, z] of f.cfg.points) built.push([along(x, z), terrain.sample(x, z, c).height + y]);
    if (f.kind === 'panel') {
      const top = f.cfg.foot + f.cfg.height * Math.cos(f.cfg.lean);
      built.push([0, height(0)], [0, height(0) + top], [f.cfg.length, height(f.cfg.length) + top], [f.cfg.length, height(f.cfg.length)]);
    }
    for (const [, y] of built) y1 = Math.max(y1, y);
    fit(W, H, s0, s1, y0, y1);
    grid(W, H, s0, s1);
    snowFill(snow, H);
    line(under, 'rgba(160,175,190,0.6)', 1, [4, 4]);
    line(snow, '#e8eef4', 1.5);

    // Where airs across the speeds come down, by impact, laid along the snow.
    const hits = lands.map((a) => ({ s: along(a.flight.x, a.flight.z), impact: a.flight.impact })).sort((a, b) => a.s - b.s);
    hits.forEach((h, i) => {
      const a = (hits[i - 1]?.s ?? h.s - 0.5) * 0.5 + h.s * 0.5;
      const b = (hits[i + 1]?.s ?? h.s + 0.5) * 0.5 + h.s * 0.5;
      const pts: [number, number][] = [];
      for (let s = Math.min(a, b); s <= Math.max(a, b) + 1e-6; s += 0.25) pts.push([s, height(s)]);
      line(pts, h.impact >= params.land.impactBail ? IMPACT.red : h.impact >= params.land.impactSketchy ? IMPACT.amber : IMPACT.green, 5);
    });

    airs.forEach((a, i) => {
      const p = a.flight.points;
      const pts: [number, number][] = [[0, height(0)]];
      for (let k = 0; k + 2 < p.length; k += 3) pts.push([along(p[k] ?? 0, p[k + 2] ?? 0), p[k + 1] ?? 0]);
      line(pts, AIRS[i] ?? '#fff', 1.5);
      const g = a.flight.grade;
      g2.fillStyle = g === 'clean' ? '#ffffff' : g === 'sketchy' ? IMPACT.amber : IMPACT.red;
      g2.beginPath();
      g2.arc(toX(along(a.flight.x, a.flight.z)), toY(a.flight.y), 4, 0, Math.PI * 2);
      g2.fill();
    });

    if (built.length) line(built, f.kind === 'rail' ? '#9fb3c8' : '#c79a5b', f.kind === 'rail' ? 3 : 2);
    designLine = f.kind === 'rail' ? built : [];
    addOnLine = f.kind === 'rail' && host.turn() === 0 ? (at) => host.edit((g) => g.kind === 'rail' && insertPoint(g.cfg.points, at, along), true) : undefined;

    if (!drag) grips = [...featureGrips(f, height, base), ...builtGrips(f, height, along)];
    if ((f.kind === 'kicker' || f.kind === 'corner') && grips[1] && grips[0]) line([[grips[0].s, grips[0].y], [grips[1].s, grips[1].y]], '#ffd34d', 1);
    drawGrips();
    const name = f.meta?.design?.kind ?? f.meta?.type ?? f.kind;
    caption(
      W,
      H,
      t ? `${name} · ${t.speed[0]}–${t.speed[1]} m/s · airs: blue slowest (no pop), green middle, red fastest · snow: where airs come down, by impact` : `${name} · section along its axis`,
      f.kind === 'rail' && grips.length
        ? 'drag a point (height, and along it), tap to type its height · double-tap the rail to add a point, a point to remove it'
        : grips.length
          ? 'drag a handle, or tap it to type'
          : f.meta?.design
            ? 'designed: change its inputs in the panel'
            : '',
    );
  };

  const drawPatch = (pt: { p: PatchConfig; index: number; base: number; reach: number }, W: number, H: number): void => {
    const { p, base, reach } = pt;
    const terrain = host.terrain();
    const dx = Math.sin(p.yaw);
    const dz = -Math.cos(p.yaw);
    const height = (s: number): number => terrain.sample(p.x + dx * s, p.z + dz * s, c).height;
    let total = 0;
    for (const [len] of p.segs) total += len;
    const s0 = -p.blend - 10;
    const s1 = Math.min(total, reach) + p.blend + 10;
    const tanBase = Math.tan(base);
    // The base grade, carried on from the snow above the patch, which it doesn't touch.
    const yA = height(s0) - (0 - s0) * tanBase;
    const baseAt = (s: number): number => yA - s * tanBase;
    // The segments as designed: straight grades end to end, before the bake eases them.
    const design: [number, number][] = [[s0, baseAt(s0)], [0, yA]];
    const ends: { s: number; y: number }[] = [];
    let s = 0;
    let y = yA;
    for (const [len, pitch] of p.segs) {
      s += len;
      y -= len * Math.tan(pitch);
      design.push([s, y]);
      ends.push({ s, y });
    }
    design.push([s1, y - (s1 - s) * tanBase]);
    // How far the design strays from the base grade: the snow beside the patch stays on it, so
    // this is the height of the wall (or bank) along its edge.
    let below = 0;
    let above = 0;
    for (const e of ends) {
      below = Math.max(below, baseAt(e.s) - e.y);
      above = Math.max(above, e.y - baseAt(e.s));
    }
    const snow: [number, number][] = [];
    for (let q = s0; q <= s1; q += 0.25) snow.push([q, height(q)]);
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [, v] of [...snow, ...design]) {
      y0 = Math.min(y0, v);
      y1 = Math.max(y1, v);
    }
    fit(W, H, s0, s1, y0, y1);
    grid(W, H, s0, s1);
    snowFill(snow, H);
    line([[s0, baseAt(s0)], [s1, baseAt(s1)]], 'rgba(160,175,190,0.6)', 1, [4, 4]);
    line(snow, '#e8eef4', 1.5);
    line(design, '#ffd34d', 1.5, [6, 4]);
    designLine = design;
    addOnLine = (at) => host.editPatch((q) => void splitSegment(q, at), true);

    if (!drag) {
      grips = [];
      let at = 0;
      let top = yA;
      p.segs.forEach((seg, k) => {
        const [len, pitch] = seg;
        const mid = at + len / 2;
        const midY = top - (len / 2) * Math.tan(pitch);
        const end = ends[k] ?? { s: at + len, y: top - len * Math.tan(pitch) };
        let was: [number, number] = [len, pitch];
        // The longest this segment can be with the patch still ending inside the park.
        const room = (sg: [number, number]): number => {
          let others = 0;
          for (const q of p.segs) if (q !== sg) others += q[0];
          return Math.max(0.5, reach - others);
        };
        const edit = (change: (sg: [number, number]) => void, final: boolean): void =>
          host.editPatch((q) => {
            const sg = q.segs[k];
            if (!sg) return;
            change(sg);
            if (host.keepStep()) zeroStep(q, k, base);
          }, final);
        grips.push(
          {
            name: `segment ${k + 1} pitch °`,
            s: mid,
            y: midY,
            value: () => pitch * DEG,
            begin: () => (was = [seg[0], seg[1]]),
            // The middle moved by dy with the start held: the grade changes by 2·dy over the length.
            move: (_ds, dy) => edit((sg) => (sg[1] = Math.max(-10 / DEG, Math.min(60 / DEG, Math.atan(Math.tan(was[1]) - (2 * dy) / was[0])))), false),
            done: () => edit(() => undefined, true),
            type: (v) => edit((sg) => (sg[1] = Math.max(-10, Math.min(60, v)) / DEG), true),
          },
          {
            name: `segment ${k + 1} length m`,
            s: end.s,
            y: end.y,
            value: () => len,
            begin: () => (was = [seg[0], seg[1]]),
            move: (ds) => edit((sg) => (sg[0] = Math.max(0.5, Math.min(room(sg), was[0] + ds))), false),
            done: () => edit(() => undefined, true),
            type: (v) => edit((sg) => (sg[0] = Math.max(0.5, Math.min(room(sg), v))), true),
            remove: () => host.editPatch((q) => void mergeAt(q, k), true),
          },
        );
        at += len;
        top = end.y;
      });
    }
    drawGrips();
    const step = patchStep(p, base);
    // Its sides: that height fading out over `edge` m.
    const wall = Math.atan(Math.max(below, above) / Math.max(0.5, p.edge)) * DEG;
    caption(
      W,
      H,
      `patch ${pt.index} · step at its end ${step.toFixed(2)} m${Math.abs(step) > 0.3 ? ' (a step across the slope)' : ''} · up to ${below.toFixed(1)} m below, ${above.toFixed(1)} m above the base grade${wall > 35 ? ` — its sides fall ${wall.toFixed(0)}° over the ${p.edge} m edge fade: a wall` : ''}`,
      'drag a middle handle up/down for pitch, an end handle along for length, tap to type · double-tap the line to add a point, an end point to remove it',
    );
  };

  const redraw = (): void => {
    if (!ctx || !visible || (!feature && !patch)) {
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = '';
    g2 = ctx;
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (patch) drawPatch(patch, W, H);
    else if (feature) drawFeature(feature, W, H);
  };

  // --- dragging and tapping handles ---
  const at = (ev: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  /** Pixels from (x, y) to the patch's design line. */
  const offLine = (x: number, y: number): number => {
    let best = Infinity;
    for (let i = 1; i < designLine.length; i++) {
      const [s0, y0] = designLine[i - 1] ?? [0, 0];
      const [s1, y1] = designLine[i] ?? [0, 0];
      const ax = toX(s0);
      const ay = toY(y0);
      const bx = toX(s1) - ax;
      const by = toY(y1) - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / Math.max(1e-9, bx * bx + by * by)));
      best = Math.min(best, Math.hypot(x - ax - bx * t, y - ay - by * t));
    }
    return best;
  };
  // Taps: one on a handle types a value; two quick ones on an end point remove it, on the line add one.
  const DOUBLE = 320; // ms
  let lastTap: { g: Grip | undefined; x: number; y: number; time: number } | undefined;
  let pendingType: ReturnType<typeof setTimeout> | undefined;
  const typeInto = (g: Grip): void => {
    const typed = prompt(g.name, g.value().toFixed(2));
    const v = typed === null ? NaN : Number(typed);
    if (Number.isFinite(v)) g.type(v);
  };
  const tapped = (g: Grip | undefined, x: number, y: number): void => {
    const now = performance.now();
    const twice = lastTap && now - lastTap.time < DOUBLE && Math.hypot(lastTap.x - x, lastTap.y - y) < 14;
    lastTap = { g, x, y, time: now };
    if (twice && g?.remove) {
      clearTimeout(pendingType);
      lastTap = undefined;
      g.remove();
      return;
    }
    if (twice && !g && addOnLine) {
      lastTap = undefined;
      addOnLine(fromX(x));
      return;
    }
    if (!g) return;
    if (!g.remove) return typeInto(g);
    // An end point might be the first tap of two: wait before asking for a value.
    clearTimeout(pendingType);
    pendingType = setTimeout(() => typeInto(g), DOUBLE);
  };
  canvas.addEventListener('pointerdown', (ev) => {
    const p = at(ev);
    const g = grips.find((q) => Math.hypot(toX(q.s) - p.x, toY(q.y) - p.y) < 12);
    if (!g) {
      if (addOnLine && offLine(p.x, p.y) < 10) tapped(undefined, p.x, p.y);
      return;
    }
    canvas.setPointerCapture(ev.pointerId);
    g.begin();
    drag = { g, x: p.x, y: p.y, moved: false };
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const p = at(ev);
    if (Math.hypot(p.x - drag.x, p.y - drag.y) > 3) drag.moved = true;
    if (drag.moved) drag.g.move(fromX(p.x) - fromX(drag.x), fromY(p.y) - fromY(drag.y), fromX(p.x), fromY(p.y));
  });
  canvas.addEventListener('pointerup', () => {
    const d = drag;
    drag = undefined;
    if (!d) return;
    if (d.moved) {
      d.g.done();
      return;
    }
    tapped(d.g, d.x, d.y);
  });

  addEventListener('resize', redraw);
  return {
    set(f) {
      feature = f;
      patch = undefined;
      redraw();
    },
    setPatch(p, index, basePitch, reach) {
      patch = p ? { p, index, base: basePitch, reach } : undefined;
      if (p) feature = undefined;
      redraw();
    },
    redraw,
    show(on) {
      visible = on;
      redraw();
    },
  };
}
