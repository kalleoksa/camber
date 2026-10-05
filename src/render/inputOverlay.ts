import type { InputSnapshot } from '../input/snapshot.ts';

/**
 * The input overlay (panel toggle): both sticks with a short trail, triggers, bumpers and Y,
 * from the snapshot the sim actually ticked — so a replay shows the take's inputs. A learning
 * and debugging view, off by default; not game UI.
 */
const SIZE = { w: 236, h: 112 };
const TRAIL = 36; // ticks of stick trail, ~0.3 s

export type InputOverlay = {
  setEnabled(on: boolean): void;
  /** Call once per sim tick with the snapshot that tick used. */
  push(input: InputSnapshot): void;
  draw(): void;
};

export function createInputOverlay(): InputOverlay {
  const canvas = document.createElement('canvas');
  const ratio = Math.min(devicePixelRatio, 2);
  canvas.width = SIZE.w * ratio;
  canvas.height = SIZE.h * ratio;
  Object.assign(canvas.style, {
    position: 'fixed',
    zIndex: '1', // above the game canvas, which is fixed too and added later
    left: '12px',
    bottom: '12px',
    width: `${SIZE.w}px`,
    height: `${SIZE.h}px`,
    pointerEvents: 'none',
    display: 'none',
  });
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d');
  // Ring buffers, preallocated: x, y per tick for each stick.
  const left = new Float32Array(TRAIL * 2);
  const right = new Float32Array(TRAIL * 2);
  let head = 0;
  let count = 0;
  const last = { lt: 0, rt: 0, lb: false, rb: false, y: false };
  let enabled = false;

  function stick(cx: number, cy: number, trail: Float32Array, label: string): void {
    if (!g) return;
    const r = 38;
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    // Trail, oldest faintest.
    for (let i = 0; i < count; i++) {
      const k = (head - count + i + TRAIL) % TRAIL;
      g.fillStyle = `rgba(255,214,90,${(0.15 + 0.6 * (i / count)).toFixed(2)})`;
      g.beginPath();
      g.arc(cx + (trail[k * 2] ?? 0) * r, cy - (trail[k * 2 + 1] ?? 0) * r, 2, 0, Math.PI * 2);
      g.fill();
    }
    const k = (head - 1 + TRAIL) % TRAIL;
    g.fillStyle = '#ffd65a';
    g.beginPath();
    g.arc(cx + (trail[k * 2] ?? 0) * r, cy - (trail[k * 2 + 1] ?? 0) * r, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(label, cx - 4, cy + r + 12);
  }

  function bar(x: number, value: number, label: string): void {
    if (!g) return;
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.strokeRect(x, 14, 10, 72);
    g.fillStyle = '#ffd65a';
    g.fillRect(x, 14 + 72 * (1 - value), 10, 72 * value);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(label, x - 2, 100);
  }

  function button(x: number, y: number, on: boolean, label: string): void {
    if (!g) return;
    g.fillStyle = on ? '#ffd65a' : 'rgba(255,255,255,0.15)';
    g.fillRect(x, y, 22, 12);
    g.fillStyle = on ? '#111' : 'rgba(255,255,255,0.7)';
    g.fillText(label, x + 4, y + 10);
  }

  return {
    setEnabled(on) {
      enabled = on;
      canvas.style.display = on ? 'block' : 'none';
    },
    push(input) {
      left[head * 2] = input.lx;
      left[head * 2 + 1] = input.ly;
      right[head * 2] = input.rx;
      right[head * 2 + 1] = input.ry;
      head = (head + 1) % TRAIL;
      count = Math.min(count + 1, TRAIL);
      last.lt = input.lt;
      last.rt = input.rt;
      last.lb = input.lb;
      last.rb = input.rb;
      last.y = input.y;
    },
    draw() {
      if (!enabled || !g) return;
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.clearRect(0, 0, SIZE.w, SIZE.h);
      g.fillStyle = 'rgba(20,24,30,0.45)';
      g.fillRect(0, 0, SIZE.w, SIZE.h);
      g.font = '10px monospace';
      bar(8, last.lt, 'LT');
      stick(70, 52, left, 'L');
      stick(166, 52, right, 'R');
      bar(218, last.rt, 'RT');
      button(30, 2, last.lb, 'LB');
      button(184, 2, last.rb, 'RB');
      button(107, 2, last.y, 'Y');
    },
  };
}
