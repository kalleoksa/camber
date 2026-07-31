import { neutralInput, type InputSnapshot } from './snapshot.ts';

const STICK_DEADZONE = 0.14;
const TRIGGER_DEADZONE = 0.06;
const BUTTON_THRESHOLD = 0.5;

/** Radial deadzone, rescaled so the live range still reaches 1. */
function deadzoneStick(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < STICK_DEADZONE) return [0, 0];
  const scaled = Math.min((m - STICK_DEADZONE) / (1 - STICK_DEADZONE), 1) / m;
  return [x * scaled, y * scaled];
}

function trigger(pad: Gamepad, buttonIndex: number): number {
  const value = pad.buttons[buttonIndex]?.value ?? 0;
  return value < TRIGGER_DEADZONE ? 0 : (value - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE);
}

function pressed(pad: Gamepad, buttonIndex: number): boolean {
  const button = pad.buttons[buttonIndex];
  return button ? button.pressed || button.value > BUTTON_THRESHOLD : false;
}

/** Xbox layout. Stick Y is inverted here so positive is up everywhere downstream. */
export function pollGamepad(index = 0, out: InputSnapshot = neutralInput()): InputSnapshot {
  const pad = navigator.getGamepads()[index];
  if (!pad) return Object.assign(out, neutralInput());

  const [lx, ly] = deadzoneStick(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0));
  const [rx, ry] = deadzoneStick(pad.axes[2] ?? 0, -(pad.axes[3] ?? 0));

  out.lx = lx;
  out.ly = ly;
  out.rx = rx;
  out.ry = ry;
  out.lt = trigger(pad, 6);
  out.rt = trigger(pad, 7);
  out.lb = pressed(pad, 4);
  out.rb = pressed(pad, 5);
  out.a = pressed(pad, 0);
  out.b = pressed(pad, 1);
  out.x = pressed(pad, 2);
  out.y = pressed(pad, 3);
  return out;
}

export function gamepadConnected(index = 0): boolean {
  return navigator.getGamepads()[index] != null;
}
