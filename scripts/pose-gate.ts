/**
 * The milestone 4 acceptance tests, automated. Angle bands in range produced poses that
 * read as a crash three times running, so these check the four things scalar bands miss:
 * that the pose is physically possible, symmetric, reachable, and the right shape.
 *
 * Runs headless in a browser because the rig is Three.js. `npm run gate`.
 */
/**
 * Playwright is deliberately NOT a project dependency — the rig ships no browser
 * automation. Resolved at runtime from a global install, or PLAYWRIGHT_MODULE if it lives
 * somewhere else. Skips rather than fails when it is absent, so `npm run gate` on a machine
 * without it says so instead of looking broken.
 */
const URL = process.env.POSE_GATE_URL ?? 'http://localhost:5199/pose-shot.html';
const BROWSER = process.env.POSE_GATE_BROWSER ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MODULE = process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs';

let chromium;
try {
  ({ chromium } = await import(MODULE));
} catch {
  console.log('SKIP playwright not resolvable — set PLAYWRIGHT_MODULE to run the pose gate');
  process.exit(0);
}

type Geom = {
  elevation: string;
  torsoLean: string;
  boardVsTorso: string;
  aspect: string;
  reachFront: string;
  kneeFront: string;
  kneeBack: string;
  comX: string;
  comY: string;
};

const browser = await chromium.launch({ executablePath: BROWSER });
const page = await browser.newPage({ viewport: { width: 300, height: 220 } });

/** `tweak` is a depth dial now: it moves pelvis pitch and knee flexion, not board attitude. */
async function sample(pose: string, depth: number): Promise<Geom> {
  const pelvisPitch = 0.15 + depth * 0.75;
  const knee = 1.0 + depth * 0.95;
  const q = `pose=${pose}&view=silhouette&pelvisPitch=${pelvisPitch}&kneeFront=${knee + 0.12}&kneeBack=${knee}`;
  await page.goto(`${URL}?${q}`);
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  return (await page.evaluate('window.__geom')) as Geom;
}

const depths = [0, 0.2, 0.4, 0.6, 0.8, 1];
const rows = [];
for (const depth of depths) rows.push({ depth, g: await sample('method', depth) });
await browser.close();

console.log('depth  board  torso  vsTorso  aspect  reach  knees      COM x/y');
for (const { depth, g } of rows) {
  console.log(
    `${depth.toFixed(1)}   ${String(g.elevation).padStart(5)}  ${String(g.torsoLean).padStart(5)}  ` +
      `${String(g.boardVsTorso).padStart(6)}   ${g.aspect}   ${g.reachFront}  ` +
      `${g.kneeFront}/${g.kneeBack}`.padEnd(10) + ` ${g.comX}/${g.comY}`,
  );
}

const failures: string[] = [];

// 1. COM invariance — sweeping tweak depth must not move the centre of mass more than 5 cm.
const xs = rows.map((r) => Number(r.g.comX));
const ys = rows.map((r) => Number(r.g.comY));
const drift = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
if (drift > 0.05) failures.push(`COM drifts ${(drift * 100).toFixed(1)} cm across the sweep, limit 5`);

// 2. Knee symmetry — divergence at most 10 deg at every depth.
for (const { depth, g } of rows) {
  const div = Math.abs(Number(g.kneeFront) - Number(g.kneeBack));
  if (div > 10) failures.push(`knees diverge ${div}deg at depth ${depth}, limit 10`);
}

// 3. Reach validity — never above 1.0. Above it the hand cannot touch the grab point.
for (const { depth, g } of rows) {
  if (Number(g.reachFront) > 1.0) failures.push(`reach ${g.reachFront} at depth ${depth}, invalid above 1.00`);
}

// 4. Aspect — 1.0..1.3 once the pose is deep. Tall and thin means the rider is folded
//    around the board instead of being the long element.
for (const { depth, g } of rows) {
  if (depth < 0.7) continue;
  const a = Number(g.aspect);
  if (a < 1.0 || a > 1.3) failures.push(`aspect ${g.aspect} at depth ${depth}, want 1.0-1.3`);
}

console.log();
if (failures.length === 0) {
  console.log('PASS all four acceptance tests');
} else {
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exitCode = 1;
}
