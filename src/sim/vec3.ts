export type Vec3 = { x: number; y: number; z: number };

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function copy(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

/** Allocation-free copy for anything on the tick path. */
export function copyInto(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function addScaled(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x += a.x * s;
  out.y += a.y * s;
  out.z += a.z * s;
  return out;
}

export function scale(out: Vec3, s: number): Vec3 {
  out.x *= s;
  out.y *= s;
  out.z *= s;
  return out;
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** Fold to −π..π so heading doesn't drift into float ranges that lose precision. */
export function wrapAngle(a: number): number {
  const wrapped = (a + Math.PI) % (Math.PI * 2);
  return (wrapped < 0 ? wrapped + Math.PI * 2 : wrapped) - Math.PI;
}

export function length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function normalize(out: Vec3): Vec3 {
  const l = length(out);
  return l > 0 ? scale(out, 1 / l) : out;
}

/** Remove the component of `out` along unit vector `n`. */
export function projectOntoPlane(out: Vec3, n: Vec3): Vec3 {
  return addScaled(out, n, -dot(out, n));
}

export function clampLength(out: Vec3, max: number): Vec3 {
  const l = length(out);
  return l > max && l > 0 ? scale(out, max / l) : out;
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Frame-rate independent exponential approach: moves `out` toward `target` at `rate` 1/s. */
export function damp(out: Vec3, target: Vec3, rate: number, dt: number): Vec3 {
  const t = 1 - Math.exp(-rate * dt);
  out.x += (target.x - out.x) * t;
  out.y += (target.y - out.y) * t;
  out.z += (target.z - out.z) * t;
  return out;
}

export function dampScalar(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
