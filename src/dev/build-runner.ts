import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Sentinel substituted for a build-id component when the underlying file is absent. */
const MISSING_SENTINEL = 'missing';

/** Files whose {size,mtimeMs} make up the build fingerprint, relative to the dist root. */
const BUILD_ID_INPUTS = ['ui/index.html', 'cli.js'] as const;

/**
 * Derive a stable short id for a built `dist` directory.
 *
 * Hashes the `{size,mtimeMs}` of `dist/ui/index.html` and `dist/cli.js`. Missing files contribute a
 * `"missing"` sentinel rather than throwing, so the id is always computable even on a clean checkout.
 *
 * @param distDir Absolute path to the `dist` directory (the parent of `ui/` and `cli.js`).
 * @returns Short hex sha1 of the concatenated components — stable while inputs are unchanged.
 */
export function computeBuildId(distDir: string): string {
  const components = BUILD_ID_INPUTS.map((rel) => {
    const filePath = join(distDir, rel);
    if (!existsSync(filePath)) {
      return `${rel}:${MISSING_SENTINEL}`;
    }
    try {
      const { size, mtimeMs } = statSync(filePath);
      return `${rel}:${size}:${mtimeMs}`;
    } catch {
      // Race or permission issue between existsSync and statSync — treat as missing, never throw.
      return `${rel}:${MISSING_SENTINEL}`;
    }
  });

  return createHash('sha1').update(components.join('|')).digest('hex').slice(0, 12);
}

/**
 * Resolve the package root (the directory containing this package's `package.json`) by walking up
 * from this module's directory. Used as the build `cwd` to avoid the Windows npm-workspace pitfall
 * where `process.cwd()` is the package dir of the invoking workspace, not this package's root.
 *
 * @returns Absolute path to the package root.
 */
export function resolvePackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  // Walk up until a package.json is found, or we hit the filesystem root.
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached the filesystem root without finding package.json — fall back to the starting dir.
      return dirname(fileURLToPath(import.meta.url));
    }
    dir = parent;
  }
}

/**
 * Spawn `npm run build` in `repoRoot`, capturing combined stdout+stderr.
 *
 * Never throws: a non-zero exit, a spawn error, or any other failure all resolve to `{ ok:false }`
 * with the captured log. On success the freshly-built `dist` fingerprint is returned as `buildId`.
 *
 * @param repoRoot Package root to run the build in (NOT `process.cwd()` — see {@link resolvePackageRoot}).
 * @returns `{ ok, log, buildId }`. `buildId` is recomputed from `dist` after a successful build.
 */
export async function runBuild(
  repoRoot: string,
): Promise<{ ok: boolean; log: string; buildId: string }> {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  return new Promise((resolvePromise) => {
    let log = '';
    let settled = false;

    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      const buildId = ok ? computeBuildId(join(repoRoot, 'dist')) : '';
      resolvePromise({ ok, log, buildId });
    };

    try {
      const child = spawn(npmCmd, ['run', 'build'], {
        cwd: repoRoot,
        shell: false,
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        log += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        log += chunk.toString();
      });
      child.on('error', (err: Error) => {
        log += `\n[spawn error] ${err.message}`;
        finish(false);
      });
      child.on('close', (code: number | null) => {
        finish(code === 0);
      });
    } catch (err) {
      log += `\n[spawn threw] ${err instanceof Error ? err.message : String(err)}`;
      finish(false);
    }
  });
}
