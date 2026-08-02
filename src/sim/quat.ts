import { type Vec3 } from './vec3.ts';

export type Quat = { x: number; y: number; z: number; w: number };

export function quat(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function setIdentity(out: Quat): Quat {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  out.w = 1;
  return out;
}

export function copyQuat(out: Quat, a: Quat): Quat {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  out.w = a.w;
  return out;
}

export function setFromAxisAngle(out: Quat, axis: Vec3, angle: number): Quat {
  const half = angle * 0.5;
  const s = Math.sin(half);
  out.x = axis.x * s;
  out.y = axis.y * s;
  out.z = axis.z * s;
  out.w = Math.cos(half);
  return out;
}

/** out = a * b. Safe when `out` aliases either input. */
export function multiply(out: Quat, a: Quat, b: Quat): Quat {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}

export function normalizeQuat(out: Quat): Quat {
  const l = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z + out.w * out.w);
  if (l === 0) return setIdentity(out);
  const inv = 1 / l;
  out.x *= inv;
  out.y *= inv;
  out.z *= inv;
  out.w *= inv;
  return out;
}

/** out = q * v * q⁻¹, via v + 2·qv × (qv × v + w·v). */
export function rotate(out: Vec3, q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  out.x = v.x + q.w * tx + q.y * tz - q.z * ty;
  out.y = v.y + q.w * ty + q.z * tx - q.x * tz;
  out.z = v.z + q.w * tz + q.x * ty - q.y * tx;
  return out;
}

/** Board axes without building a matrix: the columns of the rotation are the axes. */
export function axisX(out: Vec3, q: Quat): Vec3 {
  out.x = 1 - 2 * (q.y * q.y + q.z * q.z);
  out.y = 2 * (q.x * q.y + q.z * q.w);
  out.z = 2 * (q.x * q.z - q.y * q.w);
  return out;
}

export function axisY(out: Vec3, q: Quat): Vec3 {
  out.x = 2 * (q.x * q.y - q.z * q.w);
  out.y = 1 - 2 * (q.x * q.x + q.z * q.z);
  out.z = 2 * (q.y * q.z + q.x * q.w);
  return out;
}

export function axisZ(out: Vec3, q: Quat): Vec3 {
  out.x = 2 * (q.x * q.z + q.y * q.w);
  out.y = 2 * (q.y * q.z - q.x * q.w);
  out.z = 1 - 2 * (q.x * q.x + q.y * q.y);
  return out;
}

/** From an orthonormal right-handed basis whose vectors are the board's local axes. */
export function setFromBasis(out: Quat, ex: Vec3, ey: Vec3, ez: Vec3): Quat {
  const trace = ex.x + ey.y + ez.z;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out.w = 0.25 / s;
    out.x = (ey.z - ez.y) * s;
    out.y = (ez.x - ex.z) * s;
    out.z = (ex.y - ey.x) * s;
  } else if (ex.x > ey.y && ex.x > ez.z) {
    const s = 2 * Math.sqrt(1 + ex.x - ey.y - ez.z);
    out.w = (ey.z - ez.y) / s;
    out.x = 0.25 * s;
    out.y = (ey.x + ex.y) / s;
    out.z = (ez.x + ex.z) / s;
  } else if (ey.y > ez.z) {
    const s = 2 * Math.sqrt(1 + ey.y - ex.x - ez.z);
    out.w = (ez.x - ex.z) / s;
    out.x = (ey.x + ex.y) / s;
    out.y = 0.25 * s;
    out.z = (ez.y + ey.z) / s;
  } else {
    const s = 2 * Math.sqrt(1 + ez.z - ex.x - ey.y);
    out.w = (ex.y - ey.x) / s;
    out.x = (ez.x + ex.z) / s;
    out.y = (ez.y + ey.z) / s;
    out.z = 0.25 * s;
  }
  return normalizeQuat(out);
}

export function slerp(out: Quat, a: Quat, b: Quat, t: number): Quat {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka = 1 - t;
  let kb = t;
  if (cos < 0.9995) {
    const angle = Math.acos(cos);
    const sin = Math.sin(angle);
    ka = Math.sin(ka * angle) / sin;
    kb = Math.sin(kb * angle) / sin;
  }
  out.x = a.x * ka + bx * kb;
  out.y = a.y * ka + by * kb;
  out.z = a.z * ka + bz * kb;
  out.w = a.w * ka + bw * kb;
  return normalizeQuat(out);
}
