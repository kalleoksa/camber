import type { CornerConfig, GradeConfig, KickerConfig, QuarterConfig, SlopeConfig } from '../sim/terrain.ts';
import { kickerSpan } from './sochi.ts';

/**
 * The home park: two lanes off one drop-in. Left, the jump line — two small kickers to warm
 * up, three big ones, then a corner feeding a short halfpipe — a wall in line with each of its
 * side landings, so whichever side you land on runs into one, then across to the other.
 * Right, the rail lane on its own: three jib tables and a wall. Grades are shared across the width, so the rail lane rides the jump
 * line's steps — rails are placed by height above the snow, which keeps them true on any grade.
 */
export const JUMP_X = -12; // m, jump line centre — also where a run starts (main.ts)
const RAIL_X = 14; // m, rail lane centre
const shelf = 0.08; // rad between sections — just steeper than snow friction
const drop = 0.3; // rad, the drop-in and the run to the pipes

type Size = { lipHeight: number; deckLength: number; width: number; deckWidth: number };
/**
 * One kicker on a stepped section: inrun and table on `table` (flat for the big ones, so friction
 * bleeds what the last landing gave), the slope dropping to `landing` under it, `after` beyond.
 */
function jump(z: number, size: Size, landing: number, table = 0, after = shelf): { kicker: KickerConfig; grades: GradeConfig[]; end: number } {
  const kicker: KickerConfig = { z, x: JUMP_X, lipAngle: 0.5, sideTaper: 2, landingAngle: 0.15, knuckleRadius: 6, runoutRadius: 20, ...size };
  const sp = kickerSpan(kicker);
  return {
    kicker,
    grades: [
      { z: z + 10, pitch: table, blend: 8 },
      { z: z - sp.deck, pitch: landing, blend: 6 },
      { z: z - sp.end, pitch: after, blend: 10 },
    ],
    end: z - sp.end,
  };
}

const SMALL = { width: 5, deckWidth: 6 };
const BIG = { width: 5, deckWidth: 8 };
// Gaps, m from one landing's end to the next kicker's transition — short, so the line flows.
const GAP_SMALL = 14;
const GAP_BUILD = 36; // after the small ones: the steeper pitch that feeds the big ones
const GAP_BIG = 18;
const GAP_CORNER = 18;
const BIG_SHELF = 0.13; // rad between the big ones: short gaps, so a steeper pitch has to rebuild the speed
const s1 = jump(-40, { ...SMALL, lipHeight: 1.2, deckLength: 3 }, 0.25, 0.1, 0.14);
const s2 = jump(s1.end - GAP_SMALL, { ...SMALL, lipHeight: 1.6, deckLength: 5 }, 0.25, 0.1, 0.14);
const buildUp = s2.end - 8; // a steeper pitch into the big ones
const b1 = jump(s2.end - GAP_BUILD, { ...BIG, lipHeight: 3, deckLength: 10 }, 0.3, 0, BIG_SHELF);
const b2 = jump(b1.end - GAP_BIG, { ...BIG, lipHeight: 3, deckLength: 10 }, 0.3, 0, BIG_SHELF);
const b3 = jump(b2.end - GAP_BIG, { ...BIG, lipHeight: 3.5, deckLength: 12.5 }, 0.3); // normal shelf after: the corner is sized for ~60 km/h

// Corner sized for the ~18-20 m/s the big line hands on; its deck runs long so the side
// landings sit beside the flight, not behind it.
const CORNER: Omit<CornerConfig, 'z'> = { x: JUMP_X, width: 8, lipHeight: 5, lipAngle: 0.45, deckLength: 24, deckWidth: 4, sideTaper: 3, landingAngle: 0.5, knuckleRadius: 5, runoutRadius: 18 };
const cornerZ = b3.end - GAP_CORNER;
const cornerRunIn = (CORNER.lipHeight / (1 - Math.cos(CORNER.lipAngle))) * Math.sin(CORNER.lipAngle);
const cornerEnd = cornerZ - cornerRunIn - CORNER.deckLength - 15; // its landings back on the slope
// Below the corner, a short halfpipe: two quarter pipes facing each other across a flat
// bottom, each in line with one of the corner's side landings, close enough to carve across
// from one to the other. Walls fade in at the uphill end, so a landing rolls in.
const HALFPIPE_FLAT = 14; // m of flat bottom between the transitions: the landings run out inside it
const HALFPIPE_LENGTH = 50; // m down the fall line
const HALFPIPE_DROP = 14; // m of steeper drop-in from the landings to the pipe: speed for the walls
const halfpipeTop = cornerEnd - HALFPIPE_DROP;
const WALL: Omit<QuarterConfig, 'z' | 'x' | 'side'> = { width: HALFPIPE_LENGTH, height: 3.5, angle: 1.45, radius: 3.2, deck: 3, sideTaper: 8, backAngle: 0.35 };
const halfpipeZ = halfpipeTop - HALFPIPE_LENGTH / 2;
const halfpipeEnd = halfpipeTop - HALFPIPE_LENGTH;

// Rail lane: jib tables as in the Sochi plans, a gentle lip the width of the lane, a flat deck
// the rails sit on, a landing off the end.
const jibLip = { lipHeight: 1.5, lipAngle: 0.4, width: 14, deckWidth: 14, sideTaper: 3, landingAngle: 0.35, knuckleRadius: 10, runoutRadius: 10 };
const jibRunIn = (jibLip.lipHeight / (1 - Math.cos(jibLip.lipAngle))) * Math.sin(jibLip.lipAngle);
const jibTable = (z: number): KickerConfig => ({ ...jibLip, z, x: RAIL_X, deckLength: 20 });
type Point = [number, number, number];
/** A point on a jib table's deck: `x` across from the lane centre, `a` m past the lip, `h` above. */
const pt = (table: KickerConfig, x: number, a: number, h: number): Point => [RAIL_X + x, h, table.z - jibRunIn - a];
const jib1 = jibTable(-28);
const jib2 = jibTable(-80);
const jib3 = jibTable(-134);

export const PARK: SlopeConfig = {
  length: Math.ceil(-halfpipeEnd + 40),
  width: 140,
  pitch: drop,
  grades: [
    { z: -14, pitch: 0.1, blend: 8 },
    ...s1.grades,
    ...s2.grades,
    { z: buildUp, pitch: 0.24, blend: 6 },
    ...b1.grades,
    ...b2.grades,
    ...b3.grades,
    { z: cornerEnd, pitch: drop, blend: 6 }, // drop-in
    { z: halfpipeTop - 6, pitch: 0.28, blend: 8 }, // the halfpipe's fall line — about a real pipe's 17°
    { z: halfpipeEnd - 4, pitch: 0.1, blend: 8 }, // run-out
  ],
  rails: [
    // Jib 1: ride-on box, kinked rail, flat rail, curved box.
    { points: [pt(jib1, -5.5, 2, 0.08), pt(jib1, -5.5, 18, 0.08)], width: 0.5 },
    { points: [pt(jib1, -2, 2, 0.35), pt(jib1, -2, 9, 0.7), pt(jib1, -2, 18, 0.7)] },
    { points: [pt(jib1, 2, 3, 0.5), pt(jib1, 2, 18, 0.5)] },
    { points: [pt(jib1, 5.5, 2, 0.25), pt(jib1, 6, 8, 0.25), pt(jib1, 6.3, 13, 0.25), pt(jib1, 6, 18, 0.25)], width: 0.5 },
    // Jib 2: down rail, box, rainbow — the wall on the outside.
    { points: [pt(jib2, -4, 2, 0.5), pt(jib2, -4, 18, 0.5)] },
    { points: [pt(jib2, 0, 2, 0.25), pt(jib2, 0, 16, 0.25)], width: 0.6 },
    { points: [pt(jib2, 4, 2, 0.35), pt(jib2, 4, 8, 0.9), pt(jib2, 4, 13, 0.9), pt(jib2, 4, 18, 0.35)] },
    // Jib 3: long flat-down rail, wide box.
    { points: [pt(jib3, 2, 2, 0.4), pt(jib3, 2, 9, 0.9), pt(jib3, 2, 18, 0.9)] },
    { points: [pt(jib3, -3, 2, 0.25), pt(jib3, -3, 18, 0.25)], width: 0.8 },
  ],
  walls: [{ x: RAIL_X + 9, side: 1, z: -100, length: 16, height: 3, angle: 1.35, radius: 1.2, top: 1, taper: 2 }],
  kickers: [s1.kicker, s2.kicker, b1.kicker, b2.kicker, b3.kicker, jib1, jib2, jib3],
  corners: [{ z: cornerZ, ...CORNER }],
  quarters: [
    { z: halfpipeZ, x: JUMP_X - HALFPIPE_FLAT / 2, side: -1, ...WALL },
    { z: halfpipeZ, x: JUMP_X + HALFPIPE_FLAT / 2, side: 1, ...WALL },
  ],
};
