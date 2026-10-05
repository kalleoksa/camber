import { generateLayout } from './generate.ts';

/** Generates a park off the main thread: seed in, layout out. */
const scope = self as unknown as { onmessage: ((e: MessageEvent<{ seed: number }>) => void) | null; postMessage(message: unknown): void };
scope.onmessage = (e) => scope.postMessage(generateLayout(e.data.seed));
