import * as THREE from 'three';
import type { Layout } from '../park/layout.ts';
import type { Params } from '../sim/params.ts';
import { createContact, type Terrain } from '../sim/terrain.ts';
import { sweep, takeoffOf, type Verdict } from './airs.ts';
import { originOf } from './edits.ts';

/**
 * What the checks look like on the snow, edit mode only: a dot over each checked feature
 * (validation), and each takeoff's landing tinted where airs across its speeds come down —
 * green under `land.impactSketchy`, amber to `land.impactBail`, red past it.
 */
export type Marks = {
  dots(layout: Layout, terrain: Terrain, verdicts: Map<number, Verdict> | undefined): void;
  impact(layout: Layout | undefined, terrain: Terrain, params: Params, pops: [number, number]): void;
  show(on: boolean): void;
};

export const COLOUR = { red: 0xd9452b, amber: 0xec9a2c, green: 0x3fae5a };

export function createMarks(scene: THREE.Scene): Marks {
  const dots = new THREE.Group();
  const strips = new THREE.Group();
  scene.add(dots, strips);
  const ball = new THREE.SphereGeometry(0.7, 12, 8);
  const materials = {
    red: new THREE.MeshBasicMaterial({ color: COLOUR.red }),
    amber: new THREE.MeshBasicMaterial({ color: COLOUR.amber }),
    green: new THREE.MeshBasicMaterial({ color: COLOUR.green }),
  };
  const c = createContact();
  const clear = (g: THREE.Group): void => {
    for (const o of g.children) {
      if (!(o instanceof THREE.Mesh) || o.geometry === ball) continue;
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    g.clear();
  };

  return {
    dots(layout, terrain, verdicts) {
      clear(dots);
      if (!verdicts) return;
      for (const [i, v] of verdicts) {
        const f = layout.features[i];
        if (!f) continue;
        const t = takeoffOf(f);
        const o = originOf(f);
        const x = t?.x ?? o.x;
        const z = t?.z ?? o.z;
        const m = new THREE.Mesh(ball, materials[v.colour]);
        m.position.set(x, terrain.sample(x, z, c).height + 4, z);
        dots.add(m);
      }
    },
    impact(layout, terrain, params, pops) {
      clear(strips);
      if (!layout) return;
      const colour = new THREE.Color();
      const pos: number[] = [];
      const col: number[] = [];
      for (const f of layout.features) {
        const t = takeoffOf(f);
        if (!t) continue;
        const half = Math.min(((f.cfg as { width?: number }).width ?? 4) / 2, 6);
        const ax = -t.dirZ; // across the flight
        const az = t.dirX;
        const airs = sweep(t, terrain, params, pops);
        airs.forEach((a, k) => {
          // A band across the landing at each touchdown, half way to the next on either side.
          const fl = a.flight;
          const prev = airs[k - 1]?.flight ?? fl;
          const next = airs[k + 1]?.flight ?? fl;
          const back = Math.min(1.5, Math.hypot(fl.x - prev.x, fl.z - prev.z) / 2 + 0.05);
          const ahead = Math.min(1.5, Math.hypot(next.x - fl.x, next.z - fl.z) / 2 + 0.05);
          colour.setHex(fl.impact >= params.land.impactBail ? COLOUR.red : fl.impact >= params.land.impactSketchy ? COLOUR.amber : COLOUR.green);
          const corner = (s: number, w: number): void => {
            const x = fl.x + t.dirX * s + ax * w;
            const z = fl.z + t.dirZ * s + az * w;
            pos.push(x, terrain.sample(x, z, c).height + 0.08, z);
            col.push(colour.r, colour.g, colour.b);
          };
          corner(-back, -half);
          corner(ahead, -half);
          corner(ahead, half);
          corner(-back, -half);
          corner(ahead, half);
          corner(-back, half);
        });
      }
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      strips.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })));
    },
    show(on) {
      dots.visible = on;
      strips.visible = on;
    },
  };
}
