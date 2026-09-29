import type { SlopeConfig } from '../sim/terrain.ts';

/**
 * A small slopestyle line: a steep drop-in, two rails side by side, a wall on the right,
 * a medium and a big kicker, a last rail, a corner with landings both sides, and a
 * quarter pipe at the bottom. Near-flat decks between features hold speed
 * so each one is hit at a speed it was sized for; a steep pitch before the big kicker
 * builds what it needs. Hand-placed terrain data until milestone 7 turns it into park.json.
 */
export const SLOPESTYLE: SlopeConfig = {
  length: 400,
  width: 120,
  pitch: 0.28,
  grades: [
    { z: -22, pitch: 0.04, blend: 8 },
    { z: -118, pitch: 0.28, blend: 8 },
    { z: -138, pitch: 0.04, blend: 8 },
    { z: -200, pitch: 0.02, blend: 8 },
  ],
  rails: [
    { points: [[-7, 0.6, -28], [-7, 0.6, -48]] },
    { points: [[7, 0.5, -28], [7, 0.5, -38], [7, 0.9, -48]] },
    { points: [[0, 0.7, -212], [0, 0.7, -232]] },
  ],
  walls: [{ x: 10, side: 1, z: -55, length: 18, height: 3, angle: 1.35, radius: 1.2, top: 1, taper: 3 }],
  kickers: [
    { z: -82, x: 0, width: 8, lipHeight: 3.5, lipAngle: 0.5, deckLength: 3, sideTaper: 3, landingAngle: 0.3, knuckleRadius: 4, runoutRadius: 14 },
    { z: -142, x: 0, width: 10, lipHeight: 6, lipAngle: 0.5, deckLength: 5, sideTaper: 3, landingAngle: 0.3, knuckleRadius: 5, runoutRadius: 18 },
  ],
  quarters: [{ z: -300, x: 0, width: 16, height: 3.5, angle: 1.45, radius: 3, deck: 3, sideTaper: 3 }],
  corners: [
    { z: -245, x: 0, width: 6, lipHeight: 3.5, lipAngle: 0.45, deckLength: 12, deckWidth: 3, sideTaper: 3, landingAngle: 0.45, knuckleRadius: 3, runoutRadius: 14 },
  ],
};
