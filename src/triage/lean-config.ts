/**
 * Lean config dir seeding for triage claude spawns (MCPAT-082 P2).
 *
 * Points each triage claude spawn at a minimal CLAUDE_CONFIG_DIR with no
 * SessionStart hooks so each batch skips the full hook chain. Seeded once per
 * run; subsequent calls are no-ops when the sentinel `.seeded` file exists.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SENTINEL = '.seeded';

/**
 * Copy the auth credentials from the real config dir into the lean dir so the
 * triage spawn can authenticate (the Max-subscription OAuth token lives in
 * .credentials.json). Without this the lean spawn errors instantly with no auth.
 * Refreshed every call so a rotated token never goes stale (MCPAT-082 P2 fix).
 */
function copyCredentials(dir: string): void {
  const sourceDir = process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude');
  const src = join(sourceDir, '.credentials.json');
  if (existsSync(src)) {
    try { copyFileSync(src, join(dir, '.credentials.json')); } catch { /* best-effort */ }
  }
}

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
  mkdirSync(dir, { recursive: true });
  // Always refresh auth so a rotated token never goes stale, even across runs.
  copyCredentials(dir);
  if (isSeeded(dir)) return;

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
