import { copyInput, neutralInput, type InputSnapshot } from './snapshot.ts';

/** Read-only, never mutated — what a disconnected pad reports. */
const NEUTRAL = neutralInput();

const STICK_DEADZONE = 0.14;
const TRIGGER_DEADZONE = 0.06;
const BUTTON_THRESHOLD = 0.5;

/**
 * Which physical control sits at which index.
 *
 * Chrome remaps a DualSense onto the standard layout. Safari and Firefox on macOS hand
 * back the raw HID order instead, where the triggers arrive as *axes* rather than buttons
 * and the face buttons are in PlayStation order. Reading standard indices off a raw-HID
 * pad is not a subtle failure: the right stick lands on a trigger, and the trigger the
 * game reads for pop is whatever button happens to sit at index 6.
 */
type PadLayout = {
  name: string;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  /** Trigger axis, or −1 when this layout's triggers are buttons. */
  ltAxis: number;
  rtAxis: number;
  ltButton: number;
  rtButton: number;
  lb: number;
  rb: number;
  a: number;
  b: number;
  x: number;
  y: number;
};

const STANDARD: PadLayout = {
  name: 'standard',
  lx: 0,
  ly: 1,
  rx: 2,
  ry: 3,
  ltAxis: -1,
  rtAxis: -1,
  ltButton: 6,
  rtButton: 7,
  lb: 4,
  rb: 5,
  a: 0,
  b: 1,
  x: 2,
  y: 3,
};

/**
 * Raw DualSense HID order. Axes follow the input report's byte order — LX, LY, RX, RY,
 * L2, R2 — and the face buttons run Square, Cross, Circle, Triangle, so Cross (what the
 * standard layout calls A) is index 1 rather than 0.
 */
const PLAYSTATION_HID: PadLayout = {
  name: 'playstation-hid',
  lx: 0,
  ly: 1,
  rx: 2,
  ry: 3,
  ltAxis: 4,
  rtAxis: 5,
  ltButton: 6,
  rtButton: 7,
  lb: 4,
  rb: 5,
  a: 1,
  b: 2,
  x: 0,
  y: 3,
};

/** Enough of the last-seen pad to notice when a different one shows up. */
const seen = { slot: -1, layout: '' };

/**
 * `getGamepads()` is a sparse array indexed by the browser's own slot assignment, not a
 * list of what's plugged in. A pad that reconnects — which a Bluetooth pad does every
 * time it sleeps — can land in slot 1 or 3 with slot 0 left null, so reading index 0
 * loses the pad for the rest of the session. Take the first slot that holds something.
 */
function findPad(): Gamepad | null {
  const pads = navigator.getGamepads();
  for (let i = 0; i < pads.length; i++) {
    const pad = pads[i];
    if (pad && pad.connected && pad.axes.length >= 2) return pad;
  }
  return null;
}

function layoutFor(pad: Gamepad): PadLayout {
  if (pad.mapping === 'standard') return STANDARD;
  // The browser didn't remap it. On macOS that means a PlayStation pad in raw HID order,
  // which is the only non-standard layout worth guessing at.
  return PLAYSTATION_HID;
}

/** Module scratch, reused — this runs on the fixed tick. */
const stick = { x: 0, y: 0 };

/** Radial deadzone, rescaled so the live range still reaches 1. */
function deadzoneStick(x: number, y: number): void {
  const m = Math.hypot(x, y);
  if (m < STICK_DEADZONE) {
    stick.x = 0;
    stick.y = 0;
    return;
  }
  const scaled = Math.min((m - STICK_DEADZONE) / (1 - STICK_DEADZONE), 1) / m;
  stick.x = x * scaled;
  stick.y = y * scaled;
}

function shape(value: number): number {
  return value < TRIGGER_DEADZONE ? 0 : (value - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE);
}

/**
 * An axis trigger rests at −1 and reads +1 fully pulled. Before the pad's first real
 * report some browsers publish 0 for it, which would normalize to a permanently
 * half-pulled trigger — half a pop charge held down forever, with no way to release it.
 * Ignore the axis until it has moved somewhere unambiguous. Index 0 is LT, 1 is RT.
 */
const axisLive = [false, false];

function axisTrigger(pad: Gamepad, axis: number, slot: number): number {
  const raw = pad.axes[axis];
  if (raw === undefined) return -1; // no such axis; caller falls back to the button
  if (!axisLive[slot]) {
    if (Math.abs(raw) <= 0.5) return 0;
    axisLive[slot] = true;
  }
  return shape((raw + 1) / 2);
}

function buttonTrigger(pad: Gamepad, index: number): number {
  return shape(pad.buttons[index]?.value ?? 0);
}

function pressed(pad: Gamepad, index: number): boolean {
  const button = pad.buttons[index];
  return button ? button.pressed || button.value > BUTTON_THRESHOLD : false;
}

/** Stick Y is inverted here so positive is up everywhere downstream. */
export function pollGamepad(out: InputSnapshot = neutralInput()): InputSnapshot {
  const pad = findPad();
  if (!pad) {
    seen.slot = -1;
    seen.layout = '';
    return copyInput(out, NEUTRAL);
  }

  // A different pad, or the same one after a reconnect, hasn't reported its trigger rest
  // position yet. Re-arm the latch so it isn't trusted until it moves.
  const layout = layoutFor(pad);
  if (seen.slot !== pad.index || seen.layout !== layout.name) {
    seen.slot = pad.index;
    seen.layout = layout.name;
    axisLive[0] = false;
    axisLive[1] = false;
  }

  deadzoneStick(pad.axes[layout.lx] ?? 0, -(pad.axes[layout.ly] ?? 0));
  out.lx = stick.x;
  out.ly = stick.y;
  deadzoneStick(pad.axes[layout.rx] ?? 0, -(pad.axes[layout.ry] ?? 0));
  out.rx = stick.x;
  out.ry = stick.y;

  // A layout can claim axis triggers on a pad that doesn't have those axes. Fall back to
  // the buttons rather than reading a dead trigger.
  let lt = layout.ltAxis >= 0 ? axisTrigger(pad, layout.ltAxis, 0) : -1;
  if (lt < 0) lt = buttonTrigger(pad, layout.ltButton);
  let rt = layout.rtAxis >= 0 ? axisTrigger(pad, layout.rtAxis, 1) : -1;
  if (rt < 0) rt = buttonTrigger(pad, layout.rtButton);
  out.lt = lt;
  out.rt = rt;

  out.lb = pressed(pad, layout.lb);
  out.rb = pressed(pad, layout.rb);
  out.a = pressed(pad, layout.a);
  out.b = pressed(pad, layout.b);
  out.x = pressed(pad, layout.x);
  out.y = pressed(pad, layout.y);
  return out;
}

/**
 * One line naming what the browser is actually handing us, for the tuning readout. Reads
 * the pad directly rather than the poll cache so it still says something useful in pose
 * mode, where the sim — and therefore `pollGamepad` — is not running.
 */
export function padSummary(): string {
  const pad = findPad();
  if (!pad) return 'none — press a button on the pad';
  const mapping = pad.mapping === '' ? 'non-standard' : pad.mapping;
  const layout = layoutFor(pad).name;
  return `[${pad.index}] ${pad.id.slice(0, 30)} · ${mapping} → ${layout} · ${pad.axes.length}ax ${pad.buttons.length}btn`;
}

/**
 * Every axis and pressed button, raw and unmapped. This is the thing to read when the pad
 * is connected but the controls are wrong: it says which index actually moves.
 */
export function padRawSummary(): string {
  const pad = findPad();
  if (!pad) return '—';
  let axes = '';
  for (let i = 0; i < pad.axes.length; i++) axes += `${i}:${(pad.axes[i] ?? 0).toFixed(2)} `;
  let buttons = '';
  for (let i = 0; i < pad.buttons.length; i++) {
    const value = pad.buttons[i]?.value ?? 0;
    if (value > 0.02) buttons += `${i}${value < 0.98 ? `(${value.toFixed(2)})` : ''} `;
  }
  return `${axes}| ${buttons || 'no buttons'}`;
}
