/**
 * install-tray helpers — pure functions extracted for testability.
 *
 * These are used by the `agent-tasks install-tray` Commander command in
 * cli.ts and exported separately so unit tests can mock child_process and
 * process.platform without going through Commander's CLI parsing layer.
 *
 * Autostart mechanism: the per-user HKCU \…\Run registry key. This runs the
 * tray (windowless, via node-hidden.exe) at every login and — unlike a
 * Scheduled Task created with `schtasks /Create` — requires NO elevation/UAC,
 * which is the whole point of a frictionless "always on" install.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Registry value name under the Run key (also used in user-facing messages). */
export const TRAY_TASK_NAME = 'AgentTasksTray';

/** Per-user autostart key — entries here run at login without elevation. */
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/**
 * Absolute path to the hidden-node launcher shared by all CLI installers.
 * Runs a Node.js script windowless (no console flash) on Windows.
 */
export const NODE_HIDDEN_EXE = 'C:/Users/micha/.claude/hooks/node-hidden.exe';

/**
 * Build the command stored in the Run key. Runs `node-hidden.exe <cliBinPath>
 * tray` so no console window appears when it fires at login. Both paths are
 * double-quoted so spaces survive the Run-key command-line parser.
 */
export function buildTrayCommand(cliBinPath: string): string {
  return `"${NODE_HIDDEN_EXE}" "${cliBinPath}" tray`;
}

/**
 * Register (or overwrite with /f) the per-user logon autostart entry.
 * No-ops with a message on non-Windows platforms.
 *
 * @param cliBinPath - Absolute path to the dist/cli.js binary.
 */
export function installTray(cliBinPath: string): void {
  if (process.platform !== 'win32') {
    console.log(
      'install-tray: autostart via the Run registry key is Windows-only. ' +
      'No changes made on this platform.',
    );
    return;
  }

  const trayCmd = buildTrayCommand(cliBinPath);

  // execFileSync (argv array, no shell) so reg receives the command as a single
  // /d value — building one cmd string instead would let the shell re-split the
  // quoted paths. /f overwrites any existing value (idempotent re-install).
  execFileSync(
    'reg',
    ['add', RUN_KEY, '/v', TRAY_TASK_NAME, '/t', 'REG_SZ', '/d', trayCmd, '/f'],
    { stdio: 'pipe' },
  );

  console.log(`✓ Registered login autostart "${TRAY_TASK_NAME}" (per-user, no admin required).`);
  console.log(`  Runs at every login: ${trayCmd}`);
  console.log('');
  console.log('  ── Post-install steps ──────────────────────────────────────');
  console.log('  1. Start the tray now (no logout required):');
  console.log('       agent-tasks tray');
  console.log('  2. Install the dashboard as a PWA:');
  console.log('     a. Open http://localhost:4242 in Edge or Chrome.');
  console.log('     b. Click the install icon (⊕) in the address bar and choose');
  console.log('        "Install app".');
  console.log('  3. (Optional) Set http://localhost:4242 as your browser startup page');
  console.log('     so the dashboard opens automatically on browser launch.');
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('');
  console.log('  Remove later with: agent-tasks install-tray --uninstall');
}

/**
 * Remove the per-user logon autostart entry.
 * Treats "value not found" as a non-error (idempotent uninstall).
 * No-ops with a message on non-Windows platforms.
 */
export function uninstallTray(): void {
  if (process.platform !== 'win32') {
    console.log(
      'install-tray --uninstall: Run-key removal is Windows-only. ' +
      'No changes made on this platform.',
    );
    return;
  }

  try {
    execFileSync('reg', ['delete', RUN_KEY, '/v', TRAY_TASK_NAME, '/f'], { stdio: 'pipe' });
    console.log(`✓ Removed login autostart "${TRAY_TASK_NAME}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // reg delete exits non-zero when the value is absent — treat as already-gone.
    if (
      msg.includes('unable to find') ||
      msg.includes('cannot find') ||
      msg.includes('does not exist') ||
      msg.includes('The system was unable to find the specified registry')
    ) {
      console.log(`(Autostart "${TRAY_TASK_NAME}" was not registered — nothing to remove.)`);
    } else {
      throw err;
    }
  }
}

/**
 * Resolve the dist/cli.js path from a given directory (typically __dirname of
 * the compiled cli.js, i.e. dist/).  Returns the absolute path.
 */
export function resolveCLIBin(fromDir: string): string {
  // When running from dist/, __dirname IS dist/, so we only need path.join.
  // But to be safe (dev vs prod), resolve upward to dist/cli.js.
  return path.resolve(fromDir, 'cli.js');
}
