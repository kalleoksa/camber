import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as d from '../src/sim/dmath.ts';

/**
 * Two checks for cross-machine determinism:
 * 1. Nothing under src/sim calls an engine-approximated Math function — they differ in
 *    the last bit between ARM and x86 builds of the same browser.
 * 2. dmath stays close to Math.* (accuracy, not determinism — that holds by construction).
 */
const failures: string[] = [];

const BANNED = /Math\.(exp|expm1|log|log1p|log2|log10|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|cbrt|hypot)\b/;
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const simDir = new URL('../src/sim', import.meta.url).pathname;
for (const file of walk(simDir)) {
  if (file.endsWith('dmath.ts')) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (BANNED.test(line) && !line.trim().startsWith('*') && !line.trim().startsWith('//')) {
        failures.push(`${file.slice(simDir.length - 7)}:${i + 1} uses ${line.match(BANNED)?.[0]} — use dmath`);
      }
    });
}

// Units in the last place between a and b.
const f = new Float64Array(2);
const b = new BigInt64Array(f.buffer);
function ulps(a: number, e: number): number {
  if (a === e) return 0;
  f[0] = a;
  f[1] = e;
  const ia = (b[0] ?? 0n) < 0n ? -((b[0] ?? 0n) & 0x7fffffffffffffffn) : (b[0] ?? 0n);
  const ie = (b[1] ?? 0n) < 0n ? -((b[1] ?? 0n) & 0x7fffffffffffffffn) : (b[1] ?? 0n);
  const diff = ia - ie;
  return Number(diff < 0n ? -diff : diff);
}

// Seeded, so the check itself is reproducible.
let seed = 12345;
const rand = (): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

type Case = [string, (x: number, y: number) => number, (x: number, y: number) => number, () => [number, number], number];
const cases: Case[] = [
  ['exp', d.exp, Math.exp, () => [(rand() - 0.5) * 60, 0], 2],
  ['log', d.log, Math.log, () => [rand() * 1e3 + 1e-9, 0], 2],
  // exp(y·log x): the rounding of y·log x is amplified by |y·log x| ulps (~1e-14 relative).
  ['pow', d.pow, Math.pow, () => [rand(), 0.5 + rand() * 3], 64],
  ['sin', d.sin, Math.sin, () => [(rand() - 0.5) * 40, 0], 2],
  ['cos', d.cos, Math.cos, () => [(rand() - 0.5) * 40, 0], 2],
  ['tan', d.tan, Math.tan, () => [(rand() - 0.5) * 3, 0], 4],
  ['atan2', d.atan2, Math.atan2, () => [(rand() - 0.5) * 10, (rand() - 0.5) * 10], 4],
  ['acos', d.acos, Math.acos, () => [rand() * 2 - 1, 0], 4],
];
for (const [name, mine, ref, gen, limit] of cases) {
  let worst = 0;
  let at = 0;
  for (let i = 0; i < 200000; i++) {
    const [x, y] = gen();
    const u = ulps(mine(x, y), ref(x, y));
    if (u > worst) {
      worst = u;
      at = x;
    }
  }
  const line = `${name.padEnd(6)} worst ${worst} ulp${worst > limit ? ` at ${at}` : ''}`;
  if (worst > limit) failures.push(line);
  else console.log(`ok  ${line}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
