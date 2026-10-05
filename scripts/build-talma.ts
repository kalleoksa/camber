/**
 * The Talma-style reference park (docs/talma-reference-park.md), built as a layout:
 * `node scripts/build-talma.ts` writes parks/talma-reference.json, which the game loads as its
 * default park. Every number is in TALMA below; the script only places and solves. Left to
 * right as you ride down (+X is the rider's right): groomed run, lifts, jump line, rail line 1,
 * rail line 2.
 */
import { writeFileSync } from 'node:fs';
import * as dm from '../src/sim/dmath.ts';
import type { FieldConfig, PatchConfig } from '../src/sim/heightfield.ts';
import type { Layout } from '../src/park/layout.ts';

const RAD = Math.PI / 180;

const TALMA = {
  length: 400, // m down the hill
  width: 110, // m across, banks included
  pitch: 9, // ° base grade: the jump line and the groomed run ride on it
  cell: 1, // m between heightfield nodes: terrace knuckles need it fine
  bank: { width: 10, height: 3 },
  top: { length: 30, pitch: 4 }, // flatter strip at the start, full width
  bottom: { length: 35, pitch: 3 }, // run-out at the bottom, full width
  x: { groomed: -30, lifts: -8, jump: 3, rail1: 22.5, rail2: 37.5 }, // m, line centres
  // Rail lines: terraces — near-flat decks, steep drops. Each drop is as long as it takes to
  // give back what its deck saves against the base grade, so the terraces end level with it.
  terrace: { start: -40, count: 10, deck: 25, deckPitch: 2, dropPitch: 30, blend: 4, halfWidth: 13, edge: 8 },
};

function field(): FieldConfig {
  const T = TALMA;
  const base = dm.tan(T.pitch * RAD);
  const t = T.terrace;
  const deckGrade = dm.tan(t.deckPitch * RAD);
  const dropGrade = dm.tan(t.dropPitch * RAD);
  const drop = (t.deck * (base - deckGrade)) / (dropGrade - base);
  const segs: [number, number][] = [];
  for (let i = 0; i < t.count; i++) segs.push([t.deck, t.deckPitch * RAD], [drop, t.dropPitch * RAD]);
  const patches: PatchConfig[] = [
    { x: 0, z: 0, yaw: 0, halfWidth: T.width, edge: 1, blend: 10, segs: [[T.top.length, T.top.pitch * RAD]] },
    { x: (T.x.rail1 + T.x.rail2) / 2, z: t.start, yaw: 0, halfWidth: t.halfWidth, edge: t.edge, blend: t.blend, segs },
    { x: 0, z: -(T.length - T.bottom.length), yaw: 0, halfWidth: T.width, edge: 1, blend: 10, segs: [[T.bottom.length + 40, T.bottom.pitch * RAD]] },
  ];
  return {
    pitch: T.pitch * RAD,
    width: T.width,
    length: T.length,
    cell: T.cell,
    bankWidth: T.bank.width,
    bankHeight: T.bank.height,
    noise: { seed: 1, amp: 0, wavelength: 50, octaves: 0 },
    patches,
  };
}

/** Where the deck of terrace `i` starts, and the drop after it (z, downhill negative). */
export function terraceAt(i: number): { deck: number; drop: number; dropLength: number } {
  const t = TALMA.terrace;
  const base = dm.tan(TALMA.pitch * RAD);
  const dropLength = (t.deck * (base - dm.tan(t.deckPitch * RAD))) / (dm.tan(t.dropPitch * RAD) - base);
  const deck = t.start - i * (t.deck + dropLength);
  return { deck, drop: deck - t.deck, dropLength };
}

const f = field();
const layout: Layout = {
  version: 1,
  name: 'talma',
  ground: { length: TALMA.length, width: TALMA.width, pitch: f.pitch, field: f },
  spawn: { x: TALMA.x.jump, z: -5, heading: Math.PI },
  features: [],
  lines: [],
  links: [],
};

writeFileSync(new URL('../parks/talma-reference.json', import.meta.url), JSON.stringify(layout, null, 1) + '\n');
console.log(`parks/talma-reference.json: ${layout.features.length} features`);
