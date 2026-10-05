import type { Params } from '../sim/params.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';

/**
 * How fast a rider gets going straight down the fall line from the top of the zone, cell by
 * cell: v² grows by 2g × the drop and loses friction (μ·g·cosβ) and air drag (k·v²) over the
 * distance, capped at the sim's terminal speed. Straight-lining is the upper bound — carving
 * and the speed check take speed off — so it says where a line *can* be fast, and where the
 * ground is too flat to keep anyone moving.
 */
export type SpeedMap = {
  cols: number;
  rows: number;
  x0: number; // m, x of column 0
  z0: number; // m, z of row 0 (rows run downhill, -Z)
  cell: number;
  speed: Float32Array; // m/s
  dirX: Float32Array; // fall line, horizontal unit vector
  dirZ: Float32Array;
};

export type SpeedMapOptions = { width: number; length: number; cell: number; startSpeed: number };

export function computeSpeedMap(terrain: Terrain, params: Params, o: SpeedMapOptions): SpeedMap {
  const cols = Math.ceil(o.width / o.cell) + 1;
  const rows = Math.ceil(o.length / o.cell) + 1;
  const x0 = -o.width / 2;
  const z0 = 0;
  const n = cols * rows;
  const speed = new Float32Array(n);
  const dirX = new Float32Array(n);
  const dirZ = new Float32Array(n);
  const height = new Float32Array(n);
  const cosSlope = new Float32Array(n);
  const c = createContact();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      terrain.sample(x0 + i * o.cell, z0 - j * o.cell, c);
      height[k] = c.height;
      cosSlope[k] = c.normal.y;
      // Downhill is along the normal's horizontal part.
      const h = Math.sqrt(c.normal.x * c.normal.x + c.normal.z * c.normal.z);
      dirX[k] = h > 1e-6 ? c.normal.x / h : 0;
      dirZ[k] = h > 1e-6 ? c.normal.z / h : -1;
    }
  }

  const g = params.world.gravity;
  const mu = params.ground.friction;
  const drag = params.ground.drag;
  const vMax2 = params.world.terminalSpeed ** 2;
  // Row 0: everyone starts at the start speed.
  for (let i = 0; i < cols; i++) speed[i] = o.startSpeed;
  for (let j = 1; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      // Step back up the fall line to the row above; on a side-hill the fall line runs across
      // the rows, so the step is longer (capped, past which the cell is fed from straight above).
      const dz = Math.max(0.3, -(dirZ[k] ?? -1));
      const ds = o.cell / dz;
      const u = Math.min(cols - 1, Math.max(0, i - ((dirX[k] ?? 0) * ds) / o.cell));
      const i0 = Math.min(cols - 2, Math.floor(u));
      const f = u - i0;
      const up = (j - 1) * cols;
      const vUp = (speed[up + i0] ?? 0) * (1 - f) + (speed[up + i0 + 1] ?? 0) * f;
      const hUp = (height[up + i0] ?? 0) * (1 - f) + (height[up + i0 + 1] ?? 0) * f;
      const drop = hUp - (height[k] ?? 0);
      const v2 = vUp * vUp + 2 * g * drop - 2 * (mu * g * (cosSlope[k] ?? 1) + drag * vUp * vUp) * ds;
      speed[k] = Math.sqrt(Math.min(vMax2, Math.max(0, v2)));
    }
  }
  return { cols, rows, x0, z0, cell: o.cell, speed, dirX, dirZ };
}

/** Bilinear speed at a point; 0 outside the map. */
export function speedAt(map: SpeedMap, x: number, z: number): number {
  const u = (x - map.x0) / map.cell;
  const v = (map.z0 - z) / map.cell;
  if (u < 0 || v < 0 || u > map.cols - 1 || v > map.rows - 1) return 0;
  const i = Math.min(map.cols - 2, Math.floor(u));
  const j = Math.min(map.rows - 2, Math.floor(v));
  const fu = u - i;
  const fv = v - j;
  const at = (a: number, b: number): number => map.speed[b * map.cols + a] ?? 0;
  return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
}
