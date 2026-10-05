import * as THREE from 'three';

/**
 * Rider shading, step 9b (docs/rider-look.md §3): three-step toon ramp, inverted-hull
 * outline, and a flutter chunk for cloth (9c). Render only.
 */

const ramp = (() => {
  // Three bands: shadow, mid, lit. Nearest filtering is what makes them bands.
  const t = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

/**
 * Cloth flutter, shared by every fluttering material: a normal offset from sim time and
 * speed only — no accumulated state — so a replay flutters exactly as the take did.
 * `scene.ts` writes these each frame from the interpolated sim state.
 */
export const flutter = {
  uTime: { value: 0 }, // s of sim time, (tick + alpha) · dt
  uAmp: { value: 0 }, // m of normal offset at the current speed
};

const FLUTTER_VERTEX = /* glsl */ `
  float flutterPhase = position.y * 23.0 + position.x * 17.0 + position.z * 13.0;
  float flutterWave = sin(flutterPhase + uTime * 31.0) * 0.6 + sin(flutterPhase * 1.7 - uTime * 47.0) * 0.4;
`;

function addFlutter(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }): void {
  shader.uniforms.uTime = flutter.uTime;
  shader.uniforms.uAmp = flutter.uAmp;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmp;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${FLUTTER_VERTEX}\ntransformed += normal * flutterWave * uAmp;`,
    );
}

/** Toon material, optionally textured and optionally fluttering. */
export function toon(color: number, opts: { map?: THREE.Texture; flutter?: boolean; twoSided?: boolean } = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: ramp,
    side: opts.twoSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (opts.map) m.map = opts.map;
  if (opts.flutter) {
    m.onBeforeCompile = addFlutter;
    m.customProgramCacheKey = () => 'flutter';
    m.userData.flutter = true;
  }
  return m;
}

/**
 * Inverted hull: the same geometry, back faces only, pushed out along the normal in view
 * space so the line holds a similar width at any distance and any segment scale.
 */
function outlineMaterial(withFlutter: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(0x14161a) }, uTime: flutter.uTime, uAmp: flutter.uAmp },
    // Skinning chunks are no-ops on a plain mesh; on a skinned one (the pant legs) the hull
    // bends with it.
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      uniform float uTime;
      uniform float uAmp;
      void main() {
        #include <skinbase_vertex>
        #include <beginnormal_vertex>
        #include <skinnormal_vertex>
        vec3 transformed = position;
        ${withFlutter ? `${FLUTTER_VERTEX}\ntransformed += normal * flutterWave * uAmp;` : ''}
        #include <skinning_vertex>
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        vec3 n = normalize(normalMatrix * objectNormal);
        mv.xyz += n * (0.006 + 0.0022 * -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }
    `,
  });
}

const OUTLINE = outlineMaterial(false);
const OUTLINE_FLUTTER = outlineMaterial(true);

/** Give every toon mesh under `root` an outline child. Call once, after building. */
export function outlineAll(root: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshToonMaterial) meshes.push(o);
  });
  for (const mesh of meshes) {
    const material = mesh.material as THREE.MeshToonMaterial;
    const outline = material.userData.flutter ? OUTLINE_FLUTTER : OUTLINE;
    let hull: THREE.Mesh;
    if (mesh instanceof THREE.SkinnedMesh) {
      const skinned = new THREE.SkinnedMesh(mesh.geometry, outline);
      skinned.bind(mesh.skeleton, mesh.bindMatrix);
      skinned.frustumCulled = false;
      hull = skinned;
    } else hull = new THREE.Mesh(mesh.geometry, outline);
    hull.castShadow = false;
    hull.userData.outline = true;
    mesh.add(hull);
  }
}

/** Seeded LCG so generated textures come out the same every load. Render-only. */
export function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/**
 * Tileable camo after your pants reference: olive ground with khaki, light-green and dark
 * blobs. Each blob is drawn at every wrapped offset so the texture tiles seamlessly.
 */
export function camo(colors: { ground: number; blobs: number[] }, seed = 3): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  const hex = (v: number): string => `#${v.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex(colors.ground);
  g.fillRect(0, 0, size, size);
  const rnd = lcg(seed);
  for (let layer = 0; layer < colors.blobs.length; layer++) {
    g.fillStyle = hex(colors.blobs[layer] ?? colors.ground);
    for (let i = 0; i < 9; i++) {
      // A blob is a few overlapping ellipses, which reads as an organic camo patch.
      const cx = rnd() * size;
      const cy = rnd() * size;
      const parts = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < parts; k++) {
        const ex = cx + (rnd() - 0.5) * 40;
        const ey = cy + (rnd() - 0.5) * 40;
        const rx = 10 + rnd() * 22;
        const ry = 8 + rnd() * 16;
        const rot = rnd() * Math.PI;
        for (const ox of [-size, 0, size]) {
          for (const oy of [-size, 0, size]) {
            g.beginPath();
            g.ellipse(ex + ox, ey + oy, rx, ry, rot, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
