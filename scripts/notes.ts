/**
 * Read tester feedback (docs/feedback.md): `node scripts/notes.ts <file.json[.gz]> ...`,
 * or no arguments for everything in feedback/incoming/.
 *
 * Each marked run is re-simulated and checked against its own hashes, so a file from
 * another build is flagged instead of quietly replaying something else. Around every note
 * it prints what the rider did and what the sim did: mode changes and landings in the
 * window, then a coarse timeline of speed, mode and stick.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { simulateTake, verifyTake, type Feedback, type Note } from '../src/input/recorder.ts';

const WINDOW = 1.5; // s either side of a note
const STEP = 0.25; // s between timeline rows

const dir = 'feedback/incoming';
const files = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(dir).filter((f) => /\.json(\.gz)?$/.test(f)).map((f) => join(dir, f));
if (files.length === 0) console.log(`no feedback files (looked in ${dir})`);

let head = 'unknown';
try {
  head = execSync('git rev-parse HEAD').toString().trim();
} catch {
  // not a checkout: skip the build check
}

type Row = { t: number; mode: string; speed: number; landing: string; impact: number; lx: number; ly: number; rt: number };

for (const file of files) {
  const raw = readFileSync(file);
  const text = file.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const fb = JSON.parse(text) as Feedback;
  console.log(`\n=== ${file}`);
  console.log(`tester ${fb.tester || '(no name)'} · ${fb.created} · build ${fb.build.slice(0, 7)}${fb.build === head ? '' : `  ≠ HEAD ${head.slice(0, 7)} — check out ${fb.build.slice(0, 7)} to replay exactly`}`);

  fb.runs.forEach((take, r) => {
    const verdict = verifyTake(take);
    console.log(`\n-- run ${r + 1}: ${(take.frames.length / 120).toFixed(1)} s, ${take.notes?.length ?? 0} notes, replay ${verdict.ok ? 'exact' : `DIVERGES @ tick ${verdict.divergedAt} (other build?)`}`);
    const rows: Row[] = [];
    const dt = take.dt;
    simulateTake(take, (tick, s, f) => {
      const v = s.velocity;
      rows.push({ t: tick * dt, mode: s.mode, speed: Math.hypot(v.x, v.y, v.z), landing: s.landing, impact: s.impact, lx: f.lx, ly: f.ly, rt: f.rt });
    });
    for (const note of take.notes ?? []) printNote(note, rows, dt);
  });
}

function printNote(note: Note, rows: Row[], dt: number): void {
  const at = note.tick * dt;
  console.log(`\n  [${note.tag}] @ ${at.toFixed(2)} s: "${note.text || '(no text)'}"`);
  console.log(`    at the mark: ${note.at.mode}, ${note.at.speed} m/s, landing ${note.at.landing}, impact ${note.at.impact}, air ${note.at.airTime} s, spin ${note.at.spinRate}`);
  const from = Math.max(0, Math.floor((at - WINDOW) / dt));
  const to = Math.min(rows.length - 1, Math.ceil((at + WINDOW) / dt));
  // Events: mode changes and landings, exactly where they happened.
  for (let i = Math.max(from, 1); i <= to; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (!a || !b) continue;
    if (a.mode !== b.mode) {
      const land = b.mode === 'grounded' || b.mode === 'walled' || b.mode === 'bailed' ? `, landing ${b.landing}, impact ${b.impact.toFixed(1)} m/s` : '';
      console.log(`    ${(b.t - at >= 0 ? '+' : '')}${(b.t - at).toFixed(2)} s  ${a.mode} → ${b.mode} at ${b.speed.toFixed(1)} m/s${land}`);
    }
  }
  // Timeline: a row every STEP seconds.
  const every = Math.max(1, Math.round(STEP / dt));
  for (let i = from; i <= to; i += every) {
    const x = rows[i];
    if (!x) continue;
    const rel = x.t - at;
    console.log(`      ${rel >= 0 ? '+' : ''}${rel.toFixed(2)}  ${x.mode.padEnd(9)} ${x.speed.toFixed(1).padStart(5)} m/s  stick ${x.lx.toFixed(2).padStart(5)} ${x.ly.toFixed(2).padStart(5)}  rt ${x.rt.toFixed(2)}`);
  }
}
