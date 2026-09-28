import { normalize, set, type Vec3 } from './vec3.ts';

/**
 * Board geometry, shared by the sim (tweak axis for the landing test) and the rig (mesh
 * and hand targets) so the two can never disagree about where a grab is. Not params:
 * the deck mesh is built from these once, so tuning them live would draw a lie.
 */
export const BOARD_LENGTH = 1.55; // m
export const BOARD_HALF = BOARD_LENGTH / 2;
const EDGE_X = 0.145; // m, just outside the deck so the hand wraps the edge
const GRAB_Y = 0.035; // m, deck top
const TIP_INSET = 0.06; // m, t = 0/1 lands this far in from the tips

/**
 * A grab is a coordinate on the board, not one of eight buttons (§7.3). `edge` picks the
 * rail continuously, + toe (board-local −X) to − heel; `t` runs tail (0) to nose (1).
 */
export function edgePoint(out: Vec3, edge: number, t: number): Vec3 {
  return set(out, -edge * EDGE_X, GRAB_Y, (t * 2 - 1) * (BOARD_HALF - TIP_INSET));
}

/**
 * Axis the legs shove the board about, through the grab point: perpendicular to the
 * board's length and to the push. Board-local. Open question 7 — settle it in pose mode.
 */
export function tweakAxis(out: Vec3, edge: number, t: number): Vec3 {
  edgePoint(out, edge, t);
  set(out, out.z, 0, -out.x);
  return normalize(out);
}
