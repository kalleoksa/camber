import type { InputSnapshot } from '../input/snapshot.ts';
import type { Params } from './params.ts';
import { resetRiderState, type RiderState } from './state.ts';
import { stepAirborne } from './states/airborne.ts';
import { stepBailed } from './states/bailed.ts';
import { stepGrounded } from './states/grounded.ts';
import { stepRailed } from './states/railed.ts';
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

  // Riding switch the sticks follow the direction of travel, not the board: right is the
  // edge on the right of travel (the heel), up presses the leading end (the tail).
  const dir = params.ground.switchEdges > 0 && state.switchRide ? -1 : 1;
  // Spin model 1: winding up (RT held on the snow) puts stick X into the upper body, not the
  // edge — only `windSteer` of it still carves, so the board holds its line into the lip.
  const winding = params.air.spinModel > 0 && input.rt > params.pop.trigger && (state.mode === 'grounded' || state.mode === 'walled');
  const steer = winding ? params.air.windSteer : 1;
  state.edge = dampScalar(state.edge, input.lx * dir * steer, params.ground.edgeResponse, dt);
  state.stance = dampScalar(state.stance, input.ly * dir, params.ground.stanceResponse, dt);

  // The baseline takeoff measures the spin whip against — "the carve you are already
  // holding". Its own rate rather than a reuse of `state.edge`, so widening the whip window
  // can't change how a carve feels. Tracked in every mode, not just grounded: parked during
  // an air it would go stale, and a fast re-pop after landing would read a whip that never
  // happened.
  state.spinRef = dampScalar(state.spinRef, input.lx, params.air.spinRefRate, dt);

  // Spin model 1: the wind-up loads while RT is held, toward wherever the stick is pushed,
  // and unloads on the snow once RT is let go without a pop. Untouched in the air, so the
  // takeoff window still reads it.
  if (params.air.spinModel > 0) {
    const onSnow = state.mode !== 'airborne' && state.mode !== 'bailed';
    if (onSnow && input.rt > params.pop.trigger) {
      // Only ever builds: easing off or crossing over to flick keeps what is loaded.
      const step = dt / Math.max(params.air.windTime, 1e-3);
      const w = state.windUp;
      if (input.lx * w >= 0 && Math.abs(input.lx) > Math.abs(w)) {
        state.windUp = w < input.lx ? Math.min(input.lx, w + step) : Math.max(input.lx, w - step);
      }
    } else if (onSnow && !state.popLatch) {
      state.windUp = dampScalar(state.windUp, 0, params.air.windRelease, dt);
    }
  }

  const wasAir = state.mode === 'airborne';
  switch (state.mode) {
    case 'grounded':
    case 'walled':
      stepGrounded(state, input, params, terrain, dt);
      break;
    case 'airborne':
      stepAirborne(state, input, params, terrain, dt);
      break;
    case 'bailed':
      stepBailed(state, params, terrain, dt);
      break;
    case 'railed':
      stepRailed(state, input, params, terrain, dt);
      break;
  }
  // The spin it loaded is spent: down again, the next wind-up starts from nothing, either way.
  if (wasAir && state.mode !== 'airborne' && params.air.windLandReset > 0) state.windUp = 0;
}
