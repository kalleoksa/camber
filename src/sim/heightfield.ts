import * as dm from './dmath.ts';
import { createRng, next } from './rng.ts';

/**
 * Generated ground: a plane at `pitch` reshaped by band patches and smooth noise, baked into
 * a grid once at load and sampled bicubically, so height and slope are continuous everywhere.
 * Everything here is data a take stores, and the bake uses dmath and the seeded rng, so the
 * same config gives the same ground on every machine.
 */
export type FieldConfig = {
  pitch: number; // rad, the base grade; the fall line points toward -Z
  width: number; // m across, centred on x = 0
  length: number; // m down the hill from z = 0
  cell: number; // m between grid nodes
  bankWidth: number; // m over which the zone's edges roll up
  bankHeight: number; // m they roll up by
  noise: { seed: number; amp: number; wavelength: number; octaves: number }; // amp in m
  patches: PatchConfig[];
};

/**
 * A stretch of terrain at its own steepness. Starting at `z` and running downhill, the ground
 * follows `segs` ([length m, pitch rad] each) instead of the base pitch, eased between segments
 * over `blend` m. Across the slope it covers `halfWidth` either side of `x`, fading out over
 * `edge`. The segments must give back the height they take (a flat bench then a steeper roll),
 * or the patch leaves a step across the slope below it.
 */
export type PatchConfig = {
  x: number;
  z: number;
  yaw: number; // rad its axis turns off the fall line, so bands don't all run square across

  halfWidth: number;
  edge: number;
  blend: number;
  segs: [number, number][];
};

export type Field = {
  cols: number;
  rows: number;
  x0: number; // m, x of column 0
  z0: number; // m, z of row 0 (rows run downhill, -Z)
  cell: number;
  h: Float64Array;
};

const MARGIN = 40; // m of grid past the zone on every side, for run-out and the bicubic stencil
const STEP = 0.5; // m, resolution of a patch's height profile

export function buildField(cfg: FieldConfig): Field {
  const cell = cfg.cell;
  const x0 = -cfg.width / 2 - MARGIN;
  const z0 = MARGIN;
  const cols = Math.ceil((cfg.width + 2 * MARGIN) / cell) + 1;
  const rows = Math.ceil((cfg.length + 2 * MARGIN) / cell) + 1;
  const h = new Float64Array(cols * rows);
  const slope = dm.tan(cfg.pitch);
  const profiles = cfg.patches.map((p) => patchProfile(p, slope));
  const cosYaw = cfg.patches.map((p) => dm.cos(p.yaw));
  const sinYaw = cfg.patches.map((p) => dm.sin(p.yaw));
  const noise = noiseLattice(cfg);
  const half = cfg.width / 2;

  for (let j = 0; j < rows; j++) {
    const z = z0 - j * cell;
    for (let i = 0; i < cols; i++) {
      const x = x0 + i * cell;
      let y = z * slope + noise(x, z);
      // Banks: the zone's edges roll up so a run drifting wide is turned back in.
      const over = Math.abs(x) - (half - cfg.bankWidth);
      if (over > 0) {
        const t = Math.min(over / cfg.bankWidth, 1);
        y += cfg.bankHeight * t * t;
      }
      for (let k = 0; k < cfg.patches.length; k++) {
        const p = cfg.patches[k];
        const prof = profiles[k];
        if (!p || !prof) continue;
        // In the patch's own frame: `along` down its axis, `across` its width.
        const c = cosYaw[k] ?? 1;
        const sn = sinYaw[k] ?? 0;
        const along = (p.z - z) * c + (x - p.x) * sn;
        const across = (x - p.x) * c - (p.z - z) * sn;
        const dx = Math.abs(across) - p.halfWidth;
        if (dx >= p.edge) continue;
        let w = 1;
        if (dx > 0) {
          const t = 1 - dx / p.edge;
          w = t * t * (3 - 2 * t);
        }
        y += w * profileAt(prof, along);
      }
      h[j * cols + i] = y;
    }
  }
  return { cols, rows, x0, z0, cell, h };
}

/**
 * A patch's height over the base plane at each STEP down from its start: the integral of
 * (base grade − its own grade), with the grade eased between segments by a moving average.
 */
type Profile = { data: Float64Array; pad: number };

function patchProfile(p: PatchConfig, baseSlope: number): Profile {
  let total = 0;
  for (const [len] of p.segs) total += len;
  const pad = p.blend;
  const n = Math.ceil((total + 2 * pad) / STEP) + 1;
  // Grade (tan of pitch) at each step, from `pad` before the patch to `pad` after it.
  const grade = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * STEP - pad;
    let g = baseSlope;
    let at = 0;
    for (const [len, pitch] of p.segs) {
      if (s >= at && s < at + len) g = dm.tan(pitch);
      at += len;
    }
    grade[i] = g;
  }
  // Ease: two passes of a box filter `blend` wide (a triangle), which keeps the integral.
  const r = Math.max(1, Math.round(p.blend / STEP / 2));
  const eased = boxFilter(boxFilter(grade, r), r);
  const out = new Float64Array(n);
  for (let i = 1; i < n; i++) out[i] = (out[i - 1] ?? 0) + (baseSlope - ((eased[i] ?? 0) + (eased[i - 1] ?? 0)) / 2) * STEP;
  return { data: out, pad };
}

function boxFilter(src: Float64Array, r: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[Math.min(n - 1, Math.max(0, i + k))] ?? 0;
    out[i] = sum / (2 * r + 1);
  }
  return out;
}

/** Profile height at s m downhill of the patch start; it begins `pad` uphill of that. */
function profileAt(prof: Profile, s: number): number {
  const u = (s + prof.pad) / STEP;
  if (u <= 0) return 0;
  const last = prof.data.length - 1;
  if (u >= last) return prof.data[last] ?? 0;
  const i = Math.floor(u);
  const f = u - i;
  return (prof.data[i] ?? 0) * (1 - f) + (prof.data[i + 1] ?? 0) * f;
}

/** Value noise: seeded lattice values, quintic-faded, a few octaves. */
function noiseLattice(cfg: FieldConfig): (x: number, z: number) => number {
  const { seed, amp, wavelength, octaves } = cfg.noise;
  if (amp <= 0 || octaves <= 0) return () => 0;
  const rng = createRng(seed);
  const size = 64; // lattice repeats every 64 wavelengths, far past any zone
  const lattice = new Float64Array(size * size * octaves);
  for (let i = 0; i < lattice.length; i++) lattice[i] = next(rng) * 2 - 1;
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, z) => {
    let sum = 0;
    let a = amp;
    let wl = wavelength;
    for (let o = 0; o < octaves; o++) {
      const u = x / wl + 1000;
      const v = -z / wl + 1000;
      const iu = Math.floor(u);
      const iv = Math.floor(v);
      const fu = fade(u - iu);
      const fv = fade(v - iv);
      const at = (p: number, q: number): number => lattice[o * size * size + (((q % size) + size) % size) * size + (((p % size) + size) % size)] ?? 0;
      const top = at(iu, iv) * (1 - fu) + at(iu + 1, iv) * fu;
      const bottom = at(iu, iv + 1) * (1 - fu) + at(iu + 1, iv + 1) * fu;
      sum += a * (top * (1 - fv) + bottom * fv);
      a *= 0.5;
      wl *= 0.5;
    }
    return sum;
  };
}

/** Height and slope written here by sampleField: module scratch, so the tick path never allocates. */
export type FieldSample = { h: number; dx: number; dz: number };

/** Catmull-Rom bicubic: height plus its x and z derivatives, continuous across cells. */
export function sampleField(f: Field, x: number, z: number, out: FieldSample): FieldSample {
  const u = (x - f.x0) / f.cell;
  const v = (f.z0 - z) / f.cell;
  const iu = Math.min(f.cols - 3, Math.max(1, Math.floor(u)));
  const iv = Math.min(f.rows - 3, Math.max(1, Math.floor(v)));
  const tu = Math.min(1, Math.max(0, u - iu));
  const tv = Math.min(1, Math.max(0, v - iv));
  let h = 0;
  let du = 0;
  let dv = 0;
  for (let b = -1; b <= 2; b++) {
    const wv = cr(tv, b);
    const dwv = crd(tv, b);
    let row = 0;
    let rowD = 0;
    for (let a = -1; a <= 2; a++) {
      const y = f.h[(iv + b) * f.cols + iu + a] ?? 0;
      row += cr(tu, a) * y;
      rowD += crd(tu, a) * y;
    }
    h += wv * row;
    du += wv * rowD;
    dv += dwv * row;
  }
  out.h = h;
  out.dx = du / f.cell;
  out.dz = -dv / f.cell; // rows run toward -Z
  return out;
}

/** Catmull-Rom weight of node k (−1..2) at t in [0, 1]. */
function cr(t: number, k: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  if (k === -1) return 0.5 * (-t3 + 2 * t2 - t);
  if (k === 0) return 0.5 * (3 * t3 - 5 * t2 + 2);
  if (k === 1) return 0.5 * (-3 * t3 + 4 * t2 + t);
  return 0.5 * (t3 - t2);
}

function crd(t: number, k: number): number {
  const t2 = t * t;
  if (k === -1) return 0.5 * (-3 * t2 + 4 * t - 1);
  if (k === 0) return 0.5 * (9 * t2 - 10 * t);
  if (k === 1) return 0.5 * (-9 * t2 + 8 * t + 1);
  return 0.5 * (3 * t2 - 2 * t);
}
