/** One tick of player intent. Normalized and deadzoned before it reaches the sim. */
export type InputSnapshot = {
  lx: number; // left stick X, -1..1
  ly: number; // left stick Y, -1..1, positive = up (nose)
  rx: number; // right stick X, -1..1
  ry: number; // right stick Y, -1..1, positive = up
  lt: number; // left trigger, 0..1
  rt: number; // right trigger, 0..1
  lb: boolean;
  rb: boolean;
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
};

export function neutralInput(): InputSnapshot {
  return { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, lb: false, rb: false, a: false, b: false, x: false, y: false };
}

export function copyInput(dst: InputSnapshot, src: InputSnapshot): InputSnapshot {
  dst.lx = src.lx;
  dst.ly = src.ly;
  dst.rx = src.rx;
  dst.ry = src.ry;
  dst.lt = src.lt;
  dst.rt = src.rt;
  dst.lb = src.lb;
  dst.rb = src.rb;
  dst.a = src.a;
  dst.b = src.b;
  dst.x = src.x;
  dst.y = src.y;
  return dst;
}

function q(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Quantized to 1/1000 so a take round-trips through JSON without drifting. Writes into
 * `out` — pass a reused buffer on the per-tick path, or omit it when building a take.
 */
export function quantizeInput(a: InputSnapshot, out: InputSnapshot = neutralInput()): InputSnapshot {
  copyInput(out, a);
  out.lx = q(a.lx);
  out.ly = q(a.ly);
  out.rx = q(a.rx);
  out.ry = q(a.ry);
  out.lt = q(a.lt);
  out.rt = q(a.rt);
  return out;
}
