import type { Layout } from '../park/layout.ts';

declare const __BUILD__: string;

/**
 * A generated park for a seed: from this browser's cache if this build made it before, else
 * generated in a worker (it takes seconds) and cached. The cache key carries the build, so a
 * code or config change never serves a stale park; the take a run records stores its own
 * terrain either way.
 */
export async function loadGenerated(seed: number): Promise<Layout> {
  const key = `camber-gen:${typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'}:${seed}`;
  try {
    const hit = localStorage.getItem(key);
    if (hit) return JSON.parse(hit) as Layout;
  } catch {
    // No storage (private window): generate every time.
  }
  const layout = await new Promise<Layout>((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Layout>) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = (e) => reject(new Error(e.message));
    worker.postMessage({ seed });
  });
  try {
    // Older parks from other builds go, so the cache stays one build deep.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('camber-gen:') && !k.startsWith(key.slice(0, key.lastIndexOf(':') + 1))) localStorage.removeItem(k);
    }
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // Full or unavailable: fine, it just isn't cached.
  }
  return layout;
}
