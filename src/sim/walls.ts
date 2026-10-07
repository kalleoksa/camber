import * as dm from './dmath.ts';

/**
 * A built wallride (docs/walls-plan.md): a plywood panel standing on the snow, ridden on the
 * board's base. A solid object like a rail, not terrain — a heightfield can't hold a vertical
 * face. Its snow ramp, if any, is terrain (`panelRamp`).
 *
 * The base line runs from (x, z) along `yaw` (the feature axis, (sin yaw, −cos yaw): down the
 * fall line at 0) for `length` m, following the snow. The ridden face looks toward `side`
 * (+1: the +across side, (cos yaw, sin yaw)).
 */
export type PanelConfig = {
  x: number;
  z: number;
  yaw: number;
  length: number; // m along the base, horizontal
  height: number; // m up the face
  lean: number; // rad the face leans back from vertical, away from the ridden side
  side: 1 | -1;
  foot: number; // m the bottom edge sits above the snow at its base (the ramp's top included)
  ramp?: { height: number; length: number }; // snow ramp at the foot on the ridden side
};

/** World-space panel, built once: base corner P0, unit along `a`, up the face `e`, normal `n` (out of the ridden face). */
export type Panel = {
  x0: number;
  y0: number;
  z0: number;
  ax: number;
  ay: number;
  az: number;
  ex: number;
  ey: number;
  ez: number;
  nx: number;
  ny: number;
  nz: number;
  length: number; // m along `a`
  height: number; // m along `e`
};

export function buildPanel(cfg: PanelConfig, heightAt: (x: number, z: number) => number): Panel {
  const s = dm.sin(cfg.yaw);
  const c = dm.cos(cfg.yaw);
  // Across, toward the ridden side; sampled a few cm out so the ramp's top counts.
  const hx = cfg.side * c;
  const hz = cfg.side * s;
  const x1 = cfg.x + s * cfg.length;
  const z1 = cfg.z - c * cfg.length;
  const y0 = heightAt(cfg.x + hx * 0.02, cfg.z + hz * 0.02) + cfg.foot;
  const y1 = heightAt(x1 + hx * 0.02, z1 + hz * 0.02) + cfg.foot;
  let ax = x1 - cfg.x;
  let ay = y1 - y0;
  let az = z1 - cfg.z;
  const length = Math.sqrt(ax * ax + ay * ay + az * az);
  ax /= length;
  ay /= length;
  az /= length;
  // Up the face: world up with the along part taken out, then leaned back away from the rider.
  let ex = -ax * ay;
  let ey = 1 - ay * ay;
  let ez = -az * ay;
  const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
  ex /= el;
  ey /= el;
  ez /= el;
  const cl = dm.cos(cfg.lean);
  const sl = dm.sin(cfg.lean);
  ex = ex * cl - hx * sl;
  ey = ey * cl;
  ez = ez * cl - hz * sl;
  // Normal out of the ridden face: a × e, turned toward the rider's side.
  let nx = ay * ez - az * ey;
  let ny = az * ex - ax * ez;
  let nz = ax * ey - ay * ex;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const flip = nx * hx + nz * hz < 0 ? -1 : 1;
  nx = (nx / nl) * flip;
  ny = (ny / nl) * flip;
  nz = (nz / nl) * flip;
  return { x0: cfg.x, y0, z0: cfg.z, ax, ay, az, ex, ey, ez, nx, ny, nz, length, height: cfg.height };
}

/**
 * A built solid standing on the snow — a building, a box, a tombstone — whose sides are faces to
 * wallride: centred on (x, z), `length` m along its axis (yaw), `width` across, `height` tall.
 * Its roof is a raised flat in the terrain height (terrain.ts), ridden like snow. `ramp`: a snow
 * ramp up to the roof against the uphill end (−axis), `length` m long (`blockRamp`).
 */
export type BlockConfig = { x: number; z: number; yaw: number; length: number; width: number; height: number; ramp?: { length: number } };

/** The four outward faces of a block, each a panel standing on the snow. */
export function blockFaces(b: BlockConfig): PanelConfig[] {
  const s = dm.sin(b.yaw);
  const c = dm.cos(b.yaw);
  // Axis (s, −c), across (c, s); start corners for each side.
  const hl = b.length / 2;
  const hw = b.width / 2;
  const face = (x: number, z: number, yaw: number, length: number, side: 1 | -1): PanelConfig => ({ x, z, yaw, length, height: b.height, lean: 0, side, foot: 0 });
  const faces = [
    face(b.x + c * hw - s * hl, b.z + s * hw + c * hl, b.yaw, b.length, 1), // +across side, outward +across
    face(b.x - c * hw - s * hl, b.z - s * hw + c * hl, b.yaw, b.length, -1), // −across side
    face(b.x + s * hl - c * hw, b.z - c * hl - s * hw, b.yaw + Math.PI / 2, b.width, -1), // downhill end, outward +axis
  ];
  // The uphill end is buried under its ramp when there is one: no face to bonk on the way up.
  if (!b.ramp) faces.push(face(b.x - s * hl - c * hw, b.z + c * hl - s * hw, b.yaw + Math.PI / 2, b.width, 1)); // uphill end, outward −axis
  return faces;
}

/**
 * A block's snow ramp, against its uphill end: rising from the snow to the roof over
 * `ramp.length` m, eased at both ends (smoothstep) so it meets the roof flush — a lip there
 * would launch you over it. Full width across the block, the sides falling away over 2 m.
 * 0 on the block itself past the seam, so the side faces stand on the snow.
 */
export function blockRamp(b: BlockConfig): ((x: number, z: number) => number) | undefined {
  const r = b.ramp;
  if (!r) return undefined;
  const s = dm.sin(b.yaw);
  const c = dm.cos(b.yaw);
  const fade = 2;
  return (x, z) => {
    const dx = x - b.x;
    const dz = z - b.z;
    const along = dx * s - dz * c + b.length / 2; // 0 at the uphill end, negative up the ramp
    const across = Math.abs(dx * c + dz * s) - b.width / 2;
    if (along <= -r.length || across >= fade) return 0;
    // Carried a little onto the roof at its full height, so the slope sampled at the seam is
    // the ramp's (flat there), not a drop; the roof merges with it by max (terrain.ts).
    if (along >= 0) return along < 0.2 && across <= 0 ? b.height : 0;
    return b.height * smooth(1 + along / r.length) * (across <= 0 ? 1 : 1 - smooth(across / fade));
  };
}

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The snow ramp at a panel's foot, on the ridden side: concave, rising to `ramp.height` at the
 * panel (steepest there), over `ramp.length` m out from it; the ends fade over 2 m. Height above
 * the snow, 0 outside, like every feature profile.
 */
export function panelRamp(cfg: PanelConfig): ((x: number, z: number) => number) | undefined {
  const r = cfg.ramp;
  if (!r) return undefined;
  const s = dm.sin(cfg.yaw);
  const c = dm.cos(cfg.yaw);
  const fade = 2;
  return (x, z) => {
    const dx = x - cfg.x;
    const dz = z - cfg.z;
    const along = dx * s - dz * c;
    const out = (dx * c + dz * s) * cfg.side;
    if (along <= 0 || along >= cfg.length || out <= 0 || out >= r.length) return 0;
    const t = 1 - out / r.length;
    const ends = smooth(along / fade) * smooth((cfg.length - along) / fade);
    return r.height * t * t * ends;
  };
}
