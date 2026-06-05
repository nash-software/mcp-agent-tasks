/**
 * install-tray helpers — pure functions extracted for testability.
 *
 * These are used by the `agent-tasks install-tray` Commander command in
 * cli.ts and exported separately so unit tests can mock child_process and
 * process.platform without going through Commander's CLI parsing layer.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';

/** Canonical Windows Scheduled Task name for the tray autostart entry. */
export const TRAY_TASK_NAME = 'AgentTasksTray';

/**
 * Absolute path to the hidden-node launcher shared by all CLI installers.
 * Runs a Node.js script windowless (no console flash) on Windows.
 */
export const NODE_HIDDEN_EXE = 'C:/Users/micha/.claude/hooks/node-hidden.exe';

/**
 * Build the schtasks /TR command string that will be registered.
 * The resulting string runs `node-hidden.exe <cliBinPath> tray` so no console
 * window appears when the Scheduled Task fires at login.
 */
export function buildTrayCommand(cliBinPath: string): string {
  return `"${NODE_HIDDEN_EXE}" "${cliBinPath}" tray`;
}

/**
 * Register (or overwrite with /F) the logon Scheduled Task.
 * No-ops with a message on non-Windows platforms.
 *
 * @param cliBinPath - Absolute path to the dist/cli.js binary.
 */
export function installTray(cliBinPath: string): void {
  if (process.platform !== 'win32') {
    console.log(
      'install-tray: autostart via Scheduled Task is Windows-only. ' +
      'No changes made on this platform.',
    );
    return;
  }

  const trayCmd = buildTrayCommand(cliBinPath);

  execSync(
    `schtasks /Create /TN "${TRAY_TASK_NAME}" /SC ONLOGON /TR ${trayCmd} /F`,
    { stdio: 'pipe' },
  );

  console.log(`✓ Registered Scheduled Task "${TRAY_TASK_NAME}" — will launch at login.`);
  console.log(`  Command: ${trayCmd}`);
  console.log('');
  console.log('  ── Post-install steps ──────────────────────────────────────');
  console.log('  1. Start the tray now (no reboot required):');
  console.log('       agent-tasks tray');
  console.log('  2. Install the dashboard as a PWA:');
  console.log('     a. Open http://localhost:4242 in Edge or Chrome.');
  console.log('     b. Click the install icon (⊕) in the address bar and choose');
  console.log('        "Install app".');
  console.log('  3. (Optional) Set http://localhost:4242 as your browser startup page');
  console.log('     so the dashboard opens automatically on browser launch.');
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('');
  console.log('  Fallback (HKCU Run key — no UAC required):');
  console.log(`  reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v AgentTasksTray /t REG_SZ /d "${trayCmd}" /f`);
}

/**
 * Remove the logon Scheduled Task.
 * Treats "task not found" as a non-error (idempotent uninstall).
 * No-ops with a message on non-Windows platforms.
 */
export function uninstallTray(): void {
  if (process.platform !== 'win32') {
    console.log(
      'install-tray --uninstall: Scheduled Task removal is Windows-only. ' +
      'No changes made on this platform.',
    );
    return;
  }

  try {
    execSync(`schtasks /Delete /TN "${TRAY_TASK_NAME}" /F`, { stdio: 'pipe' });
    console.log(`✓ Removed Scheduled Task "${TRAY_TASK_NAME}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('cannot find') || msg.includes('does not exist') || msg.includes('The system cannot find')) {
      console.log(`(Task "${TRAY_TASK_NAME}" was not registered — nothing to remove.)`);
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
