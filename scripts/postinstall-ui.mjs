/**
 * postinstall: install the nested src/ui package's dependencies after a root
 * `npm install`, so `npm run build` (which runs `npm --prefix src/ui run build`)
 * works out of the box without a separate manual step.
 *
 * Guarded for two cases so it NEVER breaks an install:
 *  1. Published package — `src/ui` is not in `files`, so it is absent. Skip.
 *  2. Real install failure — warn and tell the user how to recover, but exit 0
 *     so the parent install still succeeds.
 *
 * Kept compile-only in the `build` script per the P5-08 build-hygiene rule —
 * dependency installation lives here (on install), not in `build`.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = join(root, 'src', 'ui');

if (!existsSync(join(uiDir, 'package.json'))) {
  // Published package (or no UI present) — nothing to do.
  process.exit(0);
}

try {
  // Use execSync (shell) so the platform resolves `npm` → npm.cmd on Windows;
  // spawning npm.cmd directly via execFile throws EINVAL on modern Node/Windows.
  // uiDir is quoted to survive spaces; it is internal (derived from __dirname),
  // not user input, so there is no injection surface.
  execSync(`npm --prefix "${uiDir}" install --no-audit --no-fund`, {
    stdio: 'inherit',
  });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn('[postinstall] Could not install src/ui dependencies automatically.');
  console.warn(`  ${msg}`);
  console.warn('  Run `npm --prefix src/ui install` manually before `npm run build`.');
  // Never fail the parent install.
  process.exit(0);
}
