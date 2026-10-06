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
  /** Show patch `index` instead; `basePitch` the field's grade, rad. */
  setPatch(p: PatchConfig | undefined, index: number, basePitch: number): void;
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

export function createProfile(host: ProfileHost): Profile {
  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;left:316px;right:8px;bottom:8px;height:220px;width:calc(100% - 324px);z-index:2;border-radius:6px;background:rgba(18,24,32,0.88);touch-action:none;display:none';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const c = createContact();
  let feature: FeatureSpec | undefined;
  let patch: { p: PatchConfig; index: number; base: number } | undefined;
  let visible = false;
  let grips: Grip[] = [];
  let drag: { g: Grip; x: number; y: number; moved: boolean } | undefined;
  let designLine: [number, number][] = []; // a patch's design line, for taps on it
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
    const s0 = t ? -Math.max(12, lipOf(f) + 6) : -15;
    const s1 = t ? Math.min(far, 120) : 35;
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

    if (!drag) grips = featureGrips(f, height, base);
    if (grips[1] && grips[0]) line([[grips[0].s, grips[0].y], [grips[1].s, grips[1].y]], '#ffd34d', 1);
    drawGrips();
    const name = f.meta?.design?.kind ?? f.meta?.type ?? f.kind;
    caption(
      W,
      H,
      t ? `${name} · ${t.speed[0]}–${t.speed[1]} m/s · airs: blue slowest (no pop), green middle, red fastest · snow: where airs come down, by impact` : `${name} · section along its axis`,
      grips.length ? 'drag a handle, or tap it to type' : f.meta?.design ? 'designed: change its inputs in the panel' : '',
    );
  };

  const drawPatch = (pt: { p: PatchConfig; index: number; base: number }, W: number, H: number): void => {
    const { p, base } = pt;
    const terrain = host.terrain();
    const dx = Math.sin(p.yaw);
    const dz = -Math.cos(p.yaw);
    const height = (s: number): number => terrain.sample(p.x + dx * s, p.z + dz * s, c).height;
    let total = 0;
    for (const [len] of p.segs) total += len;
    const s0 = -p.blend - 10;
    const s1 = total + p.blend + 10;
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
            move: (ds) => edit((sg) => (sg[0] = Math.max(0.5, was[0] + ds)), false),
            done: () => edit(() => undefined, true),
            type: (v) => edit((sg) => (sg[0] = Math.max(0.5, v)), true),
            remove: () => host.editPatch((q) => void mergeAt(q, k), true),
          },
        );
        at += len;
        top = end.y;
      });
    }
    drawGrips();
    const step = patchStep(p, base);
    caption(
      W,
      H,
      `patch ${pt.index} · dashed yellow: its segments as designed, grey: the base grade · step at its end ${step.toFixed(2)} m${Math.abs(step) > 0.3 ? ' — leaves a step across the slope' : ''}`,
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
    if (twice && !g && patch) {
      lastTap = undefined;
      const s = fromX(x);
      host.editPatch((q) => void splitSegment(q, s), true);
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
      if (patch && offLine(p.x, p.y) < 10) tapped(undefined, p.x, p.y);
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
    setPatch(p, index, basePitch) {
      patch = p ? { p, index, base: basePitch } : undefined;
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
