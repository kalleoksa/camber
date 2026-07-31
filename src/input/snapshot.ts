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

export function cloneInput(a: InputSnapshot): InputSnapshot {
  return { ...a };
}

/** Quantized to 1/1000 so a take round-trips through JSON without drifting. */
export function quantizeInput(a: InputSnapshot): InputSnapshot {
  const q = (v: number): number => Math.round(v * 1000) / 1000;
  return { ...a, lx: q(a.lx), ly: q(a.ly), rx: q(a.rx), ry: q(a.ry), lt: q(a.lt), rt: q(a.rt) };
}
