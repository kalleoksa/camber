import type { GradeConfig, KickerConfig, SlopeConfig } from '../sim/terrain.ts';

/**
 * The Sochi 2014 Olympic slopestyle course (FIS plans, Aug 2013: 635 m long, 151 m drop,
 * three jib sections then three twin kickers of 15/18, 15/18 and 19/22 m tables), scaled
 * by 9.81/16 = 0.61. The sim's gravity is 16 m/s², and v² = 2gh means shrinking every
 * length by g_real/g_sim keeps every speed the same: the course rides at Olympic speeds,
 * just shorter in time and space. Layout from the published renders — rails and boxes are
 * a reading of them, not surveyed. Stepped profile: each feature sits on a shelf, with the
 * drops between. Below the course, the corner and quarter pipe from the first park.
 */
const shelf = 0.08; // rad, the shelves the jib features sit on — just steeper than snow friction
const drop = 0.3; // rad, the drop-in
const jibShelf = 0.16; // rad, the jib sections — steep enough to carry ~11 m/s onto the rails
const jibDrop = 0.16; // rad, between them — the same pitch: the tables are the steps
const table = 0; // rad under a kicker's inrun and table — flat, so friction bleeds what the last landing gave
const landing = 0.3; // rad the slope falls under a kicker's landing; the kicker adds its own 0.15

/** Where a park kicker's deck ends and its landing ends, in m past the start of its transition. */
function kickerSpan(k: KickerConfig): { deck: number; end: number } {
  const r = k.lipHeight / (1 - Math.cos(k.lipAngle));
  const a = k.landingAngle ?? 0;
  const rk = k.knuckleRadius ?? 0;
  const rb = k.runoutRadius ?? 0;
  const deck = r * Math.sin(k.lipAngle) + k.deckLength;
  const straight = Math.max(0, k.lipHeight - rk * (1 - Math.cos(a)) - rb * (1 - Math.cos(a))) / Math.tan(a);
  return { deck, end: deck + rk * Math.sin(a) + straight + rb * Math.sin(a) };
}

/**
 * Twin kickers, a smaller "sister" beside each big one as in the plans, on a stepped
 * section: flat inrun and table, then the slope itself drops away under the landing. The
 * kicker's own landing is shallow (0.15) on top of that drop, so the two together make a
 * long ~0.45 rad landing — about 26°, where real park landings sit — instead of a short
 * steep ramp back onto a flat.
 */
type Size = { lipHeight: number; deckLength: number };
function kickerSection(z: number, small: Size, big: Size): { kickers: KickerConfig[]; grades: GradeConfig[]; end: number } {
  const base = { z, width: 4, deckWidth: 7, lipAngle: 0.5, sideTaper: 2, landingAngle: 0.15, knuckleRadius: 6, runoutRadius: 20 };
  const kickers: KickerConfig[] = [
    { ...base, x: -4.5, ...small },
    { ...base, x: 4.5, ...big },
  ];
  const spans = kickers.map(kickerSpan);
  const deck = Math.min(...spans.map((sp) => sp.deck));
  const end = Math.max(...spans.map((sp) => sp.end));
  return {
    kickers,
    grades: [
      { z: z + 10, pitch: table, blend: 8 },
      { z: z - deck, pitch: landing, blend: 6 },
      { z: z - end, pitch: shelf, blend: 10 },
    ],
    end: z - end,
  };
}

// Table lengths from the plans, scaled: 15/18, 15/18 and 19/22 m become ~9/11 and ~11.5/13.5.
/**
 * A jib table, as the plans build every jib section: a small, gentle kicker the whole width
 * of the row, a flat deck the rails and boxes sit on, and a landing off the far end. Pop
 * off the lip and come down onto a feature, or ride the box straight off it. `on` places a
 * feature on the deck: from `a` to `b` m past the lip, `h` above the deck at each end.
 */
const jibLip = { lipHeight: 1.5, lipAngle: 0.4, width: 18, deckWidth: 18, sideTaper: 3, landingAngle: 0.45, knuckleRadius: 4, runoutRadius: 12 };
const jibRunIn = (jibLip.lipHeight / (1 - Math.cos(jibLip.lipAngle))) * Math.sin(jibLip.lipAngle);
function jibTable(z: number, deckLength: number): KickerConfig {
  return { ...jibLip, z, x: 0, deckLength };
}
type Point = [number, number, number];
/** A point on a jib table's deck: `x` across, `a` m past the lip, `h` above the deck. */
function pt(table: KickerConfig, x: number, a: number, h: number): Point {
  return [x, h, table.z - jibRunIn - a];
}
const jib1 = jibTable(-28, 20);
const jib2 = jibTable(-80, 20);
const jib3 = jibTable(-134, 20);

const k1 = kickerSection(-208, { lipHeight: 2.5, deckLength: 8 }, { lipHeight: 3, deckLength: 10 });
const k2 = kickerSection(k1.end - 28, { lipHeight: 2.5, deckLength: 8 }, { lipHeight: 3, deckLength: 10 });
const k3 = kickerSection(k2.end - 28, { lipHeight: 3, deckLength: 10.5 }, { lipHeight: 3.5, deckLength: 12.5 });
const cornerZ = k3.end - 25;
const quarterZ = cornerZ - 55;

export const SOCHI: SlopeConfig = {
  length: Math.ceil(-quarterZ + 40),
  width: 60,
  pitch: drop,
  grades: [
    // Drop-in, then shelves with short drops between the jib sections, then three stepped
    // kicker sections.
    // The jib sections on a steeper pitch, so the tables are hit with speed.
    { z: -12, pitch: jibShelf, blend: 8 }, // jib 1
    { z: -66, pitch: jibDrop, blend: 6 },
    { z: -74, pitch: jibShelf, blend: 6 }, // jib 2
    { z: -120, pitch: jibDrop, blend: 6 },
    { z: -128, pitch: jibShelf, blend: 6 }, // jib 3
    // The drop into the kicker line, sized for the line through the rails, which carries
    // more speed than airing the tables. A faster line still lands, long and hard; speed
    // check (LT) for the sweet spot.
    { z: -170, pitch: 0.2, blend: 6 },
    ...k1.grades,
    ...k2.grades,
    ...k3.grades,
  ],
  rails: [
    // Jib 1: ride-on down box, kinked rail, flat rail, curved box — all on one table.
    { points: [pt(jib1, -8, 2.0, 0.08), pt(jib1, -8, 18, 0.08)], width: 0.5 }, // ride-on: low enough to roll onto
    { points: [pt(jib1, -3, 2.0, 0.35), pt(jib1, -3, 9, 0.7), pt(jib1, -3, 18, 0.7)] },
    { points: [pt(jib1, 3, 3.0, 0.5), pt(jib1, 3, 18, 0.5)] },
    { points: [pt(jib1, 8, 2.0, 0.25), pt(jib1, 9, 8, 0.25), pt(jib1, 9.3, 13, 0.25), pt(jib1, 9, 18, 0.25)], width: 0.5 },
    // Jib 2: down rail, box, rainbow — the wall on the left.
    { points: [pt(jib2, -3, 2.0, 0.5), pt(jib2, -3, 18, 0.5)] },
    { points: [pt(jib2, 3, 2.0, 0.25), pt(jib2, 3, 16, 0.25)], width: 0.6 },
    { points: [pt(jib2, 8, 2.0, 0.35), pt(jib2, 8, 8, 0.9), pt(jib2, 8, 13, 0.9), pt(jib2, 8, 18, 0.35)] },
    // Jib 3: long flat-down rail, wide box — the wall on the right.
    { points: [pt(jib3, 0, 2.0, 0.4), pt(jib3, 0, 9, 0.9), pt(jib3, 0, 18, 0.9)] },
    { points: [pt(jib3, -6, 2.0, 0.25), pt(jib3, -6, 18, 0.25)], width: 0.8 },
  ],
  walls: [
    { x: -10, side: -1, z: -88, length: 14, height: 2.5, angle: 1.35, radius: 1, top: 1, taper: 2 },
    { x: 10, side: 1, z: -144, length: 16, height: 3, angle: 1.35, radius: 1.2, top: 1, taper: 2 },
  ],
  kickers: [jib1, jib2, jib3, ...k1.kickers, ...k2.kickers, ...k3.kickers],
  corners: [
    { z: cornerZ, x: 0, width: 6, lipHeight: 3.5, lipAngle: 0.45, deckLength: 12, deckWidth: 3, sideTaper: 3, landingAngle: 0.45, knuckleRadius: 3, runoutRadius: 14 },
  ],
  quarters: [{ z: quarterZ, x: 0, width: 16, height: 3.5, angle: 1.45, radius: 3, deck: 3, sideTaper: 3 }],
};
