import type { InputSnapshot } from './snapshot.ts';

/**
 * Keyboard as a second pad, merged into the same snapshot so the sim, recorder and replays
 * can't tell them apart.
 *
 *   A / D        left stick X — carve, spin
 *   W / S        left stick Y — one stick: nose / tail press, flips. Two sticks: tuck /
 *                stand tall, flip flicks
 *   Q / E        LB / RB — left / right hand; alone, shifty (one stick) and rail slide
 *   arrows       right stick — with Q or E held, grab where they point. Alone, full
 *                deflection: two sticks' press (↑↓) and skid or shifty (←→); revert and save
 *   Shift        LT — speed check (one stick); with a grab, tweak it
 *   Space        RT — hold to load, release to pop
 *   R            Y — reset
 *   P            pause (also the pad's Options/Start); . steps one tick while paused
 *
 * Keys are digital, so the left stick ramps at `STICK_RATE` rather than snapping: an
 * instant full edge reads as a jerk, and a spin's whip is still a fraction of a second.
 */
const STICK_RATE = 8; // per second: 0 → full in 0.125 s
const GRAB = 0.5; // right-stick magnitude for a plain grab — past grab.commit, short of tweakEnter
const TWEAK = 1; // with Shift: the full tweak

const held = new Set<string>();
const stick = { x: 0, y: 0 };

function typing(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyQ', 'KeyE', 'KeyR']);

addEventListener('keydown', (ev) => {
  if (typing(ev.target) || !GAME_KEYS.has(ev.code)) return;
  held.add(ev.code);
  if (ev.code === 'Space' || ev.code.startsWith('Arrow')) ev.preventDefault(); // no page scroll
});
addEventListener('keyup', (ev) => held.delete(ev.code));
// Keys released while the tab is in the background never send keyup.
addEventListener('blur', () => held.clear());

const axis = (minus: string, plus: string): number => (held.has(plus) ? 1 : 0) - (held.has(minus) ? 1 : 0);

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

/**
 * Merge the keyboard into `out`, already holding the pad: per axis whichever is further
 * from centre, buttons either. Called once per sim tick, `dt` being that tick.
 */
export function mergeKeyboard(out: InputSnapshot, dt: number): InputSnapshot {
  const step = STICK_RATE * dt;
  stick.x = approach(stick.x, axis('KeyA', 'KeyD'), step);
  stick.y = approach(stick.y, axis('KeyS', 'KeyW'), step);
  if (Math.abs(stick.x) > Math.abs(out.lx)) out.lx = stick.x;
  if (Math.abs(stick.y) > Math.abs(out.ly)) out.ly = stick.y;

  const shift = held.has('ShiftLeft') || held.has('ShiftRight');
  const gx = axis('ArrowLeft', 'ArrowRight');
  const gy = axis('ArrowDown', 'ArrowUp');
  if (gx !== 0 || gy !== 0) {
    // A hand on the board: a plain grab, or with Shift a tweak. No hand: the whole stick.
    const hand = held.has('KeyQ') || held.has('KeyE');
    const scale = (hand ? (shift ? TWEAK : GRAB) : 1) / Math.sqrt(gx * gx + gy * gy);
    out.rx = gx * scale;
    out.ry = gy * scale;
  }

  if (shift) out.lt = 1;
  if (held.has('Space')) out.rt = 1;
  out.lb ||= held.has('KeyQ');
  out.rb ||= held.has('KeyE');
  out.y ||= held.has('KeyR');
  return out;
}
