import type { Params } from './params.ts';

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
type Spot = { edge: number; t: number; pitch: GrabParam; roll: GrabParam; tweakedPitch?: GrabParam; tweakedRoll?: GrabParam };

const SPOTS: readonly Spot[] = [
  { edge: 1, t: 0.38, pitch: 'indyPitch', roll: 'indyRoll' },
  { edge: 1, t: 0.54, pitch: 'mutePitch', roll: 'muteRoll', tweakedPitch: 'japanPitch', tweakedRoll: 'japanRoll' },
  { edge: -1, t: 0.55, pitch: 'melonPitch', roll: 'melonRoll' },
  { edge: -1, t: 0.83, pitch: 'methodPitch', roll: 'methodRoll' },
  { edge: -1, t: 0.39, pitch: 'stalefishPitch', roll: 'stalefishRoll' },
  { edge: 1, t: 1, pitch: 'nosegrabPitch', roll: 'nosegrabRoll' },
  { edge: 1, t: 0, pitch: 'tailgrabPitch', roll: 'tailgrabRoll' },
];

/** Written by `boardAttitude`. `roll` is 0..1 of `grab.tweakRollMax`, like the rig driver. */
export const attitude = { pitch: 0, roll: 0 };

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
    total += w;
  }
  const max = params.grab.tweakPitchMax;
  pitch = Math.max(-max, Math.min(max, (pitch / total) * grip));
  attitude.pitch = pitch;
  attitude.roll = Math.max(-1, Math.min(1, (roll / total) * grip));
  return attitude;
}
