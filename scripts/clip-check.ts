/**
 * Outfit clip check (docs/rider-look.md). `npm run dev`, then `npm run clip`.
 *
 * Poses the dressed rig through every anchor and along every grab transition, and reports
 * from the real mesh vertices how far the thigh tops stick out through the jacket skirt and
 * how far the pants reach below the deck. Rigid pieces can't drape, so a lifted leg in a
 * deep grab still shows some hip poke — that is the case the skinned lower body (phase 2)
 * exists for; the numbers say whether it's needed.
 *
 * Playwright is not a project dependency: resolved at runtime, skipped when absent.
 */
const URL = process.env.CLIP_URL ?? 'http://localhost:5173/clip-check.html';
const BROWSER = process.env.POSE_GATE_BROWSER ?? '/opt/pw-browsers/chromium';
const MODULE = process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs';

type Row = { pose: string; hip: number; deck: number; at?: number };

let chromium: { launch(o: object): Promise<{ newPage(): Promise<unknown>; close(): Promise<void> }> };
try {
  ({ chromium } = await import(MODULE));
} catch {
  console.log('SKIP playwright not resolvable — set PLAYWRIGHT_MODULE to run the clip check');
  process.exit(0);
}

const browser = await chromium.launch({ executablePath: BROWSER, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = (await browser.newPage()) as {
  goto(u: string): Promise<unknown>;
  waitForFunction(f: string, a?: unknown, o?: object): Promise<unknown>;
  evaluate(f: string): Promise<unknown>;
};
await page.goto(URL);
await page.waitForFunction('window.__done === true', undefined, { timeout: 30000 });
const rows = (await page.evaluate('window.__rows')) as Row[];
await browser.close();

const cm = (m: number): string => (m * 100).toFixed(1).padStart(5);
console.log('pose                 hip poke  below deck');
for (const r of rows) {
  const at = r.at !== undefined && r.hip > 0.005 ? `  (worst at blend ${r.at.toFixed(2)})` : '';
  console.log(`${r.pose.padEnd(20)} ${cm(r.hip)} cm   ${cm(r.deck)} cm${at}`);
}
