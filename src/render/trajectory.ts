import * as THREE from 'three';
import { fly, launch, type Flight } from '../gen/flight.ts';
import { shapeLip } from '../sim/features.ts';
import { hipTakeoff } from '../sim/hip.ts';
import type { Params } from '../sim/params.ts';
import type { RiderState } from '../sim/state.ts';
import { createContact, type SlopeConfig, type Terrain } from '../sim/terrain.ts';

/**
 * Trajectory preview (debug, off by default): riding toward a lip, the air you'd get off it at
 * the speed you're carrying — less what the climb up the takeoff and the snow take — with the
 * pop you've charged so far (none if RT isn't held), and where it comes down coloured by how it would land (white
 * clean, orange sketchy, red bail). In the air, the rest of the flight you're on. Read-only:
 * it samples the sim's state and the terrain, never writes to either.
 */
export type TrajectoryPreview = { setEnabled(on: boolean): void; update(state: RiderState): void };

type Lip = { x: number; z: number; yaw: number };

const REACH = 70; // m ahead a lip is looked for
const CONE = 0.45; // rad off the direction of travel it may sit
const EVERY = 4; // frames between updates
const GRADE = { clean: 0xffffff, sketchy: 0xec9a2c, bail: 0xd9452b };

export function createTrajectoryPreview(scene: THREE.Scene, cfg: SlopeConfig, terrain: Terrain, params: Params): TrajectoryPreview {
  const lips = collectLips(cfg);
  const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x1b2430 }));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const group = new THREE.Group();
  group.add(line, ball);
  group.visible = false;
  scene.add(group);
  const c = createContact();
  let enabled = false;
  let frame = 0;

  const show = (x: number, y: number, z: number, f: Flight): void => {
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    line.geometry.setAttribute('position', new THREE.Float32BufferAttribute([x, y, z, ...f.points], 3));
    ball.position.set(f.x, f.y + 0.3, f.z);
    (ball.material as THREE.MeshBasicMaterial).color.setHex(GRADE[f.grade]);
    group.visible = true;
  };

  return {
    setEnabled(on) {
      enabled = on;
      if (!on) group.visible = false;
    },
    update(s) {
      if (!enabled || frame++ % EVERY !== 0) return;
      const p = s.position;
      const v = s.velocity;
      if (s.mode === 'airborne') {
        show(p.x, p.y, p.z, fly(terrain, params, p.x, p.y, p.z, v.x, v.y, v.z));
        return;
      }
      // Speed along the snow, not just across the map: on a lip's face part of it is upward.
      const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      if (s.mode !== 'grounded' || speed < 2) {
        group.visible = false;
        return;
      }
      // The nearest lip ahead, within the cone of travel.
      const travel = Math.atan2(v.x, -v.z);
      let best: Lip | undefined;
      let bestD = REACH;
      for (const l of lips) {
        const dx = l.x - p.x;
        const dz = l.z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > bestD || d < 0.5) continue;
        let off = Math.atan2(dx, -dz) - travel;
        while (off > Math.PI) off -= 2 * Math.PI;
        while (off < -Math.PI) off += 2 * Math.PI;
        if (Math.abs(off) > CONE) continue;
        best = l;
        bestD = d;
      }
      if (!best) {
        group.visible = false;
        return;
      }
      // Speed at the lip: what you carry, less the climb and the snow on the way.
      const hLip = terrain.sample(best.x, best.z, c).height;
      const v2 = speed * speed + 2 * params.world.gravity * (p.y - hLip) - 2 * params.ground.friction * params.world.gravity * bestD;
      if (v2 <= 1) {
        group.visible = false;
        return;
      }
      // Off the lip the way you're heading, within what its face allows.
      let yaw = travel;
      let d = yaw - best.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      yaw = best.yaw + Math.max(-0.6, Math.min(0.6, d));
      const dx = Math.sin(yaw);
      const dz = -Math.cos(yaw);
      // The pop you've charged so far; none while RT isn't held, as in the sim.
      const pop = s.compress > 0 ? params.pop.base + params.pop.charged * s.compress : 0;
      const l = launch(terrain, best.x, best.z, dx, dz, Math.sqrt(v2), pop);
      show(best.x, l.y, best.z, fly(terrain, params, best.x, l.y, best.z, l.vx, l.vy, l.vz));
    },
  };
}

/** Every takeoff's lip in a park: kickers, corners and hips, side hits and rollers. */
function collectLips(cfg: SlopeConfig): Lip[] {
  const out: Lip[] = [];
  const at = (x: number, z: number, yaw: number, s: number): void => {
    out.push({ x: x + Math.sin(yaw) * (s - 0.05), z: z - Math.cos(yaw) * (s - 0.05), yaw });
  };
  for (const k of cfg.kickers ?? (cfg.kicker ? [cfg.kicker] : [])) {
    at(k.x, k.z, k.yaw ?? 0, (k.lipHeight / (1 - Math.cos(k.lipAngle))) * Math.sin(k.lipAngle));
  }
  for (const c of cfg.corners ?? []) {
    const runIn = c.hip ? hipTakeoff(c, c.hip).runIn : (c.lipHeight / (1 - Math.cos(c.lipAngle))) * Math.sin(c.lipAngle);
    at(c.x, c.z, c.yaw ?? 0, runIn);
  }
  for (const s of cfg.shapes ?? []) {
    const lip = shapeLip(s);
    if (lip >= 0) at(s.x, s.z, s.yaw, lip);
  }
  return out;
}
