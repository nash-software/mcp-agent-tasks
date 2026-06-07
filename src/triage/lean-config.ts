/**
 * Lean config dir seeding for triage claude spawns (MCPAT-082 P2).
 *
 * Points each triage claude spawn at a minimal CLAUDE_CONFIG_DIR with no
 * SessionStart hooks so each batch skips the full hook chain. Seeded once per
 * run; subsequent calls are no-ops when the sentinel `.seeded` file exists.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SENTINEL = '.seeded';

/** Return true if `dir` already has a seeded lean config. */
export function isSeeded(dir: string): boolean {
  return existsSync(join(dir, SENTINEL));
}

/**
 * Seed `dir` with a minimal claude settings.json (no hooks, no telemetry).
 * If already seeded, returns immediately. The write uses temp-file rename for
 * atomicity (POSIX-safe; best-effort on Windows with fallback direct write).
 */
export function seedLeanConfigDir(dir: string): void {
  if (isSeeded(dir)) return;
  mkdirSync(dir, { recursive: true });

  const settings = {
    hooks: {},
    env: {},
    preferredNotifChannel: 'none',
    autoUpdates: false,
  };

  const payload = JSON.stringify(settings, null, 2);
  const tmp = join(dir, 'settings.json.tmp');
  const dest = join(dir, 'settings.json');
  writeFileSync(tmp, payload, 'utf-8');
  try {
    renameSync(tmp, dest);
  } catch {
    // Fallback: direct write (Windows may reject cross-device rename)
    writeFileSync(dest, payload, 'utf-8');
  }

  writeFileSync(join(dir, SENTINEL), '', 'utf-8');
}
