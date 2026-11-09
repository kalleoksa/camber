import * as THREE from 'three';
import { createContact, type SlopeConfig, type Terrain } from '../sim/terrain.ts';

/**
 * The terrain as chunks, each drawn at the detail its distance from the camera needs: fine near
 * (where cut takeoff sides and knuckles have to read), coarse far. Normals come from the
 * terrain itself rather than from each mesh, so chunks at different detail shade the same where
 * they meet, and a short skirt round every chunk hides the cracks between them. Coarse chunks
 * are built up front; finer ones as the camera nears them, a few rows per frame, so building
 * never stalls a frame; fine chunks far behind are dropped again.
 */
export type TerrainMesh = {
  group: THREE.Group;
  /** Choose each chunk's detail for a camera there, and spend up to `budget` ms building. */
  update(camera: THREE.Vector3, budget: number): void;
  /** Triangles currently drawn — a diagnostic. */
  triangles(): number;
  /**
   * The terrain changed under `rects` (everywhere when omitted): rebuild the chunks there from
   * `next`, coarse at once. A chunk on screen keeps its old mesh until the detail it wants is built.
   */
  invalidate(next: Terrain, rects?: readonly Rect[]): void;
  dispose(): void;
};

/** A world-space box on the ground, x0 < x1, z0 < z1. */
export type Rect = { x0: number; x1: number; z0: number; z1: number };

const CHUNK = 64; // m
const CELLS = [0.5, 1.25, 3]; // m per level, finest first
const NEAR = [90, 220]; // m from the camera within which level 0, then 1, is wanted
const DROP = 260; // m beyond which a fine (level 0) chunk is freed
const SKIRT = 1.5; // m the skirt hangs below a chunk's edge
const RUN_OUT = 20; // m of terrain above the start (z > 0)

type Chunk = {
  x0: number;
  z0: number; // the chunk's uphill edge (larger z)
  cx: number;
  cz: number;
  levels: (THREE.Mesh | undefined)[];
  shown: THREE.Mesh | undefined;
  building: { level: number; rows: Generator<void, THREE.Mesh, void> } | undefined;
  /** `shown` was built from terrain since changed; it stays up until its replacement is built. */
  stale: boolean;
};

export function createTerrainMesh(cfg: SlopeConfig, initial: Terrain, material: THREE.Material): TerrainMesh {
  let terrain = initial;
  const group = new THREE.Group();
  const contact = createContact();
  const chunks: Chunk[] = [];
  const zTop = RUN_OUT;
  const zBottom = -cfg.length - RUN_OUT;
  for (let z0 = zTop; z0 > zBottom; z0 -= CHUNK) {
    for (let x0 = -cfg.width / 2; x0 < cfg.width / 2; x0 += CHUNK) {
      chunks.push({ x0, z0, cx: x0 + CHUNK / 2, cz: z0 - CHUNK / 2, levels: [], shown: undefined, building: undefined, stale: false });
    }
  }
  const xEnd = cfg.width / 2;

  /** One chunk at one level, yielding after each row so the caller can stop on its budget. */
  function* build(c: Chunk, level: number): Generator<void, THREE.Mesh, void> {
    const cell = CELLS[level] ?? 3;
    const w = Math.min(CHUNK, xEnd - c.x0);
    const d = Math.min(CHUNK, c.z0 - zBottom);
    const nx = Math.max(1, Math.round(w / cell));
    const nz = Math.max(1, Math.round(d / cell));
    const cols = nx + 1;
    const rows = nz + 1;
    const ring = 2 * (nx + nz); // border vertices, once each, for the skirt
    const count = cols * rows + ring;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    for (let j = 0; j < rows; j++) {
      const z = c.z0 - (d * j) / nz;
      for (let i = 0; i < cols; i++) {
        const x = c.x0 + (w * i) / nx;
        const k = j * cols + i;
        // The snow alone: a block's roof is drawn with the block, not smeared into the mesh.
        if (terrain.snow) terrain.snow(x, z, contact);
        else terrain.sample(x, z, contact);
        pos[k * 3] = x;
        pos[k * 3 + 1] = contact.height;
        pos[k * 3 + 2] = z;
        nor[k * 3] = contact.normal.x;
        nor[k * 3 + 1] = contact.normal.y;
        nor[k * 3 + 2] = contact.normal.z;
        uv[k * 2] = x / 4; // one texture tile per 4 m, whatever the detail
        uv[k * 2 + 1] = z / 4;
      }
      yield;
    }
    const index: number[] = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * cols + i;
        const b = a + cols;
        index.push(a, a + 1, b, a + 1, b + 1, b); // counter-clockwise seen from above
      }
    }
    // Skirt: the border walked round once, each vertex copied SKIRT lower, quads between.
    const border: number[] = [];
    for (let i = 0; i < nx; i++) border.push(i);
    for (let j = 0; j < nz; j++) border.push(j * cols + nx);
    for (let i = nx; i > 0; i--) border.push(nz * cols + i);
    for (let j = nz; j > 0; j--) border.push(j * cols);
    const base = cols * rows;
    border.forEach((v, n) => {
      const k = base + n;
      pos[k * 3] = pos[v * 3] ?? 0;
      pos[k * 3 + 1] = (pos[v * 3 + 1] ?? 0) - SKIRT;
      pos[k * 3 + 2] = pos[v * 3 + 2] ?? 0;
      nor[k * 3] = nor[v * 3] ?? 0;
      nor[k * 3 + 1] = nor[v * 3 + 1] ?? 1;
      nor[k * 3 + 2] = nor[v * 3 + 2] ?? 0;
      uv[k * 2] = uv[v * 2] ?? 0;
      uv[k * 2 + 1] = uv[v * 2 + 1] ?? 0;
    });
    for (let n = 0; n < border.length; n++) {
      const a = border[n] ?? 0;
      const b = border[(n + 1) % border.length] ?? 0;
      const a2 = base + n;
      const b2 = base + ((n + 1) % border.length);
      index.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2); // both windings: seen from either side
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  const finish = (c: Chunk, level: number, rows: Generator<void, THREE.Mesh, void>): void => {
    for (;;) {
      const r = rows.next();
      if (r.done) {
        c.levels[level] = r.value;
        return;
      }
    }
  };
  // The coarsest level everywhere, now: nothing is ever missing.
  const coarse = CELLS.length - 1;
  for (const c of chunks) finish(c, coarse, build(c, coarse));

  const show = (c: Chunk, mesh: THREE.Mesh | undefined): void => {
    if (c.shown === mesh) return;
    if (c.shown) group.remove(c.shown);
    if (mesh) group.add(mesh);
    c.shown = mesh;
  };
  const want = (c: Chunk, camera: THREE.Vector3): number => {
    const d = Math.hypot(c.cx - camera.x, c.cz - camera.z);
    return d < (NEAR[0] ?? 90) ? 0 : d < (NEAR[1] ?? 220) ? 1 : coarse;
  };

  return {
    group,
    update(camera, budget) {
      const until = performance.now() + budget;
      // Nearest first, so what's under the rider sharpens before the distance does.
      const order = chunks.slice().sort((a, b) => Math.hypot(a.cx - camera.x, a.cz - camera.z) - Math.hypot(b.cx - camera.x, b.cz - camera.z));
      for (const c of order) {
        const level = want(c, camera);
        // Build what's wanted, in slices, within the budget.
        if (!c.levels[level] && performance.now() < until) {
          if (!c.building || c.building.level !== level) c.building = { level, rows: build(c, level) };
          for (;;) {
            const r = c.building.rows.next();
            if (r.done) {
              c.levels[level] = r.value;
              c.building = undefined;
              break;
            }
            if (performance.now() >= until) break;
          }
        }
        // Show the finest built at or coarser than what's wanted.
        let shown: THREE.Mesh | undefined;
        for (let l = level; l <= coarse && !shown; l++) shown = c.levels[l];
        if (c.stale) {
          if (!c.levels[level]) continue; // the old mesh until the wanted detail is rebuilt
          c.shown?.geometry.dispose();
          c.stale = false;
        }
        show(c, shown);
        // Free fine detail left far behind.
        const fine = c.levels[0];
        if (fine && fine !== c.shown && Math.hypot(c.cx - camera.x, c.cz - camera.z) > DROP) {
          fine.geometry.dispose();
          c.levels[0] = undefined;
        }
      }
    },
    invalidate(next, rects) {
      terrain = next;
      for (const c of chunks) {
        if (rects && !rects.some((r) => r.x0 <= c.x0 + CHUNK && r.x1 >= c.x0 && r.z0 <= c.z0 && r.z1 >= c.z0 - CHUNK)) continue;
        for (const m of c.levels) if (m && m !== c.shown) m.geometry.dispose();
        c.levels = [];
        c.building = undefined;
        if (c.shown) c.stale = true;
        finish(c, coarse, build(c, coarse));
      }
    },
    dispose() {
      for (const c of chunks) {
        for (const m of c.levels) if (m && m !== c.shown) m.geometry.dispose();
        c.shown?.geometry.dispose();
        c.levels = [];
        c.shown = undefined;
      }
      group.clear();
    },
    triangles() {
      let n = 0;
      for (const c of chunks) n += (c.shown?.geometry.getIndex()?.count ?? 0) / 3;
      return n;
    },
  };
}
