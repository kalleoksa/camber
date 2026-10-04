import { GRABS as SIM_GRABS } from '../sim/grabs.ts';
import type { Params } from '../sim/params.ts';
import type { Quat } from '../sim/quat.ts';
import { butterAmount } from '../sim/states/grounded.ts';
import type { RiderState } from '../sim/state.ts';
import { ANCHORS } from './poses.ts';

/**
 * Names what the rider did, from sim state, one tick at a time. Read-only: nothing here
 * reaches the sim, so it can't touch determinism, and the same reader runs headless in
 * scripts/notes.ts. No score — names and whether it was landed, nothing else.
 *
 * Airs: spin is the board's actual rotation about world up, rounded to 180s; frontside
 * when the chest opens toward the direction of travel (positive about board up riding
 * nose first, negative riding switch). Flips are rotation about the board's width —
 * negative is a backflip riding regular, positive riding switch. Both at once is a cork. The grab is the
 * one held longest, named by the nearest grab pose. A flip with spin is a cork when the spin
 * leads, a rodeo when a backflip does, a misty when a frontflip does.
 *
 * Rails: the slide held longest; across the rail travelling toward the heels is frontside
 * (blind), toward the toes backside. Which end of the board crossed the rail getting on
 * splits a boardslide (nose over) from a lipslide (tail over), and an end slide from its
 * blunt (the board already over the rail). A touch too short to slide is a bonk. A rail
 * isn't named until the rider is back on snow, so the air off it names the spin out
 * ("270 out"), and catching another rail on the way makes a transfer ("… to 50-50").
 */
export type TrickResult = 'clean' | 'sketchy' | 'tried' | 'done';
export type TrickEvent = { tick: number; name: string; result: TrickResult };

export function describe(e: TrickEvent): string {
  return e.result === 'done' ? e.name : `${e.name} — ${e.result}`;
}

/** Grab poses and the board point their gripping hand goes to, from the anchors. */
const GRABS = ['indy', 'mute', 'melon', 'method', 'stalefish', 'japan', 'nosegrab', 'tailgrab'].flatMap((name) => {
  const a = ANCHORS[name];
  if (!a) return [];
  const front = a.frontGrip > a.backGrip;
  return [{ name, edge: front ? a.frontHandEdge : a.backHandEdge, t: front ? a.frontHandT : a.backHandT }];
});

/** Display names for the sim's grab table (GRABS in sim/grabs.ts). */
const GRAB_LABELS = SIM_GRABS.map((g) => g.name.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`));

function nearestGrab(edge: number, t: number): string {
  let best = '';
  let dist = Infinity;
  for (const g of GRABS) {
    const d = ((edge - g.edge) / 2) ** 2 + (t - g.t) ** 2;
    if (d < dist) {
      dist = d;
      best = g.name;
    }
  }
  return best;
}

type RailKind = '50-50' | 'nose press' | 'tail press' | 'boardslide' | 'lipslide' | 'noseslide' | 'tailslide' | 'nose blunt' | 'blunt';

const MIN_AIR = 0.35; // s — shorter than this with nothing done is a hop, not a trick
const MIN_RAIL = 0.25; // s on a rail before it counts
const MIN_WALL = 0.3; // s on a wall before it counts
const MIN_GRAB = 0.12; // s of hold before a grab counts
const BUTTER_ON = 0.2; // butter amount (0..1) that counts as up on an end
const BUTTER_GAP = 0.15; // s off an end before the butter is over
const MIN_BUTTER = (135 * Math.PI) / 180; // rad of pivot before it is a butter 180

export type TrickReader = {
  /** Call after each sim tick. Returns a trick the moment one finishes. */
  step(state: RiderState, dt: number, params: Params): TrickEvent | null;
  reset(): void;
};

export function createTrickReader(): TrickReader {
  let prevMode = '';
  const prevQ: Quat = { x: 0, y: 0, z: 0, w: 1 };
  // Air.
  let airTime = 0;
  let spin = 0; // rad about world up, signed
  let flip = 0; // rad about the board's width, signed
  let switchAtTakeoff = false;
  const grabTime = new Map<string, number>();
  let maxTweak = 0;
  // Rail.
  let railTime = 0;
  const railTally = new Map<string, number>();
  let railSwitch = false;
  const entryV = { x: 0, z: 0 }; // velocity on the last tick before the rail, for `crossing`
  let pendingRail = ''; // a rail trick ridden off into the air: named when the air ends
  // Butter: rotation about up while on an end of the board, on the snow.
  let butterSpin = 0;
  let butterOff = 0;
  let butterOn = false;
  let butterSwitch = false;
  let butterNose = true;
  // Wall.
  let wallTime = 0;
  let pendingOn = ''; // an air that landed on a rail: its name prefixes the rail trick

  function startAir(state: RiderState): void {
    airTime = 0;
    spin = 0;
    flip = 0;
    switchAtTakeoff = state.switchRide;
    grabTime.clear();
    maxTweak = 0;
  }

  function airName(): string {
    const spinDeg = (Math.abs(spin) * 180) / Math.PI;
    const turns = spinDeg >= 120 ? Math.round(spinDeg / 180) * 180 : 0;
    const flips = Math.round(Math.abs(flip) / (2 * Math.PI) + 0.08);
    const side = (spin > 0) !== switchAtTakeoff ? 'fs' : 'bs';
    const parts: string[] = [];
    if (switchAtTakeoff) parts.push('switch');
    const times = flips > 1 ? `${flips === 2 ? 'double' : 'triple'} ` : '';
    if (flips > 0 && turns >= 180) {
      // Off axis: the larger rotation leads. Spin-led is a cork whichever way the flip goes;
      // flip-led is a rodeo off a backflip, a misty off a frontflip.
      const kind = Math.abs(spin) >= Math.abs(flip) ? 'cork' : (flip < 0) !== switchAtTakeoff ? 'rodeo' : 'misty';
      parts.push(`${side} ${times}${kind} ${turns}`);
    }
    // Riding switch the tail leads, so a backflip is the other way about the board's width.
    else if (flips > 0) parts.push(`${times}${(flip < 0) !== switchAtTakeoff ? 'backflip' : 'frontflip'}`);
    else if (turns > 0) parts.push(`${side} ${turns}`);
    let grab = '';
    let held = MIN_GRAB;
    for (const [name, time] of grabTime) {
      if (time > held) {
        held = time;
        grab = name;
      }
    }
    // A mute shoved out all the way is a japan, its own name rather than "tweaked mute".
    if (grab) parts.push(maxTweak > 0.6 ? (grab === 'mute' ? 'japan' : `tweaked ${grab}`) : grab);
    if (parts.length === 0 || (parts.length === 1 && switchAtTakeoff)) {
      return airTime > 0.8 ? `${switchAtTakeoff ? 'switch ' : ''}straight air` : '';
    }
    return parts.join(' ');
  }

  function railName(): string {
    if (railTime < MIN_RAIL) return 'bonk';
    let kind = '';
    let most = 0;
    for (const [k, time] of railTally) {
      if (time > most) {
        most = time;
        kind = k;
      }
    }
    return `${railSwitch ? 'switch ' : ''}${kind}`;
  }

  /** The air off a rail, as a spin out: nearest 90°, since a slide leaves the board across. */
  function spinOut(): string {
    const deg = (Math.abs(spin) * 180) / Math.PI;
    return deg >= 60 ? `${Math.round(deg / 90) * 90} out` : '';
  }

  return {
    reset() {
      prevMode = '';
      butterOn = false;
      pendingOn = '';
      pendingRail = '';
      railTally.clear();
      grabTime.clear();
    },

    step(state, dt, params) {
      const mode = state.mode;
      const q = state.spinFrame;
      let event: TrickEvent | null = null;

      // A butter: up on the nose or tail and pivoting. Named once off the end (or off the
      // snow) if it came round 180 or more; fs/bs as for an air.
      const v = state.velocity;
      const up = mode === 'grounded' ? butterAmount(state.stance, Math.hypot(v.x, v.y, v.z), params) > BUTTER_ON : false;
      if (up) {
        if (!butterOn) {
          butterOn = true;
          butterSpin = 0;
          butterSwitch = state.switchRide;
          butterNose = state.stance > 0;
        }
        butterOff = 0;
        // World-up rotation this tick, as for the air below.
        butterSpin += 2 * (q.w * -prevQ.y - q.x * -prevQ.z + q.y * prevQ.w + q.z * -prevQ.x) * (q.w * prevQ.w + q.x * prevQ.x + q.y * prevQ.y + q.z * prevQ.z < 0 ? -1 : 1);
      } else if (butterOn) {
        butterOff += dt;
        if (butterOff > BUTTER_GAP || mode !== 'grounded') {
          butterOn = false;
          if (Math.abs(butterSpin) >= MIN_BUTTER) {
            const turns = Math.round((Math.abs(butterSpin) * 180) / Math.PI / 180) * 180;
            const side = (butterSpin > 0) !== butterSwitch ? 'fs' : 'bs';
            const name = `${butterSwitch ? 'switch ' : ''}${side} ${butterNose ? 'nose' : 'tail'} butter ${turns}`;
            event = { tick: state.tick, name, result: mode === 'bailed' ? 'tried' : 'done' };
          }
        }
      }

      if (mode === 'airborne') {
        if (prevMode !== 'airborne') startAir(state);
        airTime += dt;
        // Rotation this tick, dq = q · prev⁻¹ in world frame for the spin, and
        // prev⁻¹ · q in board frame for the flip.
        const ix = -prevQ.x;
        const iy = -prevQ.y;
        const iz = -prevQ.z;
        const iw = prevQ.w;
        const wy = q.w * iy - q.x * iz + q.y * iw + q.z * ix;
        const ww = q.w * iw - q.x * ix - q.y * iy - q.z * iz;
        const lx = iw * q.x + ix * q.w + iy * q.z - iz * q.y;
        const lw = iw * q.w - ix * q.x - iy * q.y - iz * q.z;
        const sw = ww < 0 ? -1 : 1; // shortest way round
        const sl = lw < 0 ? -1 : 1;
        spin += 2 * sw * wy; // small-angle: angle·axis ≈ 2·vector part
        flip += 2 * sl * lx;
        if (state.grip > 0.8) {
          // Stick model 2 names its grab outright; before it, the nearest pose to the hand.
          const name = state.grabId >= 0 ? (GRAB_LABELS[state.grabId] ?? '') : nearestGrab(state.grabEdge, state.grabT);
          grabTime.set(name, (grabTime.get(name) ?? 0) + dt);
          if (state.tweak > maxTweak) maxTweak = state.tweak;
        }
      } else if (prevMode === 'airborne') {
        const name = airName();
        if (pendingRail) {
          // Off a rail: onto another is a transfer, onto snow names the spin out.
          if (mode === 'railed') {
            const on = name && name !== 'straight air' ? ` ${name} on` : '';
            pendingOn = `${pendingRail} to${on}`;
          } else {
            const out = spinOut();
            const result: TrickResult =
              mode === 'bailed' ? 'tried' : state.landing === 'clean' ? 'clean' : state.landing === 'sketchy' ? 'sketchy' : 'done';
            event = { tick: state.tick, name: out ? `${pendingRail} ${out}` : pendingRail, result };
          }
          pendingRail = '';
        } else if (mode === 'railed') pendingOn = name && name !== 'straight air' ? `${name} on` : '';
        else if (name || mode === 'bailed') {
          if (airTime >= MIN_AIR || name) {
            const result: TrickResult =
              mode === 'bailed' ? 'tried' : state.landing === 'clean' ? 'clean' : state.landing === 'sketchy' ? 'sketchy' : 'done';
            event = { tick: state.tick, name: name || 'air', result };
          }
        }
      }

      if (mode === 'railed') {
        if (prevMode !== 'railed') {
          railTime = 0;
          railTally.clear();
          railSwitch = state.switchRide;
        }
        railTime += dt;
        const across = Math.abs(Math.sin(state.slide));
        const c = state.railContact;
        const end = c > 0.3 ? 'nose' : c < -0.3 ? 'tail' : '';
        let kind: RailKind | '' = '';
        if (across < 0.35) kind = end === 'nose' ? 'nose press' : end === 'tail' ? 'tail press' : '50-50';
        else if (across > 0.7) {
          // Which end points the way you were crossing: that end went over the rail first.
          // Nose over is a boardslide, tail over a lipslide; on an end, the end that reached
          // the rail is a nose/tailslide, the board already past it is the blunt.
          // On the rail you travel along it, so the velocity is its line; the velocity frozen
          // just before the catch says which way across it you were moving. Too square to the
          // line to tell either: call it nose over.
          const v = state.velocity;
          const along = Math.hypot(v.x, v.z);
          const cross = along > 1e-6 ? (v.x * entryV.z - v.z * entryV.x) / along : 0;
          const crossing = Math.abs(cross) < 0.3 ? 0 : Math.sign(cross);
          const noseSide = along > 1e-6 ? Math.sign(v.x * Math.cos(state.heading) - v.z * Math.sin(state.heading)) : 0;
          const noseOver = crossing === 0 || noseSide === 0 || noseSide === crossing;
          if (end === 'nose') kind = noseOver ? 'noseslide' : 'nose blunt';
          else if (end === 'tail') kind = noseOver ? 'blunt' : 'tailslide';
          else kind = noseOver ? 'boardslide' : 'lipslide';
        }
        if (kind) {
          // Across the rail: travelling toward the heels is frontside (your convention).
          const side = across > 0.7 ? (Math.sin(state.slide) > 0 ? 'fs ' : 'bs ') : '';
          const key = side + kind;
          railTally.set(key, (railTally.get(key) ?? 0) + dt);
        }
      } else if (prevMode === 'railed') {
        const name = pendingOn ? `${pendingOn} ${railName()}` : railName();
        // Off into the air (the usual way off a rail): wait for the landing to name the
        // spin out and judge it. Straight onto snow or down: name it now.
        if (mode === 'airborne') pendingRail = name;
        else event = { tick: state.tick, name, result: mode === 'bailed' ? 'tried' : 'done' };
        pendingOn = '';
      }

      if (mode === 'walled') {
        if (prevMode !== 'walled') wallTime = 0;
        wallTime += dt;
      } else if (prevMode === 'walled' && wallTime >= MIN_WALL && !event) {
        event = { tick: state.tick, name: 'wallride', result: mode === 'bailed' ? 'tried' : 'done' };
      }

      if (mode !== 'railed') {
        entryV.x = state.velocity.x;
        entryV.z = state.velocity.z;
      }
      prevMode = mode;
      prevQ.x = q.x;
      prevQ.y = q.y;
      prevQ.z = q.z;
      prevQ.w = q.w;
      return event;
    },
  };
}
