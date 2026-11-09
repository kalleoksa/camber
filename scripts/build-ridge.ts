/**
 * The ridge park: `node scripts/build-ridge.ts` writes parks/ridge.json, the game's default park.
 * A mountain, not a field: steep ground shaped by ridges and gullies (heightfield.ts `forms`),
 * ridden fast, with park features built into it.
 *
 * Top down: a ridge to ride along, its crest rolling, the ground falling away on both sides and
 * two spurs branching off it; the ridge ends in a drop into a gully that winds down the hill
 * between its own walls, crossed by two humps with a kicker on each, landing down the hump's
 * back; then the big kicker, hit at the speed the hill gives, on a deck above a 60 m face that is
 * its landing; and a bowl of quarter pipes.
 *
 * Every number is in RIDGE below. The hill is too steep to ride without braking, so the check
 * bot (src/park/check.ts) scrubs speed into each feature as a rider would and holds `cruise`
 * between them. It rides one line, from the spawn along the ridge and down the gully; everything off that line is placed,
 * not checked.
 */
import { writeFileSync } from 'node:fs';
import { GEN, type GenConfig } from '../src/gen/config.ts';
import type { Size } from '../src/gen/kit.ts';
import { group, redesign, type Kind } from '../src/gen/lines.ts';
import { checkLines, failed } from '../src/park/check.ts';
import { toSlopeConfig, type FeatureSpec, type Layout, type LineSpec } from '../src/park/layout.ts';
import { buildField, type FieldConfig, type FormConfig } from '../src/sim/heightfield.ts';
import { params } from '../src/sim/params.ts';
import { createContact, createSlope, type Terrain } from '../src/sim/terrain.ts';

const RAD = Math.PI / 180;

type Spot = { kind: Kind | 'panel'; x: number; z: number; yaw?: number; size?: Size; big?: boolean; inputs?: Record<string, number>; cfg?: Record<string, number>; line?: boolean };

const RIDGE = {
  length: 910, // m down the hill
  width: 320, // m across
  pitch: 15, // ° of the hill under everything
  cell: 1, // m between heightfield nodes
  bank: { width: 70, height: 26 }, // the valley's sides
  noise: { amp: 1.6, wavelength: 80, octaves: 3 }, // m of roll in the ground everywhere
  // Below the gully, the big kicker's ground, full width: a deck that carries it and 25 m of
  // table past its lip, then a long steep face. The table matters as much as the face: where the
  // ground falls away right after the lip, a rider drops for 4–5 s and comes in far steeper than
  // any landing. At hill speed touchdowns spread over 40 m, so the face is 80.
  // The face steepens as it goes, like the flight does: a rider who goes further comes in steeper.
  big: { z: -640, blend: 8, segs: [[60, 6], [22, 28], [26, 40], [36, 45], [45, 7]] as [number, number][] }, // [length m, grade °]: deck, face in three, run-out
  // The kicker itself: hit at the speed the hill gives (m/s), wide. The editor re-solves a kicker
  // at the kit's own sizes, so editing this one there shrinks it.
  bigKicker: { lip: 4, speed: [18, 22], width: 10, landingExtra: 12 },
  bowl: { length: 75, pitch: 1 },
  start: -6, // z the rider spawns at, on the ridge
  cruise: 23, // m/s the check bot holds between features (83 km/h)
  aim: 140, // m before a feature the bot starts lining up on it; until then the ridge and the gully carry it
  // Ridges (+) and gullies (−): [x, z, height m] down each path, held `halfWidth` m either side
  // and falling away over `skirt` m.
  forms: [
    // The ridge: its crest rolls between 10 and 13 m, and ends in a drop.
    { halfWidth: 5, skirt: 26, points: [[0, 20, 6], [0, -20, 10], [2, -65, 12.5], [-2, -100, 10], [3, -135, 13], [0, -170, 10.5], [0, -200, 12], [0, -222, 12]] },
    // Spurs off it, one each way, fading out into the side valleys.
    { halfWidth: 4, skirt: 20, points: [[-4, -92, 9], [-30, -124, 7], [-60, -172, 0]] },
    { halfWidth: 4, skirt: 20, points: [[4, -148, 9], [32, -184, 6], [62, -236, 0]] },
    // The gully, winding between its walls.
    { halfWidth: 9, skirt: 32, points: [[0, -258, 0], [0, -290, -8], [16, -345, -9], [-16, -410, -9], [12, -475, -9], [0, -540, -7], [0, -585, 0]] },
    // Humps across it: ride up one side, land down the other.
    { halfWidth: 3, skirt: 18, points: [[-22, -366, 4], [14, -370, 7], [48, -366, 4]] },
    { halfWidth: 3, skirt: 18, points: [[-46, -462, 4], [-8, -466, 7], [26, -462, 4]] },
    // Banks either side of the big kicker, from the gully's mouth down past its landing: the
    // gully's walls carried on, so the kicker stands in a dip between them and not on an open deck.
    { halfWidth: 4, skirt: 18, points: [[-30, -565, 0], [-34, -610, 6], [-34, -680, 8], [-37, -745, 7], [-40, -805, 0]] },
    { halfWidth: 4, skirt: 18, points: [[30, -565, 0], [34, -610, 6], [34, -680, 8], [37, -745, 7], [40, -805, 0]] },
  ] as FormConfig[],
  spots: [
    // On the line the bot rides: a kicker up each hump, then the big one.
    { kind: 'kicker', x: 14, z: -338, size: 'L', line: true },
    { kind: 'kicker', x: -8, z: -434, size: 'L', line: true },
    { kind: 'kicker', x: 0, z: -659, size: 'XL', big: true, line: true },
    // Natural hits on the gully's walls, turned across it; a wall to ride on one of them.
    { kind: 'sideHit', x: 34, z: -400, yaw: -40, inputs: { height: 1.5, width: 5 } },
    { kind: 'sideHit', x: -32, z: -505, yaw: 40, inputs: { height: 1.5, width: 5 } },
    { kind: 'panel', x: 30, z: -430, yaw: 14, cfg: { length: 18, height: 3, lean: 12, foot: 0.4, rampLength: 3, side: -1 } },
    // Side hits off the ridge's shoulders, out into the valleys beside it.
    { kind: 'sideHit', x: -9, z: -60, yaw: 55, inputs: { height: 1.2, width: 5 } },
    { kind: 'sideHit', x: 9, z: -118, yaw: -55, inputs: { height: 1.2, width: 5 } },
    // The bowl across the bottom.
    { kind: 'quarter', x: -46, z: -872, inputs: { width: 44, height: 4, radius: 4.5 } },
    { kind: 'hipQuarter', x: 6, z: -874, inputs: { left: 0, outside: 0, width: 16, angle: 45, height: 4, radius: 4.5 } },
    { kind: 'quarter', x: 48, z: -872, inputs: { width: 44, height: 4.5, radius: 5 } },
  ] as Spot[],
};

function field(): FieldConfig {
  const R = RIDGE;
  return {
    pitch: R.pitch * RAD,
    width: R.width,
    length: R.length,
    cell: R.cell,
    bankWidth: R.bank.width,
    bankHeight: R.bank.height,
    noise: { seed: 3, ...R.noise },
    patches: [
      { x: 0, z: R.big.z, yaw: 0, halfWidth: R.width, edge: 1, blend: R.big.blend, segs: [...R.big.segs.map(([len, deg]): [number, number] => [len, deg * RAD]), [R.bowl.length + 40, R.bowl.pitch * RAD]] },
    ],
    forms: R.forms,
  };
}

const f = field();
const baked = buildField(f);
const ground = { length: RIDGE.length, width: RIDGE.width, pitch: f.pitch, field: f };
const spawn = { x: 0, z: RIDGE.start, heading: Math.PI };
const layoutOf = (features: FeatureSpec[], lines: LineSpec[]): Layout => ({ version: 1, name: 'ridge', ground, spawn, features, lines, links: [] });
const terrainOf = (features: FeatureSpec[]): Terrain => createSlope(toSlopeConfig(layoutOf(features, [])), baked);
const bare = terrainOf([]);
const contact = createContact();

const BIG = { ...GEN, kicker: { ...GEN.kicker, width: RIDGE.bigKicker.width, landingExtra: RIDGE.bigKicker.landingExtra, sizes: { ...GEN.kicker.sizes, XL: { lip: RIDGE.bigKicker.lip, speed: RIDGE.bigKicker.speed } } } } as GenConfig;

function make(s: Spot): FeatureSpec[] {
  const yaw = (s.yaw ?? 0) * RAD;
  const c = s.cfg ?? {};
  if (s.kind === 'panel') {
    return [{ kind: 'panel', cfg: { x: s.x, z: s.z, yaw, length: c.length ?? 20, height: c.height ?? 2.5, lean: (c.lean ?? 8) * RAD, side: c.side === -1 ? -1 : 1, foot: c.foot ?? 0.5, ramp: { height: c.foot ?? 0.5, length: c.rampLength ?? 3 } }, meta: { type: 'wallRide' } }];
  }
  const size = s.size ?? 'S';
  const cfg = s.big ? BIG : GEN;
  const speed = s.kind === 'kicker' ? cfg.kicker.sizes[size].speed : [0, 99];
  // The kit's own design, solved over the ground as it is, kept so the editor can change it.
  return redesign({ kind: s.kind, place: { x: s.x, z: s.z, yaw }, size, speed: [speed[0] ?? 0, speed[1] ?? 99], inputs: { ...(s.inputs ?? {}) } }, bare, cfg, params);
}

const features: FeatureSpec[] = [];
const line: LineSpec = { name: 'ridge to gully', features: [], speed: [] };
for (const s of RIDGE.spots) {
  const parts = make(s);
  if (parts.length === 0) throw new Error(`${s.kind} at ${s.x}, ${s.z}: the kit built nothing here`);
  if (!s.line) for (const p of parts) p.meta = { ...(p.meta ?? { type: p.kind }), fill: true };
  group(parts, features.length);
  if (s.line) {
    line.features.push(features.length);
    line.speed.push(0);
  }
  features.push(...parts);
}

let failures = 0;
const got = checkLines(layoutOf(features, [line]), terrainOf(features), params, { brake: true, cruise: RIDGE.cruise, fromSpawn: true, aim: RIDGE.aim })[0]?.features ?? [];
console.log(line.name);
got.forEach((c, i) => {
  line.speed[i] = Math.round(c.at * 100) / 100;
  if (failed(c)) failures++;
  if (features[c.feature]?.cfg && RIDGE.spots.some((sp) => sp.big)) for (const k of features[c.feature]?.meta?.checks ?? []) if (c.design[1] > 20) console.log(`      designed ${(k.speed * 3.6).toFixed(0)} km/h pop ${k.pop.toFixed(1)}: ${k.grade}, impact ${k.impact.toFixed(1)}, ${k.past.toFixed(0)} m past the knuckle`);
  console.log(`  ${c.type} ${features[c.feature]?.meta?.size ?? ''} at z ${c.z.toFixed(0)}: ${c.at.toFixed(1)} m/s (${(c.at * 3.6).toFixed(0)} km/h, design ${c.design.join('–')}) ${c.ok ? 'ok' : 'OUT'}, ${c.how}`);
});
if (got.length < line.features.length) {
  failures++;
  console.log(`  stopped after ${got.length} of ${line.features.length}`);
}
const top = bare.sample(0, 0, contact).height;
console.log(`drop ${(top - bare.sample(0, -RIDGE.length, contact).height).toFixed(0)} m over ${RIDGE.length} m · ${features.length} parts`);
console.log(failures ? `${failures} failed` : 'all passed');
if (failures) process.exitCode = 1;

writeFileSync(new URL('../parks/ridge.json', import.meta.url), JSON.stringify(layoutOf(features, [line]), null, 1) + '\n');
