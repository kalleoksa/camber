import type { Params } from './params.ts';
import * as dm from './dmath.ts';

/**
 * Board attitude per grab, sim side, because the landing test judges it (§6, §7.4).
 *
 * Each named grab sits at a spot in (edge, t) grab space — its anchor's gripping-hand
 * coordinate in src/render/poses.ts — and takes its pitch and roll from `params.grab`,
 * so a take carries them and pose mode's "write to anchor" updates them. In play the rig
 * draws these, not the anchor's own boardPitch/tweakRoll.
 *
 * The tweaked attitude is what full stick push reaches. Where a grab has a tweaked sibling
 * on the same spot (japan is a shoved-out mute) it is that one's; elsewhere the base is
 * scaled by `grab.tweakGain`.
 */
type GrabParam = keyof Params['grab'];
// Keys spelled out, not built with a template literal — that would allocate a string per
// spot per tick (invariant 7).
type Spot = { edge: number; t: number; front: boolean; pitch: GrabParam; roll: GrabParam; tweakedPitch?: GrabParam; tweakedRoll?: GrabParam; yaw: GrabParam; tweakedYaw?: GrabParam };

const SPOTS: readonly Spot[] = [
  { edge: 1, t: 0.38, front: false, pitch: 'indyPitch', roll: 'indyRoll', yaw: 'indyYaw' },
  { edge: 1, t: 0.54, front: true, pitch: 'mutePitch', roll: 'muteRoll', yaw: 'muteYaw', tweakedPitch: 'japanPitch', tweakedRoll: 'japanRoll', tweakedYaw: 'japanYaw' },
  { edge: -1, t: 0.55, front: true, pitch: 'melonPitch', roll: 'melonRoll', yaw: 'melonYaw' },
  { edge: -1, t: 0.83, front: true, pitch: 'methodPitch', roll: 'methodRoll', yaw: 'methodYaw' },
  { edge: -1, t: 0.39, front: false, pitch: 'stalefishPitch', roll: 'stalefishRoll', yaw: 'stalefishYaw' },
  { edge: 1, t: 1, front: true, pitch: 'nosegrabPitch', roll: 'nosegrabRoll', yaw: 'nosegrabYaw' },
  { edge: 1, t: 0, front: false, pitch: 'tailgrabPitch', roll: 'tailgrabRoll', yaw: 'tailgrabYaw' },
];

// The grab a sideways stick lands on, each edge: indy on the toes, melon on the heels.
const TOE_CENTER = SPOTS[0]?.t ?? 0.5;
const HEEL_CENTER = SPOTS[2]?.t ?? 0.5;

/**
 * Board `t` for the right stick (`up` toward the nose, `side` its X, `edge` already
 * resolved). Within `band` rad of sideways it is the edge's main grab, past it a straight
 * run to the nose or tail at vertical — so a thumb a few degrees off still gets an indy or
 * a melon, and mute, stalefish and method each have a wide arc of their own.
 */
export function stickT(up: number, side: number, edge: number, band: number): number {
  const center = HEEL_CENTER + (TOE_CENTER - HEEL_CENTER) * (edge + 1) * 0.5;
  const angle = dm.atan2(up, Math.abs(side)); // rad off sideways, + toward the nose
  const span = Math.PI / 2 - band;
  if (angle > band) return center + (1 - center) * Math.min(1, (angle - band) / span);
  if (angle < -band) return center - center * Math.min(1, (-angle - band) / span);
  return center;
}

/**
 * Which hand a grab at (`edge`, `t`) is held with: the nearest named grab's, by the same
 * distance as the blend below (and the trick reader's), so the hand matches the name.
 */
export function nearestSpotFront(edge: number, t: number): boolean {
  let best = Infinity;
  let front = t >= 0.5;
  for (let i = 0; i < SPOTS.length; i++) {
    const s = SPOTS[i];
    if (!s) continue;
    const de = edge - s.edge;
    const dt = (t - s.t) * 2;
    const d = de * de + dt * dt;
    if (d < best) {
      best = d;
      front = s.front;
    }
  }
  return front;
}

/**
 * Written by `boardAttitude`. `roll` is 0..1 of `grab.tweakRollMax`, like the rig driver.
 * `yaw` (rad about board up) turns the whole rider and board together while the grab is
 * held — a method's back to the landing — and is judged at touchdown like a held shifty.
 */
export const attitude = { pitch: 0, roll: 0, yaw: 0 };

/**
 * Board pitch (rad, nose up) and roll for a grab at (`edge`, `t`), `grip` held, `tweak`
 * pushed. Inverse-square distance weights (Shepard) over the spots — exact on a named grab
 * and a smooth mix between, the same blend the rig uses for the body. `t` is doubled so a
 * tail-to-nose move counts as much as a heel-to-toe one. Zero grip is a flat board.
 */
export function boardAttitude(edge: number, t: number, grip: number, tweak: number, params: Params): typeof attitude {
  let total = 0;
  let pitch = 0;
  let roll = 0;
  let yaw = 0;
  const gain = 1 + params.grab.tweakGain;
  for (let i = 0; i < SPOTS.length; i++) {
    const s = SPOTS[i];
    if (!s) continue;
    const de = edge - s.edge;
    const dt = (t - s.t) * 2;
    const w = 1 / (de * de + dt * dt + 1e-9); // guard only: on the spot, that grab wins outright
    const g = params.grab;
    const bp = g[s.pitch];
    const br = g[s.roll];
    const tp = s.tweakedPitch ? g[s.tweakedPitch] : bp * gain;
    const tr = s.tweakedRoll ? g[s.tweakedRoll] : br * gain;
    pitch += w * (bp + (tp - bp) * tweak);
    roll += w * (br + (tr - br) * tweak);
    const by = g[s.yaw];
    yaw += w * (by + ((s.tweakedYaw ? g[s.tweakedYaw] : by) - by) * tweak);
    total += w;
  }
  const max = params.grab.tweakPitchMax;
  pitch = Math.max(-max, Math.min(max, (pitch / total) * grip));
  attitude.pitch = pitch;
  attitude.roll = Math.max(-1, Math.min(1, (roll / total) * grip));
  attitude.yaw = (yaw / total) * grip;
  return attitude;
}
