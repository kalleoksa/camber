import { normalize, vec3, type Vec3 } from './vec3.ts';
import * as dm from './dmath.ts';
import { buildRail, type Rail, type RailConfig } from './rails.ts';

export type SurfaceType = 'snow' | 'rail' | 'wall' | 'quarter';

export type Contact = {
  height: number;
  normal: Vec3;
  surface: SurfaceType;
  /**
   * On a quarter pipe: the horizontal unit direction back into it, from the pipe's own shape
   * alone — the slope it sits on would tilt the surface normal toward the fall line. 0, 0
   * anywhere else.
   */
  faceX: number;
  faceZ: number;
};

/**
 * The sim only ever asks the world for a contact under a point. Milestone 1 answers
 * analytically; the BVH raycast implementation slots in behind the same call.
 */
export type Terrain = {
  sample(x: number, z: number, out: Contact): Contact;
  /** Rails in world space, built from the config. Empty when there are none. */
  rails: readonly Rail[];
};

export type SlopeConfig = {
  length: number; // m along -Z
  width: number; // m along X
  pitch: number; // rad, fall line points toward -Z
  /** Legacy single kicker, kept so takes recorded with it replay. New terrain uses `kickers`. */
  kicker?: KickerConfig;
  kickers?: KickerConfig[];
  corners?: CornerConfig[];
  quarters?: QuarterConfig[];
  rails?: RailConfig[];
  walls?: WallConfig[];
  /**
   * Grade changes down the run. From `z` on downhill the slope falls at `pitch` instead of
   * what it fell at before, the change rounded over `blend` m so there is no kink to launch
   * off. How a park keeps speed in check between features: a near-flat deck holds speed, a
   * steep pitch builds it.
   */
  grades?: GradeConfig[];
};

/**
 * A corner (hip) jump: a straight takeoff up the fall line to a lip, a flat deck, and
 * landings falling away on both sides and ahead. Come into the takeoff angled left or
 * right and the air carries you over the side landing — frontside one way, backside the
 * other. The landing profile is the kicker's (knuckle, straight, run-out), measured from
 * the deck's edge, so the corners of the deck round off instead of meeting in a crease.
 */
export type CornerConfig = {
  z: number; // m, where the transition starts
  x: number; // m, centre across the slope
  width: number; // m of takeoff
  lipHeight: number; // m above the slope
  lipAngle: number; // rad, takeoff angle relative to the slope
  deckLength: number; // m of flat deck past the lip
  deckWidth: number; // m of flat deck across — the side landings start at its edges
  sideTaper: number; // m over which the takeoff's sides and the side landings' uphill ends fall away
  deckTaper?: number; // m over which the side landings' uphill ends fade in; defaults to `sideTaper` — a short `sideTaper` with this longer is a cut takeoff
  landingAngle: number; // rad the landings fall away below the slope
  knuckleRadius: number; // m
  runoutRadius: number; // m
};

/**
 * A quarter pipe across the fall line, facing uphill: ride down into it, up a transition
 * that steepens to `angle` near vertical, and air out above the deck. A heightfield can't
 * be vertical, so the sim treats a departure from a quarter-pipe face as leaving a vertical
 * top — the horizontal speed carrying you over the deck is dropped (grounded.ts) and the
 * air comes back into the pipe.
 */
export type QuarterConfig = {
  z: number; // m, where the transition starts (downhill is −Z) — with `side`, the centre along the fall line
  x: number; // m, centre across the slope — with `side`, where the transition starts
  width: number; // m — with `side`, its length down the fall line
  height: number; // m above the slope at the coping
  angle: number; // rad of the face at the top — near π/2
  radius: number; // m, transition radius
  deck: number; // m of flat deck behind the coping
  sideTaper: number; // m over which the sides roll off
  side?: 1 | -1; // set: faces across the slope, rising toward +X or −X, as one wall of a halfpipe
  backAngle?: number; // rad of the back face; defaults to `angle`, a drop off the deck
};

export type GradeConfig = {
  z: number; // m, centre of the change
  pitch: number; // rad, the grade from here on
  blend: number; // m over which the grade eases from the old pitch to this one
};

/**
 * A wallride wall running down the fall line (§9): a circular transition from the slope up
 * to a straight face at `angle`, a flat top, and a back face dropping at the same angle.
 * Measured across the slope from `x`, rising toward `side`. The ends fade in over `taper`
 * so it can be ridden onto from the end as well as the side. Terrain data, like a kicker.
 */
export type WallConfig = {
  x: number; // m, where the transition starts
  side: 1 | -1; // rises toward +X or −X
  z: number; // m, uphill end
  length: number; // m down the fall line
  height: number; // m above the slope
  angle: number; // rad of the face from horizontal — must pass wall.minAngle to wallride
  radius: number; // m, transition radius
  top: number; // m of flat top
  taper: number; // m over which each end fades in
};

/**
 * A table-top, measured from the base slope: circular transition up to the lip, a flat
 * deck at lip height, then a landing ramp back down, steeper than the slope. Terrain
 * data rather than params — a take stores it, so a replay rebuilds the same jump.
 * Stand-in until milestone 7's park.json.
 */
export type KickerConfig = {
  z: number; // m, where the transition starts (downhill is −Z)
  x: number; // m, centre across the slope
  width: number; // m
  lipHeight: number; // m above the base slope
  lipAngle: number; // rad, takeoff angle relative to the base slope
  deckLength: number; // m of flat table between lip and knuckle
  sideTaper: number; // m over which the sides fall away, so the edge isn't a wall
  /**
   * A park landing: rounded knuckle, a straight ramp at `landingAngle` below the base
   * slope, and a rounded run-out back onto it. Set these three for that; leave them out
   * and `landingLength` gives the older straight ramp from deck to slope, kept so takes
   * recorded on it still replay.
   */
  landingAngle?: number; // rad the landing falls away below the base slope
  knuckleRadius?: number; // m, convex roll from deck into landing
  runoutRadius?: number; // m, concave roll from landing back onto the slope
  landingLength?: number; // m, legacy straight ramp only
  /**
   * m of table across, when it is wider than the takeoff — a narrow kicker built on a wide
   * table, as parks build them. The table's uphill face fades in over `sideTaper` beside
   * the takeoff. Leave it out and the table is the takeoff's width.
   */
  deckWidth?: number;
  /** m over which the table's and landing's sides fall away, when `deckWidth` is set; defaults to `sideTaper`. A short `sideTaper` with a longer `deckTaper` is a cut takeoff on a rounded table. */
  deckTaper?: number;
  /**
   * A big-air build rather than a table: the lip's back drops to the slope over
   * `backLength`, and the landing is its own hill — rising gently from there to a rounded
   * knuckle `knuckleHeight` above the slope at `deckLength` past the lip, then the landing.
   * You can ride round the takeoff and up the rise onto the knuckle. Needs `deckWidth`.
   */
  knuckleHeight?: number;
  backLength?: number; // m, the lip's back face; defaults to 0.4 × lipHeight (steep)
};

export function createContact(): Contact {
  return { height: 0, normal: vec3(0, 1, 0), surface: 'snow', faceX: 0, faceZ: 0 };
}

/**
 * Constant-pitch plane falling toward -Z, with the sides rolled up slightly so a run
 * that drifts wide is pushed back to the fall line instead of off the edge.
 */
export function createSlope(cfg: SlopeConfig): Terrain {
  const slope = dm.tan(cfg.pitch);
  const half = cfg.width * 0.5;
  const bankHeight = cfg.width * 0.06;
  const bankWidth = cfg.width * 0.3;

  const bank = (x: number): number => {
    const over = Math.abs(x) - (half - bankWidth);
    if (over <= 0) return 0;
    const t = Math.min(over / bankWidth, 1);
    return bankHeight * t * t;
  };

  const kickers = (cfg.kickers ?? (cfg.kicker ? [cfg.kicker] : [])).map(kickerProfile);
  const walls = (cfg.walls ?? []).map(wallProfile);
  const corners = (cfg.corners ?? []).map(cornerProfile);
  const quarters = (cfg.quarters ?? []).map(quarterProfile);
  const grades = gradeProfile(cfg.pitch, cfg.grades ?? []);

  // Features merge by max, so twin kickers can share a table; each is ≥ 0, so where only
  // one is present this is exactly its height and old takes keep their hashes. Grade
  // changes reshape the slope under all of them, so they add.
  const featureHeight = (x: number, z: number): number => {
    let h = 0;
    for (let i = 0; i < kickers.length; i++) h = Math.max(h, kickers[i]?.(x, z) ?? 0);
    for (let i = 0; i < walls.length; i++) h = Math.max(h, walls[i]?.(x, z) ?? 0);
    for (let i = 0; i < corners.length; i++) h = Math.max(h, corners[i]?.(x, z) ?? 0);
    for (let i = 0; i < quarters.length; i++) h = Math.max(h, quarters[i]?.(x, z) ?? 0);
    if (grades) h += grades(x, z);
    return h;
  };

  const heightAt = (x: number, z: number): number => z * slope + bank(x) + featureHeight(x, z);
  const rails = (cfg.rails ?? []).map((r) => buildRail(r, heightAt));

  return {
    rails,
    sample(x, z, out) {
      out.height = z * slope + bank(x);

      // Analytic gradient: dh/dx from the bank, dh/dz from the pitch.
      const eps = 0.05;
      const dhdx = (bank(x + eps) - bank(x - eps)) / (2 * eps);
      out.normal.x = -dhdx;
      out.normal.y = 1;
      out.normal.z = -slope;

      // Features on top, by central difference — only near one, so the plain slope stays
      // bit-identical to before features existed and old takes keep their hashes.
      const kh = featureHeight(x, z);
      if (
        kh !== 0 ||
        featureHeight(x, z + eps) !== 0 ||
        featureHeight(x, z - eps) !== 0 ||
        featureHeight(x + eps, z) !== 0 ||
        featureHeight(x - eps, z) !== 0
      ) {
        out.height += kh;
        out.normal.x -= (featureHeight(x + eps, z) - featureHeight(x - eps, z)) / (2 * eps);
        out.normal.z -= (featureHeight(x, z + eps) - featureHeight(x, z - eps)) / (2 * eps);
      }
      normalize(out.normal);

      out.surface = 'snow';
      out.faceX = 0;
      out.faceZ = 0;
      for (let i = 0; i < walls.length; i++) if ((walls[i]?.(x, z) ?? 0) > 0) out.surface = 'wall';
      for (let i = 0; i < quarters.length; i++) {
        const q = quarters[i];
        if (!q || q(x, z) <= 0) continue;
        out.surface = 'quarter';
        // Down the pipe's own gradient is back into it.
        const gx = (q(x + eps, z) - q(x - eps, z)) / (2 * eps);
        const gz = (q(x, z + eps) - q(x, z - eps)) / (2 * eps);
        const g = Math.sqrt(gx * gx + gz * gz);
        if (g > 1e-9) {
          out.faceX = -gx / g;
          out.faceZ = -gz / g;
        }
      }
      return out;
    },
  };
}

type Profile = (x: number, z: number) => number;

/**
 * Kicker height above the slope, along s = metres downhill past its start. The transition
 * is a circular arc so the rider is loaded smoothly into the lip; its radius follows from
 * lip height and angle (H = R(1 − cos θ), run-in L = R sin θ).
 */
function kickerProfile(k: KickerConfig): Profile {
  const radius = k.lipHeight / (1 - dm.cos(k.lipAngle));
  const runIn = radius * dm.sin(k.lipAngle);
  const deckEnd = runIn + k.deckLength;

  // Park landing geometry: knuckle arc, straight landing, run-out arc. Each arc turns
  // through `landingAngle`, so the knuckle drops Rk(1 − cos α) over Rk sin α and the
  // run-out the same with its own radius; the straight covers the height left between.
  const alpha = k.landingAngle ?? 0;
  const park = alpha > 0;
  const rk = k.knuckleRadius ?? 0;
  const rb = k.runoutRadius ?? 0;
  const knuckleLen = park ? rk * dm.sin(alpha) : 0;
  const knuckleDrop = park ? rk * (1 - dm.cos(alpha)) : 0;
  const runoutLen = park ? rb * dm.sin(alpha) : 0;
  const runoutRise = park ? rb * (1 - dm.cos(alpha)) : 0;
  const slopeAlpha = park ? dm.tan(alpha) : 0;
  // The landing starts at the knuckle: the lip's height on a table, its own on a gap jump.
  const top = k.knuckleHeight ?? k.lipHeight;
  const straightLen = park ? Math.max(0, top - knuckleDrop - runoutRise) / slopeAlpha : 0;
  const knuckleEnd = deckEnd + knuckleLen;
  const straightEnd = knuckleEnd + straightLen;
  const end = park ? straightEnd + runoutLen : deckEnd + (k.landingLength ?? 0);

  // Deck and landing height at s ≥ runIn, park landing only (a wide table implies one).
  const tableHeight = (s: number): number => {
    if (s < deckEnd) return top;
    if (s < knuckleEnd) {
      const u = s - deckEnd;
      return top - (rk - Math.sqrt(rk * rk - u * u));
    }
    if (s < straightEnd) return top - knuckleDrop - (s - knuckleEnd) * slopeAlpha;
    const u = end - s;
    return rb - Math.sqrt(rb * rb - u * u);
  };

  const deckHalf = (k.deckWidth ?? k.width) * 0.5;
  const fade = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  const back = k.backLength ?? k.lipHeight * 0.4;

  return (x: number, z: number): number => {
    const s = k.z - z;
    if (s <= 0 || s >= end) return 0;
    if (k.knuckleHeight !== undefined) {
      // Gap jump: the takeoff at its own width, its back dropping steeply to the slope; the
      // landing hill at the deck's width, rising from the lip to the knuckle (flat at both
      // ends, so it meets the slope and the knuckle without a crease). The higher wins.
      const dx = Math.abs(x - k.x);
      let takeoff = 0;
      if (s < runIn) takeoff = radius - Math.sqrt(radius * radius - s * s);
      else if (s < runIn + back) takeoff = k.lipHeight * (1 - fade((s - runIn) / back));
      takeoff *= fade(1 - (dx - k.width * 0.5) / k.sideTaper);
      let hill = 0;
      if (s > runIn) {
        const along = s < deckEnd ? top * fade((s - runIn) / Math.max(deckEnd - runIn, 1e-3)) : tableHeight(s);
        hill = along * fade(1 - (dx - deckHalf) / (k.deckTaper ?? k.sideTaper));
      }
      return takeoff > hill ? takeoff : hill;
    }
    if (k.deckWidth !== undefined) {
      // Takeoff at its own width; table and landing at the deck's, its uphill face fading
      // in beside the takeoff. The wider of the two wins.
      const dx = Math.abs(x - k.x);
      let takeoff = 0;
      if (s < runIn) takeoff = (radius - Math.sqrt(radius * radius - s * s)) * fade(1 - (dx - k.width * 0.5) / k.sideTaper);
      let table = 0;
      const deckTaper = k.deckTaper ?? k.sideTaper;
      // With `deckTaper` set the face is beside the takeoff only: in front of it, it would
      // sit on the ramp's last metres and round the lip off. Without, the older rule stands
      // so takes recorded on it replay.
      const front = k.deckTaper !== undefined && s < runIn && dx <= k.width * 0.5;
      if (s >= runIn - deckTaper && !front) {
        const along = s < runIn ? k.lipHeight * fade(1 - (runIn - s) / deckTaper) : tableHeight(s);
        table = along * fade(1 - (dx - deckHalf) / deckTaper);
      }
      return takeoff > table ? takeoff : table;
    }
    const side = Math.abs(x - k.x) - k.width * 0.5;
    if (side >= k.sideTaper) return 0;
    let h: number;
    if (s < runIn) h = radius - Math.sqrt(radius * radius - s * s);
    else if (s < deckEnd) h = k.lipHeight;
    else if (!park) h = k.lipHeight * (1 - (s - deckEnd) / (k.landingLength ?? 1));
    else if (s < knuckleEnd) {
      const u = s - deckEnd;
      h = k.lipHeight - (rk - Math.sqrt(rk * rk - u * u));
    } else if (s < straightEnd) h = k.lipHeight - knuckleDrop - (s - knuckleEnd) * slopeAlpha;
    else {
      const u = end - s; // distance still to go to the slope
      h = rb - Math.sqrt(rb * rb - u * u);
    }
    if (side > 0) {
      const t = 1 - side / k.sideTaper;
      h *= t * t * (3 - 2 * t); // smoothstep, so the sides roll off rather than cliff
    }
    return h;
  };
}

/** Wall height above the slope: transition arc, straight face, flat top, back face. */
function wallProfile(w: WallConfig): Profile {
  const r = w.radius;
  const arcLen = r * dm.sin(w.angle);
  const arcRise = r * (1 - dm.cos(w.angle));
  const steep = dm.tan(w.angle);
  const faceEnd = arcLen + Math.max(0, w.height - arcRise) / steep;
  const topEnd = faceEnd + w.top;
  const backEnd = topEnd + w.height / steep;
  return (x: number, z: number): number => {
    const u = (x - w.x) * w.side;
    const s = w.z - z;
    if (u <= 0 || u >= backEnd || s <= 0 || s >= w.length) return 0;
    let h: number;
    if (u < arcLen) h = r - Math.sqrt(r * r - u * u);
    else if (u < faceEnd) h = arcRise + (u - arcLen) * steep;
    else if (u < topEnd) h = w.height;
    else h = w.height - (u - topEnd) * steep;
    const end = Math.min(s, w.length - s);
    if (end < w.taper) {
      const t = end / w.taper;
      h *= t * t * (3 - 2 * t);
    }
    return h;
  };
}

/**
 * Height the grade changes add to the constant-pitch plane. The slope's tan ramps linearly
 * across each blend, so its integral is a parabola there and a straight line past it —
 * rounded in, constant grade out. Negative below a steepening, which is why the feature
 * test in `sample` is `!== 0` rather than `> 0`. Null when there are none.
 */
function gradeProfile(pitch: number, grades: GradeConfig[]): Profile | null {
  if (grades.length === 0) return null;
  const at: number[] = [];
  const blend: number[] = [];
  const step: number[] = []; // change in tan(pitch) at each break
  let prev = dm.tan(pitch);
  for (const g of grades) {
    const next = dm.tan(g.pitch);
    at.push(-g.z);
    blend.push(Math.max(g.blend, 1e-6));
    step.push(next - prev);
    prev = next;
  }
  return (_x: number, z: number): number => {
    const s = -z; // m downhill
    let drop = 0;
    for (let i = 0; i < at.length; i++) {
      const w = blend[i] ?? 1;
      const u = s - (at[i] ?? 0);
      const ramp = u <= -w / 2 ? 0 : u >= w / 2 ? u : ((u + w / 2) * (u + w / 2)) / (2 * w);
      drop += (step[i] ?? 0) * ramp;
    }
    return -drop;
  };
}

/** Corner height above the slope: max of the takeoff and the three-sided landing. */
function cornerProfile(c: CornerConfig): Profile {
  const radius = c.lipHeight / (1 - dm.cos(c.lipAngle));
  const runIn = radius * dm.sin(c.lipAngle);
  const deckEnd = runIn + c.deckLength;
  const halfDeck = c.deckWidth * 0.5;

  // Landing as a function of distance d past the deck's edge, as on a park kicker.
  const alpha = c.landingAngle;
  const rk = c.knuckleRadius;
  const rb = c.runoutRadius;
  const knuckleLen = rk * dm.sin(alpha);
  const knuckleDrop = rk * (1 - dm.cos(alpha));
  const runoutLen = rb * dm.sin(alpha);
  const runoutRise = rb * (1 - dm.cos(alpha));
  const steep = dm.tan(alpha);
  const straightLen = Math.max(0, c.lipHeight - knuckleDrop - runoutRise) / steep;
  const straightEnd = knuckleLen + straightLen;
  const end = straightEnd + runoutLen;
  const landing = (d: number): number => {
    if (d <= 0) return c.lipHeight;
    if (d >= end) return 0;
    if (d < knuckleLen) return c.lipHeight - (rk - Math.sqrt(rk * rk - d * d));
    if (d < straightEnd) return c.lipHeight - knuckleDrop - (d - knuckleLen) * steep;
    const u = end - d;
    return rb - Math.sqrt(rb * rb - u * u);
  };

  return (x: number, z: number): number => {
    const s = c.z - z;
    if (s <= 0 || s >= deckEnd + end) return 0;
    const dx = Math.abs(x - c.x);
    if (dx >= halfDeck + end) return 0;

    // Takeoff: the kicker's arc, sides rolled off.
    let takeoff = 0;
    const side = dx - c.width * 0.5;
    if (s < runIn && side < c.sideTaper) {
      takeoff = radius - Math.sqrt(radius * radius - s * s);
      if (side > 0) {
        const t = 1 - side / c.sideTaper;
        takeoff *= t * t * (3 - 2 * t);
      }
    }

    // Deck and landings, from the lip on; uphill of it the side landings fade in so their
    // ends slope rather than stand as walls beside the takeoff.
    const outX = Math.max(0, dx - halfDeck);
    const outS = Math.max(0, s - deckEnd);
    let land = landing(Math.sqrt(outX * outX + outS * outS));
    if (s < runIn) {
      const t = Math.max(0, 1 - (runIn - s) / (c.deckTaper ?? c.sideTaper));
      land *= t * t * (3 - 2 * t);
      // With `deckTaper` set, only the side landings reach uphill of the lip: in front of the
      // deck the fade would sit on the takeoff itself — a bulge over a long fade, a step over
      // a short one. Without it the older rule stands, so takes recorded on it replay.
      if (c.deckTaper !== undefined && outX <= 0) land = 0;
    }
    return takeoff > land ? takeoff : land;
  };
}

/** Quarter-pipe height above the slope: transition arc, near-vertical face, deck, back drop. */
function quarterProfile(q: QuarterConfig): Profile {
  const r = q.radius;
  const arcLen = r * dm.sin(q.angle);
  const arcRise = r * (1 - dm.cos(q.angle));
  const steep = dm.tan(q.angle);
  const faceEnd = arcLen + Math.max(0, q.height - arcRise) / steep;
  const deckEnd = faceEnd + q.deck;
  const back = q.backAngle === undefined ? steep : dm.tan(q.backAngle);
  const backEnd = deckEnd + q.height / back;
  const across = q.side ?? 0;
  return (x: number, z: number): number => {
    // s runs up the transition; `side` is how far past the pipe's end, along the coping.
    const s = across === 0 ? q.z - z : across * (x - q.x);
    if (s <= 0 || s >= backEnd) return 0;
    const side = (across === 0 ? Math.abs(x - q.x) : Math.abs(z - q.z)) - q.width * 0.5;
    if (side >= q.sideTaper) return 0;
    let h: number;
    if (s < arcLen) h = r - Math.sqrt(r * r - s * s);
    else if (s < faceEnd) h = arcRise + (s - arcLen) * steep;
    else if (s < deckEnd) h = q.height;
    else h = q.height - (s - deckEnd) * back;
    if (side > 0) {
      const t = 1 - side / q.sideTaper;
      h *= t * t * (3 - 2 * t);
    }
    return h;
  };
}
