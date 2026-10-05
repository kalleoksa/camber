import * as THREE from 'three';
import { createContact, type Terrain } from '../sim/terrain.ts';

/**
 * Debug overlays for the park generator, all off by default (no UI chrome in play). They draw
 * over the terrain mesh, sharing its vertices, and only read the terrain: nothing here feeds
 * back into the sim.
 */
export type Overlays = { setHeatmap(on: boolean): void };

const DEG = 180 / Math.PI;

/** Steepness bands from the terrain spec, flagged past 35°. */
const BANDS: [number, number][] = [
  [5, 0x3d7bd9], // flats 0–5
  [10, 0x46c1d6], // 5–10
  [20, 0x4fbf5a], // cruising 10–20
  [25, 0xe0d23c], // run-ins 20–25
  [30, 0xec9a2c], // 25–30
  [35, 0xd9452b], // steeps 30–35
  [90, 0xc534c9], // out of band
];

export const BAND_LEGEND = 'blue 0–5° · cyan 5–10 · green 10–20 · yellow 20–25 · orange 25–30 · red 30–35 · magenta >35';

export function createOverlays(scene: THREE.Scene, ground: THREE.Mesh, terrain: Terrain): Overlays {
  const position = ground.geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const contact = createContact();
  const colour = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const angle = Math.acos(terrain.sample(position.getX(i), position.getZ(i), contact).normal.y) * DEG;
    const band = BANDS.find(([max]) => angle < max) ?? BANDS[BANDS.length - 1];
    colour.setHex(band?.[1] ?? 0xffffff);
    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', position);
  geometry.setIndex(ground.geometry.getIndex());
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const heatmap = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  heatmap.visible = false;
  scene.add(heatmap);

  return {
    setHeatmap(on) {
      heatmap.visible = on;
    },
  };
}
