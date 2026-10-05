import * as THREE from 'three';
import type { SpeedMap } from '../gen/speedmap.ts';
import { speedAt } from '../gen/speedmap.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';

/**
 * Debug overlays for the park generator, all off by default (no UI chrome in play). They draw
 * over the terrain mesh, sharing its vertices, and only read the terrain: nothing here feeds
 * back into the sim.
 */
export type OverlayName = 'none' | 'slope' | 'speed';
export type Overlays = { show(name: OverlayName): void };

const DEG = 180 / Math.PI;

/** Steepness bands from the terrain spec, flagged past 35°. */
const SLOPE: [number, number][] = [
  [5, 0x3d7bd9], // flats 0–5
  [10, 0x46c1d6], // 5–10
  [20, 0x4fbf5a], // cruising 10–20
  [25, 0xe0d23c], // run-ins 20–25
  [30, 0xec9a2c], // 25–30
  [35, 0xd9452b], // steeps 30–35
  [90, 0xc534c9], // out of band
];

/** Straight-line speed, km/h: stalled, slow, jump speeds, fast, flat out. */
const SPEED: [number, number][] = [
  [5, 0x6b3fa0],
  [25, 0x3d7bd9],
  [45, 0x4fbf5a],
  [65, 0xe0d23c],
  [80, 0xec9a2c],
  [999, 0xd9452b],
];

export const LEGEND: Record<OverlayName, string> = {
  none: '',
  slope: 'blue 0–5° · cyan 5–10 · green 10–20 · yellow 20–25 · orange 25–30 · red 30–35 · magenta >35',
  speed: 'straight down the fall line, km/h: purple <5 (stalls) · blue <25 · green 25–45 · yellow <65 · orange <80 · red faster. Ticks: fall line',
};

export function createOverlays(scene: THREE.Scene, ground: THREE.Mesh, terrain: Terrain, speedMap: SpeedMap | undefined): Overlays {
  const position = ground.geometry.getAttribute('position');
  const contact = createContact();
  const colour = new THREE.Color();

  const layer = (value: (x: number, z: number) => number, bands: [number, number][]): THREE.Mesh => {
    const colours = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const v = value(position.getX(i), position.getZ(i));
      colour.setHex((bands.find(([max]) => v < max) ?? bands[bands.length - 1])?.[1] ?? 0xffffff);
      colours[i * 3] = colour.r;
      colours[i * 3 + 1] = colour.g;
      colours[i * 3 + 2] = colour.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', position);
    geometry.setIndex(ground.geometry.getIndex());
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  };

  // Built on first use: colouring every vertex takes a moment on a big zone.
  const built: Partial<Record<OverlayName, THREE.Object3D>> = {};
  const build = (name: OverlayName): THREE.Object3D | undefined => {
    if (name === 'slope') return layer((x, z) => Math.acos(terrain.sample(x, z, contact).normal.y) * DEG, SLOPE);
    if (name === 'speed' && speedMap) {
      const group = new THREE.Group();
      group.add(layer((x, z) => speedAt(speedMap, x, z) * 3.6, SPEED));
      group.add(fallLineTicks(speedMap, terrain));
      scene.add(group);
      return group;
    }
    return undefined;
  };

  return {
    show(name) {
      for (const o of Object.values(built)) if (o) o.visible = false;
      if (name === 'none') return;
      const o = (built[name] ??= build(name));
      if (!o) return;
      o.visible = true;
      o.traverse((c) => (c.visible = true));
    },
  };
}

/** A short tick every 12 m along the fall line, so the speed map's direction reads too. */
function fallLineTicks(map: SpeedMap, terrain: Terrain): THREE.LineSegments {
  const contact = createContact();
  const points: number[] = [];
  const every = Math.max(1, Math.round(12 / map.cell));
  for (let j = 0; j < map.rows; j += every) {
    for (let i = 0; i < map.cols; i += every) {
      const k = j * map.cols + i;
      const x = map.x0 + i * map.cell;
      const z = map.z0 - j * map.cell;
      const dx = (map.dirX[k] ?? 0) * 3;
      const dz = (map.dirZ[k] ?? 0) * 3;
      points.push(x, terrain.sample(x, z, contact).height + 0.15, z);
      points.push(x + dx, terrain.sample(x + dx, z + dz, contact).height + 0.15, z + dz);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x1b2430 }));
}
