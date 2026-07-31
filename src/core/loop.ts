/** Sim rate. Fixed for determinism, not for performance. Never make this a parameter. */
export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;

/** Ticks we are willing to catch up in one frame before dropping time on the floor. */
const MAX_CATCHUP_TICKS = 8;

export type Loop = {
  start(): void;
  stop(): void;
};

export function createLoop(step: () => void, render: (alpha: number) => void): Loop {
  let running = false;
  let last = 0;
  let accumulator = 0;
  let frame = 0;

  const tickFrame = (now: number): void => {
    if (!running) return;
    frame = requestAnimationFrame(tickFrame);

    const elapsed = Math.min((now - last) / 1000, MAX_CATCHUP_TICKS * TICK_DT);
    last = now;
    accumulator += elapsed;

    while (accumulator >= TICK_DT) {
      step();
      accumulator -= TICK_DT;
    }

    render(accumulator / TICK_DT);
  };

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      accumulator = 0;
      frame = requestAnimationFrame(tickFrame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
    },
  };
}
