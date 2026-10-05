import type { Params } from '../sim/params.ts';
import type { RiderView } from './scene.ts';

/**
 * The speed check, drawn: on the snow with L2 held the board swings across the line of travel
 * — toward the edge you're on, heelside if neither — the edge digs in and spray comes off it,
 * and it swings back in line as you let go. Only the drawn rider changes; the sim's brake is
 * the same with or without it.
 */
export type Skid = { apply(view: RiderView, params: Params, dt: number): void };

export function createSkid(): Skid {
  let amount = 0; // 0..1, eased
  let side = 1; // +1 heelside (nose swings toward the heel side), −1 toeside
  return {
    apply(view, params, dt) {
      const r = params.rig;
      const on = view.mode === 'grounded' && view.speed > 2 && r.skidYaw > 0;
      const target = on ? view.brake : 0;
      amount += (target - amount) * (1 - Math.exp(-r.skidRate * dt));
      if (amount < 1e-3) {
        // Pick the side afresh for the next check: the edge you're on when it starts.
        side = view.edge > 0.15 ? -1 : 1;
        return;
      }
      view.heading += side * r.skidYaw * amount;
      view.edge = view.edge * (1 - amount) + -side * r.skidEdge * amount;
      view.scrub = Math.max(view.scrub, r.skidSpray * view.speed * amount);
    },
  };
}
