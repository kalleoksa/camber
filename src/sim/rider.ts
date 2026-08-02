import type { InputSnapshot } from '../input/snapshot.ts';
import type { Params } from './params.ts';
import { resetRiderState, type RiderState } from './state.ts';
import { stepAirborne } from './states/airborne.ts';
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
  state.compress = dampScalar(state.compress, input.rt, params.ground.edgeResponse, dt);

  switch (state.mode) {
    case 'grounded':
      stepGrounded(state, input, params, terrain, dt);
      break;
    case 'airborne':
      stepAirborne(state, params, terrain, dt);
      break;
    default:
      // railed / walled / bailed arrive in milestones 5, 6 and 3.
      stepAirborne(state, params, terrain, dt);
      break;
  }
}
