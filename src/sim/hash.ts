import type { RiderMode, RiderState } from './state.ts';

const MODES: RiderMode[] = ['grounded', 'airborne', 'railed', 'walled', 'bailed'];

const scratch = new ArrayBuffer(8);
const asFloat = new Float64Array(scratch);
const asWords = new Uint32Array(scratch);

/**
 * FNV-1a over the raw bits of every state float. Exact, not rounded — a determinism
 * check that tolerated drift would not be a determinism check.
 */
export type Hasher = {
  reset(): void;
  push(value: number): void;
  digest(): string;
};

export function createHasher(): Hasher {
  let h = 0x811c9dc5;
  const mix = (word: number): void => {
    h = Math.imul(h ^ word, 0x01000193) >>> 0;
  };
  return {
    reset() {
      h = 0x811c9dc5;
    },
    push(value: number) {
      asFloat[0] = value;
      mix(asWords[0] ?? 0);
      mix(asWords[1] ?? 0);
    },
    digest() {
      return (h >>> 0).toString(16).padStart(8, '0');
    },
  };
}

// Reused so hashing a state per tick doesn't allocate a closure (invariant 7).
const shared = createHasher();

export function hashState(state: RiderState, into: Hasher = shared): string {
  into.reset();
  into.push(state.tick);
  into.push(MODES.indexOf(state.mode));
  into.push(state.position.x);
  into.push(state.position.y);
  into.push(state.position.z);
  into.push(state.velocity.x);
  into.push(state.velocity.y);
  into.push(state.velocity.z);
  into.push(state.heading);
  into.push(state.edge);
  into.push(state.stance);
  into.push(state.compress);
  into.push(state.groundNormal.x);
  into.push(state.groundNormal.y);
  into.push(state.groundNormal.z);
  into.push(state.scrub);
  into.push(state.clearance);
  into.push(state.airTime);
  return into.digest();
}
