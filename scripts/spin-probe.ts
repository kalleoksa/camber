import { neutralInput } from '../src/input/snapshot.ts';
import { params } from '../src/sim/params.ts';
import { tick } from '../src/sim/rider.ts';
import { createRiderState } from '../src/sim/state.ts';
import { createContact, createSlope, type SlopeConfig } from '../src/sim/terrain.ts';

/**
 * What rotation comes out for what input, headless. Spin is the one thing you cannot read
 * off a slider — it only exists as degrees-at-landing — so this prints the table instead.
 * Run it after touching anything in `air`.
 */
const DT = 1 / 120;
const slopeConfig: SlopeConfig = { length: 400, width: 120, pitch: 0.28 };
const terrain = createSlope(slopeConfig);

/**
 * Ride the fall line, hold `carve`, charge the pop, optionally whip the stick to `whipTo`
 * and wait `whipHoldS`, release RT, then hold `airLx` until touchdown.
 */
function run(opts: { carve: number; whipTo?: number; whipHoldS?: number; airLx?: number }) {
  const state = createRiderState({
    position: { x: 0, y: terrain.sample(0, 0, createContact()).height, z: 0 },
    heading: Math.PI,
  });
  const input = neutralInput();

  for (let i = 0; i < 360; i++) tick(state, input, params, terrain, DT); // build speed
  input.lx = opts.carve;
  for (let i = 0; i < 90; i++) tick(state, input, params, terrain, DT); // settle the carve

  input.rt = 1;
  for (let i = 0; i < Math.round(params.pop.chargeTime / DT); i++) tick(state, input, params, terrain, DT);
  if (opts.whipTo !== undefined) {
    input.lx = opts.whipTo;
    for (let i = 0; i < Math.round((opts.whipHoldS ?? 0) / DT); i++) tick(state, input, params, terrain, DT);
  }

  input.rt = 0; // the pop fires on this tick, and takeoff() reads the stick here
  tick(state, input, params, terrain, DT);
  const spinAtTakeoff = state.spinRate;

  input.lx = opts.airLx ?? input.lx;
  let ticks = 0;
  while (state.mode === 'airborne' && ticks < 2000) {
    tick(state, input, params, terrain, DT);
    ticks++;
  }
  return {
    spinAtTakeoff,
    airTime: ticks * DT,
    degrees: (state.airYaw * 180) / Math.PI,
    landing: state.landing,
  };
}

function row(label: string, r: ReturnType<typeof run>): void {
  console.log(
    `${label.padEnd(9)}${r.spinAtTakeoff.toFixed(2).padStart(6)} rad/s  ` +
      `${r.degrees.toFixed(0).padStart(4)}°   ${r.landing}`,
  );
}

const a = params.air;
console.log(
  `spinTakeoff=${a.spinTakeoff} spinCarveReject=${a.spinCarveReject} ` +
    `spinRefRate=${a.spinRefRate} spinArmBand=${a.spinArmBand} authority=${a.authority}`,
);
console.log(`airtime at full charge: ${run({ carve: 0 }).airTime.toFixed(2)} s`);

// The bug this guards: a carve must not be read as asking for a spin.
console.log('\nPop out of a steady carve, thumb unmoved — every row should be ~0°:');
console.log('carve    spin@takeoff  rotated  landing');
for (const carve of [0, 0.25, 0.5, 0.75, 1]) row(carve.toFixed(2), run({ carve, airLx: carve }));

console.log('\nWhip depth, released immediately — half whip should be a 180:');
console.log('whip to  spin@takeoff  rotated  landing');
for (const whipTo of [0.25, 0.5, 0.75, 1]) row(whipTo.toFixed(2), run({ carve: 0, whipTo }));

console.log('\nWhip then wait: how long you hold before popping meters the rotation down:');
console.log('hold     spin@takeoff  rotated  landing');
for (const whipHoldS of [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5]) {
  row(`${(whipHoldS * 1000).toFixed(0)}ms`, run({ carve: 0, whipTo: 1, whipHoldS }));
}

console.log('\nWhipping across centre out of a full toe carve — spinning the other way:');
console.log('whip to  spin@takeoff  rotated  landing');
for (const whipTo of [0, -0.5, -1]) row(whipTo.toFixed(2), run({ carve: 1, whipTo }));
