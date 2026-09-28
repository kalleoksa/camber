import * as THREE from 'three';
import type { Params } from '../sim/params.ts';
import type { RiderView } from './scene.ts';

const MAX_PARTICLES = 2000;

const VERTEX = `
  attribute float alpha;
  attribute float scale;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = scale * 300.0 / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = `
  varying float vAlpha;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * (1.0 - r * 4.0));
  }
`;

export type Spray = {
  object: THREE.Points;
  update(view: RiderView, params: Params, dt: number): void;
};

/**
 * Snow thrown off the engaged edge. Render-side, so `Math.random` is fine here — none of
 * this reaches the sim. Emission is driven by `scrub`: a flat base at speed throws
 * nothing, a hard carve throws a wall of it.
 */
export function createSpray(): Spray {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const alphas = new Float32Array(MAX_PARTICLES);
  const scales = new Float32Array(MAX_PARTICLES);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  const lives = new Float32Array(MAX_PARTICLES);

  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const alphaAttribute = new THREE.BufferAttribute(alphas, 1);
  const scaleAttribute = new THREE.BufferAttribute(scales, 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('alpha', alphaAttribute);
  geometry.setAttribute('scale', scaleAttribute);
  geometry.setDrawRange(0, MAX_PARTICLES);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
  });

  const object = new THREE.Points(geometry, material);
  object.frustumCulled = false;

  const up = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  let cursor = 0;
  let pending = 0;
  let burstFired = false;

  const spawn = (view: RiderView, p: Params, edgeSign: number): void => {
    const i = cursor;
    cursor = (cursor + 1) % MAX_PARTICLES;

    // Thrown from the engaged edge, which is the downhill side of the board.
    const offset = -edgeSign * 0.13;
    positions[i * 3] = view.position.x + right.x * offset;
    positions[i * 3 + 1] = view.position.y + right.y * offset + 0.05;
    positions[i * 3 + 2] = view.position.z + right.z * offset;

    const launch = p.spray.launch * (0.5 + Math.random());
    const rise = p.spray.rise * (0.5 + Math.random());
    velocities[i * 3] = -edgeSign * right.x * launch + up.x * rise + (Math.random() - 0.5) * p.spray.spread;
    velocities[i * 3 + 1] = -edgeSign * right.y * launch + up.y * rise + (Math.random() - 0.5) * p.spray.spread;
    velocities[i * 3 + 2] = -edgeSign * right.z * launch + up.z * rise + (Math.random() - 0.5) * p.spray.spread;

    lives[i] = p.spray.life * (0.6 + Math.random() * 0.4);
    scales[i] = p.spray.size * (0.6 + Math.random() * 0.8);
  };

  return {
    object,

    update(view, params, dt) {
      up.set(view.groundNormal.x, view.groundNormal.y, view.groundNormal.z).normalize();
      forward.set(Math.sin(view.heading), 0, Math.cos(view.heading));
      forward.addScaledVector(up, -forward.dot(up)).normalize();
      right.crossVectors(up, forward);

      // One burst on touchdown, scaled by how hard it was. Reads the landing before the
      // rider does anything about it, which is the point of the feedback.
      if (view.absorb > 0 && view.impact > 1 && !burstFired) {
        burstFired = true;
        const burst = Math.min(Math.round(view.impact * 12), 260);
        for (let i = 0; i < burst; i++) spawn(view, params, i % 2 === 0 ? 1 : -1);
      } else if (view.absorb <= 0) {
        burstFired = false;
      }

      if (view.mode === 'grounded' && view.scrub > 0) {
        const intensity = Math.min(view.scrub / params.spray.scrubRef, 1);
        pending += intensity * params.spray.rate * dt;
        const edgeSign = view.edge >= 0 ? 1 : -1;
        while (pending >= 1) {
          pending -= 1;
          spawn(view, params, edgeSign);
        }
      } else {
        pending = 0;
      }

      const fade = params.spray.life * 0.5;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const life = (lives[i] ?? 0) - dt;
        if (life <= 0) {
          lives[i] = 0;
          alphas[i] = 0;
          continue;
        }
        lives[i] = life;

        const b = i * 3;
        const vy = (velocities[b + 1] ?? 0) - params.spray.gravity * dt;
        velocities[b + 1] = vy;
        positions[b] = (positions[b] ?? 0) + (velocities[b] ?? 0) * dt;
        positions[b + 1] = (positions[b + 1] ?? 0) + vy * dt;
        positions[b + 2] = (positions[b + 2] ?? 0) + (velocities[b + 2] ?? 0) * dt;
        alphas[i] = Math.min(1, life / fade) * 0.85;
      }

      positionAttribute.needsUpdate = true;
      alphaAttribute.needsUpdate = true;
      scaleAttribute.needsUpdate = true;
    },
  };
}
