/**
 * The controls sheet (agreed exception to "no UI chrome", like the trick name): a small "?"
 * button, H, or the pad's touchpad opens it over the game, which pauses while it is open.
 * Plain DOM over the canvas, closed by any of the same or a click.
 */
export type ControlsHelp = { toggle(): void; isOpen(): boolean };

const ROWS: [string, string, string][] = [
  ['Carve', 'Left stick ← →', 'A / D'],
  ['Nose / tail press', 'Left stick ↑ ↓', 'W / S'],
  ['Butter 180', 'Press nose or tail + edge (diagonal), hold ~1 s', 'W/S + A/D'],
  ['Speed check', 'L2 / LT', 'Shift'],
  ['Crouch, then pop', 'Hold R2 / RT, release', 'Space'],
  ['Wind up a spin', 'While crouching, left stick against the spin', 'A / D'],
  ['Send the spin', 'At the pop, left stick toward the spin (diagonal: cork)', 'A / D'],
  ['Spin faster / slower', 'In the air, left stick toward / against the spin', 'A / D'],
  ['Flip', 'At the pop, left stick ↑ / ↓', 'W / S'],
  ['Shifty', 'L1 / R1 alone, in the air', 'Q / E'],
  ['Grab', 'Hold L1 (left hand) or R1 (right hand) + right stick', 'Q / E + arrows'],
  ['Tweak', 'Push the right stick all the way', '+ Shift'],
  ['Rail slide', 'L1 / R1 on a rail', 'Q / E'],
  ['Reset', 'Triangle / Y', 'R'],
  ['Pause', 'Options / Start', 'P'],
  ['Mark a moment', 'Create / View (D-pad: good, bad, bug, looks off)', 'M'],
  ['This sheet', 'Touchpad', 'H'],
];

const GRABS: [string, string, string][] = [
  ['↑', 'nosegrab', 'crail'],
  ['→ toes', 'mute (full push: japan)', 'indy'],
  ['↓', 'seatbelt', 'tailgrab'],
  ['↙', 'chicken salad', '—'],
  ['← heels', 'melon', 'stalefish'],
  ['↖', 'method', 'roast beef'],
];

const table = (head: string[], rows: string[][]): string =>
  `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</table>`;

export function createControlsHelp(onChange: (open: boolean) => void): ControlsHelp {
  const style = document.createElement('style');
  style.textContent = `
    #controls-btn { position: fixed; left: 12px; top: 12px; z-index: 1; width: 32px; height: 32px;
      border-radius: 16px; border: 0; background: rgba(10,14,20,0.45); color: #fff;
      font: 600 17px system-ui, sans-serif; cursor: pointer; }
    #controls-sheet { position: fixed; inset: 0; z-index: 1000; display: none; overflow: auto;
      background: rgba(10,14,20,0.82); color: #e8edf2; font: 14px/1.35 system-ui, sans-serif;
      padding: 24px 16px; box-sizing: border-box; }
    #controls-sheet .wrap { max-width: 760px; margin: 0 auto; }
    #controls-sheet h2 { font-size: 15px; letter-spacing: 0.06em; text-transform: uppercase;
      color: #9fb2c4; margin: 18px 0 6px; }
    #controls-sheet table { border-collapse: collapse; width: 100%; }
    #controls-sheet th { text-align: left; color: #9fb2c4; font-weight: 600; padding: 4px 8px; }
    #controls-sheet td { padding: 4px 8px; border-top: 1px solid rgba(255,255,255,0.08); vertical-align: top; }
    #controls-sheet td:first-child { white-space: nowrap; color: #fff; }
    #controls-sheet .hint { color: #9fb2c4; margin-top: 18px; }
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.id = 'controls-btn';
  button.textContent = '?';
  button.title = 'Controls (H)';
  // Never takes focus: Space is the pop, and a focused button would turn it into a click.
  button.tabIndex = -1;
  button.addEventListener('mousedown', (ev) => ev.preventDefault());
  document.body.appendChild(button);

  const sheet = document.createElement('div');
  sheet.id = 'controls-sheet';
  sheet.innerHTML = `<div class="wrap">
    <h2>Controls — paused</h2>
    ${table(['', 'Gamepad', 'Keyboard'], ROWS)}
    <h2>Grabs — L1 / R1 + right stick</h2>
    ${table(['Stick', 'L1 · left (front) hand', 'R1 · right (back) hand'], GRABS)}
    <p class="hint">Riding switch nothing mirrors: same buttons, same grab. Click, H, Esc or the touchpad to close.</p>
  </div>`;
  document.body.appendChild(sheet);

  let open = false;
  const toggle = (): void => {
    open = !open;
    sheet.style.display = open ? 'block' : 'none';
    onChange(open);
  };
  button.addEventListener('click', toggle);
  sheet.addEventListener('click', toggle);
  addEventListener('keydown', (ev) => {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (ev.key === 'h' || ev.key === 'H' || (open && ev.key === 'Escape')) toggle();
  });
  return { toggle, isOpen: () => open };
}
