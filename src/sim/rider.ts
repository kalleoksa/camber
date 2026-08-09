import type { InputSnapshot } from '../input/snapshot.ts';
import type { Params } from './params.ts';
import { resetRiderState, type RiderState } from './state.ts';
import { stepAirborne } from './states/airborne.ts';
import { stepBailed } from './states/bailed.ts';
import { stepGrounded } from './states/grounded.ts';
import type { Terrain } from './terrain.ts';
import { dampScalar } from './vec3.ts';

/** One fixed sim step. Pure with respect to everything except `state`. */
export function tick(
  state: RiderState,
  input: InputSnapshot,
  params: Params,
  terrain: Terrain,
  dt: number,
): void {
  state.tick++;

  if (input.y) {
    if (!state.resetLatch) {
      resetRiderState(state);
      state.resetLatch = true;
      return;
    }
  } else {
    state.resetLatch = false;
  }

  state.edge = dampScalar(state.edge, input.lx, params.ground.edgeResponse, dt);
  state.stance = dampScalar(state.stance, input.ly, params.ground.edgeResponse, dt);

  // The baseline takeoff measures the spin whip against — "the carve you are already
  // holding". Its own rate rather than a reuse of `state.edge`, so widening the whip window
  // can't change how a carve feels. Tracked in every mode, not just grounded: parked during
  // an air it would go stale, and a fast re-pop after landing would read a whip that never
  // happened.
  state.spinRef = dampScalar(state.spinRef, input.lx, params.air.spinRefRate, dt);

  switch (state.mode) {
    case 'grounded':
      stepGrounded(state, input, params, terrain, dt);
      break;
    case 'airborne':
      stepAirborne(state, input, params, terrain, dt);
      break;
    case 'bailed':
      stepBailed(state, params, terrain, dt);
      break;
    default:
      // railed and walled arrive in milestones 5 and 6.
      stepAirborne(state, input, params, terrain, dt);
      break;
  }
}
