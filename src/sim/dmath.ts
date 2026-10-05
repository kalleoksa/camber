/**
 * Deterministic transcendentals for the sim (invariant 4, across machines).
 *
 * `Math.exp`, `sin`, `pow` and friends are only specified as "implementation-
 * approximated": engines compile them from C, and on ARM the compiler may fuse a
 * multiply and an add, so an M-series Mac and an x86 CI runner disagree in the last
 * bit — and the sim amplifies one bit into a different run. JavaScript arithmetic itself
 * is exact IEEE per operation and may never be fused, and `Math.sqrt` is correctly
 * rounded everywhere, so everything here is built from those alone.
 *
 * Accuracy is a couple of ulps (checked against Math.* by `npm run check-math`), which
 * is irrelevant to feel. Identical results everywhere is the whole point.
 * Only `sqrt`, `abs`, `min`, `max`, `floor`, `round`, `sign`, `imul` from Math may be
 * used directly under src/sim — CI greps for the rest.
 */

const LN2_HI = 6.93147180369123816490e-1; // trailing zero bits, so k * LN2_HI is exact
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700;

// π/2 in three parts, each short enough that k * part is exact for moderate k.
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;
const TWO_OVER_PI = 6.36619772367581382433e-1;

const PI = 3.141592653589793;
const PI_2 = 1.5707963267948966;
const PI_6 = 0.5235987755982988;
const SQRT3 = 1.7320508075688772;
const TAN_PI_12 = 0.2679491924311227;

// Bit access for 2^k and for splitting a double into mantissa and exponent.
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
// Which word holds the exponent depends on endianness; find out once.
f64[0] = 1;
const HI = u32[1] === 0x3ff00000 ? 1 : 0;
const LO = 1 - HI;

/** Exactly 2^k for k in [-1022, 1023]. */
function pow2(k: number): number {
  u32[LO] = 0;
  u32[HI] = (k + 1023) << 20;
  return f64[0] ?? 0;
}

function scaleByPow2(x: number, k: number): number {
  if (k > 1023) return x * pow2(1023) * pow2(k - 1023);
  if (k < -1022) return x * pow2(-1022) * pow2(Math.max(k + 1022, -1022));
  return x * pow2(k);
}

export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019412) return 0;
  // x = k·ln2 + r, |r| ≤ ln2/2, then e^r by Taylor — 14 terms reach below 1 ulp there.
  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2_HI - k * LN2_LO;
  let p = 1 / 6227020800; // 1/13!
  p = p * r + 1 / 479001600;
  p = p * r + 1 / 39916800;
  p = p * r + 1 / 3628800;
  p = p * r + 1 / 362880;
  p = p * r + 1 / 40320;
  p = p * r + 1 / 5040;
  p = p * r + 1 / 720;
  p = p * r + 1 / 120;
  p = p * r + 1 / 24;
  p = p * r + 1 / 6;
  p = p * r + 0.5;
  p = p * r + 1;
  p = p * r + 1;
  return scaleByPow2(p, k);
}

export function log(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let e = 0;
  if (x < 2.2250738585072014e-308) {
    x *= 18014398509481984; // 2^54, lifts a subnormal into the normal range
    e = -54;
  }
  // x = m · 2^e with m in [√½, √2).
  f64[0] = x;
  const hi = u32[HI] ?? 0;
  e += ((hi >>> 20) & 0x7ff) - 1023;
  u32[HI] = (hi & 0x000fffff) | 0x3ff00000;
  let m = f64[0] ?? 1;
  if (m > 1.4142135623730951) {
    m *= 0.5;
    e += 1;
  }
  // ln m = 2·atanh(s), s = (m−1)/(m+1), |s| ≤ 0.1716 — odd series to s^23.
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let q = 1 / 23;
  q = q * s2 + 1 / 21;
  q = q * s2 + 1 / 19;
  q = q * s2 + 1 / 17;
  q = q * s2 + 1 / 15;
  q = q * s2 + 1 / 13;
  q = q * s2 + 1 / 11;
  q = q * s2 + 1 / 9;
  q = q * s2 + 1 / 7;
  q = q * s2 + 1 / 5;
  q = q * s2 + 1 / 3;
  q = q * s2 + 1;
  return e * LN2_HI + (2 * s * q + e * LN2_LO);
}

/** x^y for x ≥ 0 — all the sim needs. Negative x gives NaN. */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x !== x || y !== y || x < 0) return NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x === 1) return 1;
  return exp(y * log(x));
}

/** sin on [−π/4, π/4], odd Taylor to r^19. */
function kernelSin(r: number): number {
  const r2 = r * r;
  let p = -1 / 121645100408832000; // −1/19!
  p = p * r2 + 1 / 355687428096000;
  p = p * r2 - 1 / 1307674368000;
  p = p * r2 + 1 / 6227020800;
  p = p * r2 - 1 / 39916800;
  p = p * r2 + 1 / 362880;
  p = p * r2 - 1 / 5040;
  p = p * r2 + 1 / 120;
  p = p * r2 - 1 / 6;
  return r + r * r2 * p;
}

/** cos on [−π/4, π/4], even Taylor to r^20. */
function kernelCos(r: number): number {
  const r2 = r * r;
  let p = 1 / 2432902008176640000; // 1/20!
  p = p * r2 - 1 / 6402373705728000;
  p = p * r2 + 1 / 20922789888000;
  p = p * r2 - 1 / 87178291200;
  p = p * r2 + 1 / 479001600;
  p = p * r2 - 1 / 3628800;
  p = p * r2 + 1 / 40320;
  p = p * r2 - 1 / 720;
  p = p * r2 + 1 / 24;
  return 1 - 0.5 * r2 + r2 * r2 * p;
}

/** x = k·π/2 + r. Writes r and returns the quadrant. Exact enough for |x| up to ~1e9. */
let reduced = 0;
function reduce(x: number): number {
  const k = Math.round(x * TWO_OVER_PI);
  reduced = x - k * PIO2_1 - k * PIO2_2 - k * PIO2_3 - k * PIO2_3T;
  return ((k % 4) + 4) % 4;
}

export function sin(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const q = reduce(x);
  if (q === 0) return kernelSin(reduced);
  if (q === 1) return kernelCos(reduced);
  if (q === 2) return -kernelSin(reduced);
  return -kernelCos(reduced);
}

export function cos(x: number): number {
  if (x !== x || x === Infinity || x === -Infinity) return NaN;
  const q = reduce(x);
  if (q === 0) return kernelCos(reduced);
  if (q === 1) return -kernelSin(reduced);
  if (q === 2) return -kernelCos(reduced);
  return kernelSin(reduced);
}

export function tan(x: number): number {
  return sin(x) / cos(x);
}

export function atan(x: number): number {
  if (x !== x) return NaN;
  const neg = x < 0;
  let t = neg ? -x : x;
  let offset = 0;
  if (t > 1) {
    t = 1 / t;
    offset = PI_2;
  }
  let shift = 0;
  if (t > TAN_PI_12) {
    // atan t = π/6 + atan((t√3 − 1)/(√3 + t)), which lands back under tan(π/12).
    t = (t * SQRT3 - 1) / (SQRT3 + t);
    shift = PI_6;
  }
  // Odd series to t^31, |t| ≤ 0.268.
  const t2 = t * t;
  let p = -1 / 31;
  p = p * t2 + 1 / 29;
  p = p * t2 - 1 / 27;
  p = p * t2 + 1 / 25;
  p = p * t2 - 1 / 23;
  p = p * t2 + 1 / 21;
  p = p * t2 - 1 / 19;
  p = p * t2 + 1 / 17;
  p = p * t2 - 1 / 15;
  p = p * t2 + 1 / 13;
  p = p * t2 - 1 / 11;
  p = p * t2 + 1 / 9;
  p = p * t2 - 1 / 7;
  p = p * t2 + 1 / 5;
  p = p * t2 - 1 / 3;
  let a = t + t * t2 * p + shift;
  if (offset) a = offset - a;
  return neg ? -a : a;
}

/** Quadrant-correct atan(y/x). (0, 0) returns 0 — callers guard the zero vector. */
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x === 0) return y > 0 ? PI_2 : y < 0 ? -PI_2 : 0;
  // Keep the ratio ≤ 1 in magnitude so atan's reduction does the least work.
  if (Math.abs(y) > Math.abs(x)) {
    const a = atan(x / y);
    return y > 0 ? PI_2 - a : -PI_2 - a;
  }
  const a = atan(y / x);
  if (x > 0) return a;
  return y >= 0 ? a + PI : a - PI;
}

/** For x in [−1, 1]. (1 − x)(1 + x) rather than 1 − x², which cancels near ±1. */
export function acos(x: number): number {
  if (x !== x || x > 1 || x < -1) return NaN;
  return atan2(Math.sqrt((1 - x) * (1 + x)), x);
}
