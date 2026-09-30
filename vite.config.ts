import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// The commit this build is from, stamped into feedback files so a tester's run is replayed
// on the code that recorded it. Vercel provides it; locally, ask git.
function commit(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  server: { host: true },
  build: { target: 'es2022' },
  define: { __BUILD__: JSON.stringify(commit()) },
});
