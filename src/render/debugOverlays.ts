import * as THREE from 'three';
import { fly, launch, popRange } from '../gen/flight.ts';
import { footprint } from '../gen/footprint.ts';
import { GEN } from '../gen/config.ts';
import type { SpeedMap } from '../gen/speedmap.ts';
import { speedAt } from '../gen/speedmap.ts';
import type { Layout } from '../park/layout.ts';
import type { Params } from '../sim/params.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';

/**
 * Debug overlays for the park generator, all off by default (no UI chrome in play). They draw
 * over the terrain mesh, sharing its vertices, and only read the terrain: nothing here feeds
 * back into the sim.
 */
export type OverlayName = 'none' | 'slope' | 'speed' | 'arcs' | 'lines';
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
  lines: 'spine lines as traced, one colour each; a tall post marks each line\'s hero, a short one its other features. Grey: fill. Outlines: each feature\'s footprint — its ground and clear run-in',
  arcs: 'per kicker, the designed airs: blue slowest (no pop) · green middle · red fastest (medium pop). Ball at touchdown: white clean, orange sketchy, red bail. Post: the knuckle',
};

export function createOverlays(scene: THREE.Scene, ground: THREE.Mesh, terrain: Terrain, speedMap: SpeedMap | undefined, layout: Layout, params: Params): Overlays {
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
    if (name === 'lines') {
      const group = linePaths(layout, terrain);
      scene.add(group);
      return group;
    }
    if (name === 'arcs') {
      const group = designArcs(layout, terrain, params);
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

const GRADE_COLOUR = { clean: 0xffffff, sketchy: 0xec9a2c, bail: 0xd9452b };

/** Each kicker's designed airs, flown over the real terrain from its lip. */
function designArcs(layout: Layout, terrain: Terrain, params: Params): THREE.Group {
  const group = new THREE.Group();
  const [popMin, popMax] = popRange(params);
  const popMid = (popMin + popMax) / 2;
  const ball = new THREE.SphereGeometry(0.35, 10, 8);
  const post = new THREE.CylinderGeometry(0.08, 0.08, 3, 6);
  const contact = createContact();
  for (const f of layout.features) {
    if (f.kind !== 'kicker' || !f.meta?.speed || f.meta.lip === undefined) continue;
    const k = f.cfg;
    const yaw = k.yaw ?? 0;
    const dx = Math.sin(yaw);
    const dz = -Math.cos(yaw);
    const lipX = k.x + dx * (f.meta.lip - 0.02);
    const lipZ = k.z + dz * (f.meta.lip - 0.02);
    const [vMin, vMax] = f.meta.speed;
    const airs: [number, number, number][] = [
      [vMin, popMin, 0x3d7bd9],
      [(vMin + vMax) / 2, popMid, 0x4fbf5a],
      [vMax, popMid, 0xd9452b],
    ];
    for (const [speed, pop, colour] of airs) {
      const l = launch(terrain, lipX, lipZ, dx, dz, speed, pop);
      const flight = fly(terrain, params, lipX, l.y, lipZ, l.vx, l.vy, l.vz);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([lipX, l.y, lipZ, ...flight.points], 3));
      group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: colour })));
      const touch = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ color: GRADE_COLOUR[flight.grade] }));
      touch.position.set(flight.x, flight.y + 0.2, flight.z);
      group.add(touch);
    }
    // The knuckle, where the landing starts.
    const s = f.meta.lip + k.deckLength;
    const kx = k.x + dx * s;
    const kz = k.z + dz * s;
    const marker = new THREE.Mesh(post, new THREE.MeshBasicMaterial({ color: 0x1b2430 }));
    marker.position.set(kx, terrain.sample(kx, kz, contact).height + 1.5, kz);
    group.add(marker);
  }
  return group;
}

const LINE_COLOURS = [0xd9452b, 0x3d7bd9, 0x4fbf5a, 0xc534c9, 0xe0d23c];

/** Each line's traced path a metre above the snow, and a post at each of its features. */
function linePaths(layout: Layout, terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  const contact = createContact();
  const post = new THREE.CylinderGeometry(0.25, 0.25, 1, 6);
  // Footprints, line features in their line's colour, fill grey.
  const owner = new Map<number, number>();
  layout.lines.forEach((line, i) => line.features.forEach((fi) => owner.set(fi, i)));
  layout.features.forEach((f, fi) => {
    const p = footprint(f, GEN.clear.runIn, GEN.clear.margin);
    const ax = Math.sin(p.yaw);
    const az = -Math.cos(p.yaw);
    const cx = Math.cos(p.yaw);
    const cz = Math.sin(p.yaw);
    const pts: number[] = [];
    const ring: [number, number][] = [[p.s0, p.w0], [p.s1, p.w0], [p.s1, p.w1], [p.s0, p.w1], [p.s0, p.w0]];
    for (const [s, w] of ring) {
      const x = p.x + ax * s + cx * w;
      const z = p.z + az * s + cz * w;
      pts.push(x, terrain.sample(x, z, contact).height + 0.6, z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const i = owner.get(fi);
    group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: i === undefined ? 0x8a96a3 : (LINE_COLOURS[i % LINE_COLOURS.length] ?? 0xffffff) })));
  });
  layout.lines.forEach((line, i) => {
    const colour = LINE_COLOURS[i % LINE_COLOURS.length] ?? 0xffffff;
    const points: number[] = [];
    for (const [x, z] of line.path ?? []) points.push(x, terrain.sample(x, z, contact).height + 1, z);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: colour })));
    for (const fi of line.features) {
      const f = layout.features[fi];
      if (!f) continue;
      const at = f.kind === 'rail' ? f.cfg.points[0] : undefined;
      const x = at ? at[0] : (f.cfg as { x: number }).x;
      const z = at ? at[2] : (f.cfg as { z: number }).z;
      const tall = f.meta?.hero ? 12 : 4;
      const m = new THREE.Mesh(post, new THREE.MeshBasicMaterial({ color: colour }));
      m.scale.set(1, tall, 1);
      m.position.set(x, terrain.sample(x, z, contact).height + tall / 2, z);
      group.add(m);
    }
  });
  return group;
}
