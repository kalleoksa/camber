import type { Quat } from '../sim/quat.ts';
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
 * one held longest, named by the nearest grab pose. Rails: the slide held longest; across
 * the rail travelling toward the heels is frontside (blind), toward the toes backside.
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

type RailKind = '50-50' | 'nose press' | 'tail press' | 'boardslide' | 'noseslide' | 'tailslide';

const MIN_AIR = 0.35; // s — shorter than this with nothing done is a hop, not a trick
const MIN_RAIL = 0.25; // s on a rail before it counts
const MIN_WALL = 0.3; // s on a wall before it counts
const MIN_GRAB = 0.12; // s of hold before a grab counts

export type TrickReader = {
  /** Call after each sim tick. Returns a trick the moment one finishes. */
  step(state: RiderState, dt: number): TrickEvent | null;
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
    if (flips > 0 && turns >= 180) parts.push(`${side} ${flips > 1 ? `${flips === 2 ? 'double' : 'triple'} ` : ''}cork ${turns}`);
    // Riding switch the tail leads, so a backflip is the other way about the board's width.
    else if (flips > 0) parts.push(`${flips > 1 ? `${flips === 2 ? 'double' : 'triple'} ` : ''}${(flip < 0) !== switchAtTakeoff ? 'backflip' : 'frontflip'}`);
    else if (turns > 0) parts.push(`${side} ${turns}`);
    let grab = '';
    let held = MIN_GRAB;
    for (const [name, time] of grabTime) {
      if (time > held) {
        held = time;
        grab = name;
      }
    }
    if (grab) parts.push(maxTweak > 0.6 ? `tweaked ${grab}` : grab);
    if (parts.length === 0 || (parts.length === 1 && switchAtTakeoff)) {
      return airTime > 0.8 ? `${switchAtTakeoff ? 'switch ' : ''}straight air` : '';
    }
    return parts.join(' ');
  }

  function railName(): string {
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

  return {
    reset() {
      prevMode = '';
      pendingOn = '';
      railTally.clear();
      grabTime.clear();
    },

    step(state, dt) {
      const mode = state.mode;
      const q = state.spinFrame;
      let event: TrickEvent | null = null;

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
          const name = nearestGrab(state.grabEdge, state.grabT);
          grabTime.set(name, (grabTime.get(name) ?? 0) + dt);
          if (state.tweak > maxTweak) maxTweak = state.tweak;
        }
      } else if (prevMode === 'airborne') {
        const name = airName();
        if (mode === 'railed') pendingOn = name && name !== 'straight air' ? `${name} on` : '';
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
        else if (across > 0.7) kind = end === 'nose' ? 'noseslide' : end === 'tail' ? 'tailslide' : 'boardslide';
        if (kind) {
          // Across the rail: travelling toward the heels is frontside (your convention).
          const side = across > 0.7 ? (Math.sin(state.slide) > 0 ? 'fs ' : 'bs ') : '';
          const key = side + kind;
          railTally.set(key, (railTally.get(key) ?? 0) + dt);
        }
      } else if (prevMode === 'railed') {
        const bailed = mode === 'bailed';
        if (railTime >= MIN_RAIL || bailed) {
          const name = railName();
          event = { tick: state.tick, name: pendingOn ? `${pendingOn} ${name}` : name, result: bailed ? 'tried' : 'done' };
        }
        pendingOn = '';
      }

      if (mode === 'walled') {
        if (prevMode !== 'walled') wallTime = 0;
        wallTime += dt;
      } else if (prevMode === 'walled' && wallTime >= MIN_WALL && !event) {
        event = { tick: state.tick, name: 'wallride', result: mode === 'bailed' ? 'tried' : 'done' };
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
