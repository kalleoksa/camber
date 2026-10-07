import type { Params } from '../sim/params.ts';
import type { RiderView } from './scene.ts';

/**
 * The speed check, drawn: on the snow with L2 held the back foot pushes the tail round under
 * the body — the board pivots on the front binding, the upper body stays facing down the line
 * — and brakes on the uphill edge: a frontside shift on the heels, a backside shift on the
 * toes, whichever edge you were on as it starts (heels if flat). Spray comes off that edge,
 * and the tail comes back in line as you let go. Only the drawn rider changes; the sim's
 * brake is the same with or without it.
 */
export type Skid = { apply(view: RiderView, params: Params, dt: number): void };

export function createSkid(): Skid {
  let amount = 0; // 0..1, eased
  let side = 1; // +1 frontside shift, on the heels (tail pushed toward the toes); −1 backside, on the toes
  return {
    apply(view, params, dt) {
      const r = params.rig;
      const on = view.mode === 'grounded' && view.speed > 2 && r.skidYaw > 0;
      // Two sticks: the right stick's skid, signed — pushed toward the toes, the tail goes
      // toward the toes (a frontside shift, on the heels). LT has no side; it takes the edge's.
      const two = params.input.scheme > 0;
      const target = on ? Math.abs(view.brake) : 0;
      amount += (target - amount) * (1 - Math.exp(-r.skidRate * dt));
      if (amount < 1e-3) {
        // Pick the side afresh for the next check: the edge you're on when it starts.
        side = view.edge > 0.15 ? -1 : 1;
        return;
      }
      if (two && view.brake !== 0) side = view.brake > 0 ? 1 : -1;
      view.shifty += side * r.skidYaw * amount;
      view.shiftPivot = 1;
      view.edge = view.edge * (1 - amount) + -side * r.skidEdge * amount;
      view.scrub = Math.max(view.scrub, r.skidSpray * view.speed * amount);
    },
  };
}
