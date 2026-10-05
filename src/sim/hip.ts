import * as dm from './dmath.ts';
import type { CornerConfig } from './terrain.ts';

/**
 * A hip, after the hip jump spec (Claude Docs "Camber — Hip Jump Spec"). The takeoff faces down
 * its axis: a constant-radius transition finishing in a straight lip, its sides cut. A table
 * (0 m: a pointed hip) runs on in line at lip height. The knuckle runs from the lip corner along
 * the table's side and across its end; everything outside it, from the lip line down, is
 * landing, falling away from the nearest point of that line — sideways off the table, round its
 * end corner like the shoulder of a cone, straight on past its end (the second landing) — and
 * down the hill with the ground under it. Its uphill edge is cut at the lip line: seen from the
 * side, that edge is the knuckle running from the lip corner down to the snow. The landing
 * starts gently over a small knuckle and steepens with distance, as a constant-impact landing
 * does, then eases out through a bottom transition. Single (one side) or double.
 */
export type HipShape = {
  side: -1 | 0 | 1; // landing toward −x, +x (in the hip's own frame, yaw 0), or both
  straightLip: number; // m held straight at the lip angle at the top of the takeoff
  landingStart: number; // rad, the landing's grade just past the knuckle
  landingEnd: number; // rad, its grade before the bottom transition
  knuckleRadius: number; // m
  bottomRadius: number; // m, the transition into the outrun
};

type Profile = (x: number, z: number) => number;

/** Takeoff geometry: transition radius, where the arc ends and the lip is (m along the axis). */
export function hipTakeoff(c: CornerConfig, hip: HipShape): { radius: number; arcEnd: number; runIn: number; straight: number } {
  const th = c.lipAngle;
  // Straight part first; whatever height it doesn't take, the arc does.
  const straight = Math.min(hip.straightLip, (c.lipHeight * 0.5) / dm.sin(th));
  const radius = (c.lipHeight - straight * dm.sin(th)) / (1 - dm.cos(th));
  const arcEnd = radius * dm.sin(th);
  return { radius, arcEnd, runIn: arcEnd + straight * dm.cos(th), straight };
}

export function hipProfile(c: CornerConfig, hip: HipShape): Profile {
  const H = c.lipHeight;
  const { radius, arcEnd, runIn } = hipTakeoff(c, hip);
  const tanTh = dm.tan(c.lipAngle);
  const takeoff = (s: number): number => (s < arcEnd ? radius - Math.sqrt(radius * radius - s * s) : radius * (1 - dm.cos(c.lipAngle)) + (s - arcEnd) * tanTh);
  const half = c.deckWidth * 0.5;
  const deckEnd = runIn + c.deckLength;

  // The landing as drop below lip height at distance d from the knuckle line: knuckle arc to
  // landingStart, a grade steepening evenly to landingEnd, the bottom arc out to the snow. The
  // steepening part takes whatever height the two arcs leave; arcs too big for the height shrink.
  const a0 = hip.landingStart;
  const a1 = Math.max(hip.landingEnd, a0 + 1e-3);
  let rk = hip.knuckleRadius;
  let rb = hip.bottomRadius;
  const arcs = rk * (1 - dm.cos(a0)) + rb * (1 - dm.cos(a1));
  if (arcs > H * 0.8) {
    rk *= (H * 0.8) / arcs;
    rb *= (H * 0.8) / arcs;
  }
  const kLen = rk * dm.sin(a0);
  const kDrop = rk * (1 - dm.cos(a0));
  const bLen = rb * dm.sin(a1);
  const bDrop = rb * (1 - dm.cos(a1));
  // ∫ tan of a grade rising evenly from a0 to a1 over L is L·(ln cos a0 − ln cos a1)/(a1 − a0).
  const perMetre = (dm.log(dm.cos(a0)) - dm.log(dm.cos(a1))) / (a1 - a0);
  const steepLen = Math.max(0, H - kDrop - bDrop) / perMetre;
  const end = kLen + steepLen + bLen;
  const drop = (d: number): number => {
    if (d <= 0) return 0;
    if (d >= end) return H;
    if (d < kLen) return rk - Math.sqrt(rk * rk - d * d);
    if (d < kLen + steepLen) {
      const u = d - kLen;
      const a = a0 + ((a1 - a0) * u) / steepLen;
      return kDrop + (steepLen / (a1 - a0)) * (dm.log(dm.cos(a0)) - dm.log(dm.cos(a)));
    }
    const v = end - d;
    return H - (rb - Math.sqrt(rb * rb - v * v));
  };
  const fade = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const cut = c.deckTaper ?? c.sideTaper;

  return (x: number, z: number): number => {
    const s = c.z - z;
    if (s <= 0 || s >= deckEnd + end) return 0;
    const sx = x - c.x;
    const w = Math.abs(sx);
    if (w >= half + end) return 0;
    const landingSide = hip.side === 0 || sx * hip.side >= 0;

    // Takeoff (sides cut) and table.
    if (s < runIn) {
      const ramp = takeoff(s) * fade(1 - (w - half) / c.sideTaper);
      if (!landingSide || w <= half) return ramp;
      // Beside it, the landing's uphill edge: cut at the lip line.
      const edge = (H - drop(w - half)) * fade(1 - (runIn - s) / cut);
      return ramp > edge ? ramp : edge;
    }
    if (s <= deckEnd && w <= half) return H;

    // Landing: distance from the knuckle line (the table's side, its end, the corner between).
    const py = Math.max(0, w - half);
    const px = Math.max(0, s - deckEnd);
    if (!landingSide) {
      // No landing this side: the table cut, the second landing only straight on.
      if (s <= deckEnd) return H * fade(1 - py / cut);
      return (H - drop(px)) * fade(1 - py / cut);
    }
    return H - drop(Math.sqrt(px * px + py * py));
  };
}
