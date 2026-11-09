/**
 * The check bot's run down a park's first line, saved as a take to watch in the game:
 * `node scripts/bot-take.ts [park] [out.json]` (default: ridge, bot-take.json). Open the game at
 * the URL it prints, then in the panel: take → load take → replay.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { TICK_DT } from '../src/core/loop.ts';
import { buildTake } from '../src/input/recorder.ts';
import { neutralInput, type InputSnapshot } from '../src/input/snapshot.ts';
import { checkLines } from '../src/park/check.ts';
import { toSlopeConfig, type Layout } from '../src/park/layout.ts';
import { params } from '../src/sim/params.ts';
import { createContact, createSlope } from '../src/sim/terrain.ts';

const park = process.argv[2] ?? 'ridge';
const out = process.argv[3] ?? 'bot-take.json';
const layout = JSON.parse(readFileSync(new URL(`../parks/${park}.json`, import.meta.url), 'utf8')) as Layout;
const cfg = toSlopeConfig(layout);
const terrain = createSlope(cfg);
const frames: InputSnapshot[] = [];
// As the park's own build checks it: the ridge is too steep to ride without braking.
const steep = layout.ground.pitch > 0.2;
const got = checkLines(layout, terrain, params, { ...(steep ? { brake: true, cruise: 23, fromSpawn: true, aim: 140 } : {}), record: frames, drop: 1.5 })[0]?.features ?? [];
for (let i = 0; i < 4 / TICK_DT; i++) frames.push(neutralInput()); // ride out
// The game starts a run at ?at=x,z, 1.5 m above the snow: the same spawn the bot was given.
const first = layout.features[layout.lines[0]?.features[0] ?? 0];
const x = steep ? layout.spawn.x : first?.kind === 'rail' ? (first.cfg.points[0]?.[0] ?? 0) : ((first?.cfg as { x?: number } | undefined)?.x ?? 0);
const z = layout.spawn.z;
const spawn = { position: { x, y: terrain.sample(x, z, createContact()).height + 1.5, z }, heading: Math.PI };
writeFileSync(out, JSON.stringify(buildTake({ seed: 1, dt: TICK_DT, spawn, terrain: cfg, params, frames })));
for (const c of got) console.log(`${c.type} at z ${c.z.toFixed(0)}: ${(c.at * 3.6).toFixed(0)} km/h, ${c.how}`);
console.log(`${frames.length} ticks (${(frames.length * TICK_DT).toFixed(0)} s) → ${out} · open ?park=${layout.name}&at=${x},${z}`);
