import * as dm from './dmath.ts';

/**
 * Smaller terrain shapes for the park generator, measured from the ground like a kicker and
 * turned to any heading. Each is a height function in its own frame: `s` metres along its
 * axis from (x, z) — the axis points down the fall line at yaw 0 and turns toward +X as yaw
 * grows — and `w` metres across it.
 */
export type ShapeConfig = RollerConfig | SpineConfig | SideHitConfig | KnollConfig | ShelfConfig | WedgeConfig | BermConfig;

/** A smooth bump across the run: pump it for speed or pop a small air off it. */
export type RollerConfig = { kind: 'roller'; x: number; z: number; yaw: number; height: number; length: number; width: number; taper: number };

/**
 * Two landings back to back, a ridge across the axis at `s = run`: ride up one face, air over
 * the ridge, land on the other — either way. Each face is a landing at `angle` with a rounded
 * top (`knuckleRadius`) and a rounded foot (`footRadius`).
 */
export type SpineConfig = {
  kind: 'spine';
  x: number;
  z: number;
  yaw: number;
  height: number;
  angle: number; // rad of each face
  knuckleRadius: number;
  footRadius: number;
  width: number;
  taper: number;
};

/**
 * A natural kicker along a run's edge: a transition up to a lip, then a quick roll back down;
 * you land on the slope. With `paint` it is a park feature (a mini kicker), lip and sides dyed.
 */
export type SideHitConfig = { kind: 'sideHit'; x: number; z: number; yaw: number; height: number; angle: number; back: number; width: number; taper: number; paint?: boolean };

/**
 * A round natural mound centred on (x, z): a cosine dome `radius` m across its axis and uphill,
 * `back` m downhill — shorter is a steeper back to drop. Pop off the top or roll over it.
 */
export type KnollConfig = { kind: 'knoll'; x: number; z: number; yaw: number; height: number; radius: number; back: number };

/**
 * A drop, built up rather than dug: the ground rises gently over `rise` m to `height`, runs flat
 * (with the ground) for `top` m, then ends in a face at `face` rad. Ride off the edge; the ground
 * below is the landing, so it goes where the ground is already steep.
 */
export type ShelfConfig = { kind: 'shelf'; x: number; z: number; yaw: number; height: number; rise: number; top: number; face: number; width: number; taper: number };

/**
 * A raised block whose faces work as takeoff or landing depending on the approach: head-on a
 * kicker, from the side a hip, straight over a spine. Each face is a transition (`baseRadius`)
 * into a straight at `faceAngle`, up to `height`. Four faces: a pyramid with a `top` m square
 * deck; two: a ridge across the axis, `top` m of flat crest, `width` m wide. Its base starts at
 * (x, z) and its middle is one face's run plus half the top on along the axis.
 */
export type WedgeConfig = { kind: 'wedge'; x: number; z: number; yaw: number; faces: 2 | 4; height: number; faceAngle: number; baseRadius: number; top: number; width: number; taper: number };

/**
 * A banked turn: from (x, z), heading along the axis, an arc of `radius` m turning `sweep` rad
 * toward `side` (+1: toward +X at yaw 0). Outside the arc the ground banks up at `bank` rad to
 * `height`, holds a 1 m top and falls away behind; the ends fade in over `taper` m. Under
 * `wall.minAngle` it is ridden as a carve, not a wallride: speed kept through a turn.
 */
export type BermConfig = { kind: 'berm'; x: number; z: number; yaw: number; radius: number; sweep: number; side: 1 | -1; bank: number; height: number; taper: number };

type Profile = (x: number, z: number) => number;

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** World (x, z) into a feature's frame: along its axis, and across it. Built once per feature. */
export function inFrame(cx: number, cz: number, yaw: number, profile: (s: number, w: number) => number): Profile {
  const c = dm.cos(yaw);
  const sn = dm.sin(yaw);
  return (x, z) => {
    const dx = x - cx;
    const dz = z - cz;
    // The axis is (sin yaw, −cos yaw); across it is (cos yaw, sin yaw).
    return profile(dx * sn - dz * c, dx * c + dz * sn);
  };
}

/** A profile written for yaw 0 (s = cz − z, across = x − cx), turned to `yaw` about (cx, cz). */
export function turned(cx: number, cz: number, yaw: number | undefined, p: Profile): Profile {
  if (!yaw) return p;
  return inFrame(cx, cz, yaw, (s, w) => p(cx + w, cz - s));
}

export function shapeProfile(cfg: ShapeConfig): Profile {
  if (cfg.kind === 'roller') {
    const r = cfg;
    return inFrame(r.x, r.z, r.yaw, (s, w) => {
      if (s <= 0 || s >= r.length) return 0;
      const across = smooth(1 - (Math.abs(w) - r.width / 2) / r.taper);
      return across * r.height * 0.5 * (1 - dm.cos((2 * Math.PI * s) / r.length));
    });
  }
  if (cfg.kind === 'spine') {
    const p = cfg;
    // One face as a function of distance d down from the ridge: knuckle arc, straight, foot arc.
    const kLen = p.knuckleRadius * dm.sin(p.angle);
    const kDrop = p.knuckleRadius * (1 - dm.cos(p.angle));
    const fLen = p.footRadius * dm.sin(p.angle);
    const fRise = p.footRadius * (1 - dm.cos(p.angle));
    const steep = dm.tan(p.angle);
    const straight = Math.max(0, p.height - kDrop - fRise) / steep;
    const run = kLen + straight + fLen; // ridge to foot
    const face = (d: number): number => {
      if (d >= run) return 0;
      if (d < kLen) return p.height - (p.knuckleRadius - Math.sqrt(p.knuckleRadius * p.knuckleRadius - d * d));
      if (d < kLen + straight) return p.height - kDrop - (d - kLen) * steep;
      const u = run - d;
      return p.footRadius - Math.sqrt(p.footRadius * p.footRadius - u * u);
    };
    return inFrame(p.x, p.z, p.yaw, (s, w) => {
      if (s <= 0 || s >= 2 * run) return 0;
      const across = smooth(1 - (Math.abs(w) - p.width / 2) / p.taper);
      return across * face(Math.abs(s - run));
    });
  }
  if (cfg.kind === 'knoll') {
    const k = cfg;
    return inFrame(k.x, k.z, k.yaw, (s, w) => {
      const along = s / (s > 0 ? k.back : k.radius);
      const across = w / k.radius;
      const r2 = along * along + across * across;
      if (r2 >= 1) return 0;
      return k.height * 0.5 * (1 + dm.cos(Math.PI * Math.sqrt(r2)));
    });
  }
  if (cfg.kind === 'wedge') {
    const g = cfg;
    const r = g.baseRadius;
    const a = g.faceAngle;
    const arcLen = r * dm.sin(a);
    const arcRise = Math.min(g.height, r * (1 - dm.cos(a)));
    const steep = dm.tan(a);
    const run = arcLen + Math.max(0, g.height - arcRise) / steep; // base to top, along a face
    const half = run + g.top / 2;
    // A face's height at `d` m in from its base.
    const face = (d: number): number => {
      if (d <= 0) return 0;
      if (d < arcLen) return Math.min(g.height, r - Math.sqrt(r * r - d * d));
      return Math.min(g.height, arcRise + (d - arcLen) * steep);
    };
    return inFrame(g.x, g.z, g.yaw, (s, w) => {
      const along = face(half - Math.abs(s - half));
      if (g.faces === 2) return along * smooth(1 - (Math.abs(w) - g.width / 2) / g.taper);
      const across = face(half - Math.abs(w));
      return along < across ? along : across;
    });
  }
  if (cfg.kind === 'berm') {
    const b = cfg;
    const steep = dm.tan(b.bank);
    const foot = 2; // m of concave foot easing the bank in from the path
    const up = b.height / steep;
    const back = b.height / dm.tan(0.5); // the outside falls away at ~29°
    // Bank height at `u` m outside the turn's path.
    const bank = (u: number): number => {
      if (u <= 0) return 0;
      if (u < foot) return (steep * u * u) / (2 * foot);
      if (u < foot + up) return Math.min(b.height, (steep * foot) / 2 + (u - foot) * steep);
      if (u < foot + up + 1) return b.height;
      return Math.max(0, b.height * (1 - (u - foot - up - 1) / back));
    };
    return inFrame(b.x, b.z, b.yaw, (s, w) => {
      // The turn's centre is `radius` m off to `side`; φ runs along the arc from the start.
      const dw = w - b.side * b.radius;
      const phi = dm.atan2(s, -b.side * dw);
      if (phi <= 0 || phi >= b.sweep) return 0;
      const u = Math.sqrt(s * s + dw * dw) - b.radius;
      const ends = smooth((phi * b.radius) / b.taper) * smooth(((b.sweep - phi) * b.radius) / b.taper);
      return bank(u) * ends;
    });
  }
  if (cfg.kind === 'shelf') {
    const f = cfg;
    const edge = f.rise + f.top;
    const end = edge + f.height / dm.tan(f.face);
    return inFrame(f.x, f.z, f.yaw, (s, w) => {
      if (s <= 0 || s >= end) return 0;
      const across = smooth(1 - (Math.abs(w) - f.width / 2) / f.taper);
      const up = s < f.rise ? f.height * smooth(s / f.rise) : s < edge ? f.height : f.height * (1 - (s - edge) / (end - edge));
      return across * up;
    });
  }
  const h = cfg;
  const radius = h.height / (1 - dm.cos(h.angle));
  const runIn = radius * dm.sin(h.angle);
  return inFrame(h.x, h.z, h.yaw, (s, w) => {
    if (s <= 0 || s >= runIn + h.back) return 0;
    const across = smooth(1 - (Math.abs(w) - h.width / 2) / h.taper);
    const up = s < runIn ? radius - Math.sqrt(radius * radius - s * s) : h.height * (1 - smooth((s - runIn) / h.back));
    return across * up;
  });
}

/** Where a shape takes off from and which way, for overlays and the connection graph: along-axis distance of its lip, or −1 for none. */
export function shapeLip(cfg: ShapeConfig): number {
  if (cfg.kind === 'sideHit') return (cfg.height / (1 - dm.cos(cfg.angle))) * dm.sin(cfg.angle);
  if (cfg.kind === 'roller') return cfg.length / 2;
  if (cfg.kind === 'knoll') return 0;
  if (cfg.kind === 'shelf') return cfg.rise + cfg.top;
  if (cfg.kind === 'wedge') {
    // The uphill face's top edge.
    const a = cfg.faceAngle;
    const arcRise = Math.min(cfg.height, cfg.baseRadius * (1 - dm.cos(a)));
    return cfg.baseRadius * dm.sin(a) + Math.max(0, cfg.height - arcRise) / dm.tan(a);
  }
  return -1;
}
