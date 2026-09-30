/**
 * The one piece of on-screen text (CLAUDE.md exception): the last trick's name, low and
 * centred, fading out after a couple of seconds. Plain DOM over the canvas, no styling
 * system; off with the panel toggle.
 */
export type TrickText = { show(text: string): void; setEnabled(on: boolean): void };

const HOLD_MS = 1600;

export function createTrickText(): TrickText {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: '12%',
    transform: 'translateX(-50%)',
    font: '600 22px/1.2 system-ui, sans-serif',
    letterSpacing: '0.04em',
    color: '#fff',
    // White on snow needs an edge: a dark outline plus a soft shadow reads on sky and snow alike.
    textShadow: '0 0 2px rgba(10,14,20,0.9), 0 1px 2px rgba(10,14,20,0.9), 0 2px 10px rgba(10,14,20,0.55)',
    webkitTextStroke: '0.6px rgba(10,14,20,0.55)',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.6s ease-out',
    whiteSpace: 'nowrap',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  let enabled = true;
  let timer = 0;
  return {
    show(text) {
      if (!enabled) return;
      el.textContent = text;
      el.style.transition = 'none';
      el.style.opacity = '1';
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        el.style.transition = 'opacity 0.6s ease-out';
        el.style.opacity = '0';
      }, HOLD_MS);
    },
    setEnabled(on) {
      enabled = on;
      if (!on) el.style.opacity = '0';
    },
  };
}
