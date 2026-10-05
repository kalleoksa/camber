import type { Layout } from '../park/layout.ts';

/**
 * Undo/redo as layout snapshots, and the local copy of an edited park. The copy lives in this
 * browser (localStorage), keyed by park, and overrides the park as shipped until reset; the
 * record is the exported JSON committed to parks/.
 */

export type History = {
  /** The layout after a finished edit (a drag counts once, on release). */
  push(layout: Layout): void;
  undo(): Layout | undefined;
  redo(): Layout | undefined;
};

const DEPTH = 100;

export function createHistory(start: Layout): History {
  const done: string[] = [JSON.stringify(start)];
  const undone: string[] = [];
  return {
    push(layout) {
      const json = JSON.stringify(layout);
      if (json === done[done.length - 1]) return;
      done.push(json);
      if (done.length > DEPTH) done.shift();
      undone.length = 0;
    },
    undo() {
      if (done.length < 2) return undefined;
      undone.push(done.pop() ?? '');
      return JSON.parse(done[done.length - 1] ?? '') as Layout;
    },
    redo() {
      const json = undone.pop();
      if (json === undefined) return undefined;
      done.push(json);
      return JSON.parse(json) as Layout;
    },
  };
}

/** A park's name for storage: a generated park by its seed too. */
export function parkKey(layout: Layout): string {
  return layout.seed !== undefined ? `${layout.name}-${layout.seed}` : layout.name;
}

/** A short hash of a layout, to tell whether the shipped park changed since a copy was made. */
export function hashOf(layout: Layout): string {
  const s = JSON.stringify(layout);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

type Copy = { base: string; layout: Layout };
const KEY = 'camber-edit:';

/** The edited copy of a park kept in this browser, if any. `base`: hash of the park it was edited from. */
export function localCopy(key: string): Copy | undefined {
  try {
    const json = localStorage.getItem(KEY + key);
    return json ? (JSON.parse(json) as Copy) : undefined;
  } catch {
    return undefined;
  }
}

/** Keep the copy; false when the browser won't (private window, storage full). */
export function keepCopy(key: string, layout: Layout, base: string): boolean {
  try {
    localStorage.setItem(KEY + key, JSON.stringify({ base, layout }));
    return true;
  } catch {
    return false;
  }
}

export function dropCopy(key: string): void {
  try {
    localStorage.removeItem(KEY + key);
  } catch {
    // Blocked storage: nothing was kept either.
  }
}
