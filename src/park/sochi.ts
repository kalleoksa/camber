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
const drop = 0.3; // rad, between the jib sections
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
const k1 = kickerSection(-195, { lipHeight: 2.5, deckLength: 8 }, { lipHeight: 3, deckLength: 10 });
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
    { z: -24, pitch: shelf, blend: 8 }, // jib 1
    { z: -66, pitch: drop, blend: 6 },
    { z: -76, pitch: shelf, blend: 6 }, // jib 2
    { z: -120, pitch: drop, blend: 6 },
    { z: -130, pitch: shelf, blend: 6 }, // jib 3
    ...k1.grades,
    ...k2.grades,
    ...k3.grades,
  ],
  rails: [
    // Jib 1: down box, kinked rail, flat rail, curved box.
    { points: [[-8, 0.2, -37], [-8, 0.2, -50]], width: 0.5 },
    { points: [[-3, 0.25, -38], [-3, 0.6, -44], [-3, 0.6, -53]] },
    { points: [[3, 0.3, -38], [3, 0.3, -52]] },
    { points: [[8, 0.2, -37], [9, 0.2, -42], [9.3, 0.2, -47], [9, 0.2, -52]], width: 0.5 },
    // Jib 2: down rail, box, rainbow — the wall on the left.
    { points: [[-3, 0.4, -90], [-3, 0.4, -104]] },
    { points: [[3, 0.25, -90], [3, 0.25, -100]], width: 0.6 },
    { points: [[8, 0.3, -90], [8, 0.9, -95], [8, 0.9, -99], [8, 0.3, -104]] },
    // Jib 3: long flat-down rail, wide box — the wall on the right.
    { points: [[0, 0.3, -146], [0, 0.9, -154], [0, 0.9, -166]] },
    { points: [[-6, 0.25, -148], [-6, 0.25, -162]], width: 0.8 },
  ],
  walls: [
    { x: -10, side: -1, z: -88, length: 14, height: 2.5, angle: 1.35, radius: 1, top: 1, taper: 2 },
    { x: 10, side: 1, z: -144, length: 16, height: 3, angle: 1.35, radius: 1.2, top: 1, taper: 2 },
  ],
  kickers: [...k1.kickers, ...k2.kickers, ...k3.kickers],
  corners: [
    { z: cornerZ, x: 0, width: 6, lipHeight: 3.5, lipAngle: 0.45, deckLength: 12, deckWidth: 3, sideTaper: 3, landingAngle: 0.45, knuckleRadius: 3, runoutRadius: 14 },
  ],
  quarters: [{ z: quarterZ, x: 0, width: 16, height: 3.5, angle: 1.45, radius: 3, deck: 3, sideTaper: 3 }],
};
