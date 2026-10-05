import type { CornerConfig, GradeConfig, KickerConfig, QuarterConfig, SlopeConfig } from '../sim/terrain.ts';
import { PARK_GRAVITY, REAL_GRAVITY, scalePark } from './scale.ts';
import { kickerSpan } from './sochi.ts';

/**
 * The home park off one drop-in. Left, the jump section: rows of gap jumps three lanes wide —
 * small on the left, the original line in the middle, bigger on the right — staggered so
 * lines weave and lanes can be swapped between rows, landing hills meeting so you can
 * transfer; two small rows to warm up, three big ones, then three corners abreast feeding a
 * short halfpipe in line with the middle one. Right, the rail lane on its own: three jib
 * tables and a wall. Grades are shared across the width, so the rail lane rides the jump
 * line's steps — rails are placed by height above the snow, which keeps them true on any grade.
 */
const JUMP_X = -12; // m, the jump section's middle lane
const LANE_L = -27; // m, its left lane: the smaller kickers
const LANE_R = 3; // m, its right lane: the bigger ones
// m each side-lane kicker sits off its lane, alternating row by row: lines weave. Two
// positions a lane, not more — every cut takeoff side adds a strip of fine mesh the park's length.
const NUDGE = 2.5;
const RAIL_X = 30; // m, rail lane centre
const shelf = 0.08; // rad between sections — just steeper than snow friction
const drop = 0.3; // rad, the drop-in and the run to the pipes

type Size = { lipHeight: number; deckLength: number; width: number; deckWidth: number };
const KNUCKLE = 0.5; // knuckle height over lip height
const LANDING = 0.15; // rad a landing falls below the slope it sits on, as a table landing had it
const LANDING_GRADE = 0.3; // share of the eased landing angle given back by steepening the slope under it: more is steeper landings and a faster line (1: the old angle, ~+6 km/h a kicker)
/**
 * A big-air build, as the reference elevation: no table — the lip's back drops away and the
 * landing is its own hill, a gentle rise to a knuckle about half the lip's height. A lower
 * knuckle has less to drop, which would halve the landing; so the kicker's own landing angle
 * eases until it is as long as it was (and `jump` gives some of it back as grade).
 */
function gapKicker(z: number, x: number, size: Size): KickerConfig {
  const knuckleRadius = 6;
  const runoutRadius = 20;
  const knuckleHeight = size.lipHeight * KNUCKLE;
  const arcs = (knuckleRadius + runoutRadius) * (1 - Math.cos(LANDING));
  const landingAngle = Math.atan((Math.tan(LANDING) * Math.max(0.01, knuckleHeight - arcs)) / Math.max(0.01, size.lipHeight - arcs));
  // Landing hills wide enough to meet the next lane's: a transfer lands on snow, not a gully.
  return { z, x, lipAngle: 0.6, sideTaper: 0.3, deckTaper: 4, landingAngle, knuckleRadius, runoutRadius, knuckleHeight, ...size };
}

/**
 * One row of the jump section on a stepped grade: inrun and takeoffs on `table` (flat for the
 * big ones, so friction bleeds what the last landing gave), the slope dropping to `landing`
 * under the landings, `after` beyond. The middle lane's kicker sets the grades.
 */
function jump(z: number, size: Size, landing: number, table = 0, after = shelf): { kicker: KickerConfig; grades: GradeConfig[]; end: number } {
  const kicker = gapKicker(z, JUMP_X, size);
  landing += LANDING_GRADE * (LANDING - (kicker.landingAngle ?? LANDING));
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

// Takeoffs cut square at the sides (sideTaper); landing hills 11 m across, rounding off over 4.
const SMALL = { width: 6, deckWidth: 11 };
const BIG = { width: 6, deckWidth: 11 };
// Gaps, m from one landing's end to the next kicker's transition — short, so the line flows.
const GAP_SMALL = 24;
const GAP_BUILD = 36; // after the small ones: the steeper pitch that feeds the big ones
const GAP_BIG = 28;
const GAP_CORNER = 18;
const BIG_SHELF = 0.13; // rad between the big ones: short gaps, so a steeper pitch has to rebuild the speed
const s1 = jump(-40, { ...SMALL, lipHeight: 1.2, deckLength: 3 }, 0.25, 0.1, 0.14);
const s2 = jump(s1.end - GAP_SMALL, { ...SMALL, lipHeight: 1.6, deckLength: 5 }, 0.25, 0.1, 0.14);
const buildUp = s2.end - 8; // a steeper pitch into the big ones
const b1 = jump(s2.end - GAP_BUILD, { ...BIG, lipHeight: 3, deckLength: 10 }, 0.3, 0, BIG_SHELF);
const b2 = jump(b1.end - GAP_BIG, { ...BIG, lipHeight: 3, deckLength: 10 }, 0.3, 0, BIG_SHELF);
const b3 = jump(b2.end - GAP_BIG, { ...BIG, lipHeight: 3.5, deckLength: 12.5 }, 0.3); // normal shelf after: the corner is sized for ~60 km/h

/**
 * The other two lanes of each row: a smaller kicker on the left, a bigger one on the right,
 * each nudged across from its lane so no line runs straight and the lanes can be swapped
 * between rows. Its knuckle sits on the row's knuckle, so it lands on the row's landing grade;
 * its takeoff falls wherever its own size puts it. Landing hills of neighbouring lanes meet.
 */
function laneKicker(row: { kicker: KickerConfig }, x: number, size: Size): KickerConfig {
  const k = gapKicker(0, x, size);
  const rowKnuckle = row.kicker.z - kickerSpan(row.kicker).deck;
  k.z = rowKnuckle + kickerSpan(k).deck;
  return k;
}
const LANES: KickerConfig[] = [
  laneKicker(s1, LANE_L + NUDGE, { ...SMALL, lipHeight: 0.9, deckLength: 2.6 }),
  laneKicker(s1, LANE_R - NUDGE, { ...SMALL, lipHeight: 1.5, deckLength: 3.4 }),
  laneKicker(s2, LANE_L - NUDGE, { ...SMALL, lipHeight: 1.2, deckLength: 4.4 }),
  laneKicker(s2, LANE_R + NUDGE, { ...SMALL, lipHeight: 2, deckLength: 5.4 }),
  laneKicker(b1, LANE_L + NUDGE, { ...BIG, lipHeight: 2.2, deckLength: 8.5 }),
  laneKicker(b1, LANE_R - NUDGE, { ...BIG, lipHeight: 3.4, deckLength: 8.5 }),
  laneKicker(b2, LANE_L - NUDGE, { ...BIG, lipHeight: 2.5, deckLength: 9 }),
  laneKicker(b2, LANE_R + NUDGE, { ...BIG, lipHeight: 3.6, deckLength: 8.5 }),
  laneKicker(b3, LANE_L + NUDGE, { ...BIG, lipHeight: 2.8, deckLength: 11 }),
  laneKicker(b3, LANE_R - NUDGE, { ...BIG, lipHeight: 4, deckLength: 9.5 }),
];

// Corner sized for the ~18-20 m/s the big line hands on: a short transition kicking up to a
// steep lip (49°), so the air goes up more than out; its deck runs long so the side landings
// sit beside the flight, and a straight hit still lands past it. The side landings start
// square at the lip (deckTaper), cut like the takeoff's sides.
const CORNER: Omit<CornerConfig, 'z'> = { x: JUMP_X, width: 7, lipHeight: 5, lipAngle: 0.85, deckLength: 14, deckWidth: 7, sideTaper: 0.3, deckTaper: 0.3, landingAngle: 0.5, knuckleRadius: 5, runoutRadius: 18 };
const cornerZ = b3.end - GAP_CORNER;
// Three corners abreast, one a lane, the middle one a Shredders-style hip (square deck corners,
// side landings down to the takeoff's base), the left one smaller and a little higher, the right one
// a little lower: side landings meet between them, so one corner's air can land on the next.
const CORNERS: CornerConfig[] = [
  { z: cornerZ, ...CORNER, squareCorners: true, hip: { flare: 2.5, edgeSlope: 1.7 } }, // landings reach down the takeoff's sides
  { z: cornerZ + 4, ...CORNER, x: LANE_L, lipHeight: 4, deckLength: 12 },
  { z: cornerZ - 3, ...CORNER, x: LANE_R },
];
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

const PARK_SIZED: SlopeConfig = {
  length: Math.ceil(-halfpipeEnd + 40),
  width: 220, // the banks start at 0.2 × width from the middle: ±44 m of park
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
  kickers: [s1.kicker, s2.kicker, b1.kicker, b2.kicker, b3.kicker, ...LANES, jib1, jib2, jib3],
  corners: CORNERS,
  quarters: [
    { z: halfpipeZ, x: JUMP_X - HALFPIPE_FLAT / 2, side: -1, ...WALL },
    { z: halfpipeZ, x: JUMP_X + HALFPIPE_FLAT / 2, side: 1, ...WALL },
  ],
};

/** Laid out at the old 16 m/s² scale above; ridden full size under real gravity (scale.ts). */
export const PARK: SlopeConfig = scalePark(PARK_SIZED, PARK_GRAVITY / REAL_GRAVITY);
