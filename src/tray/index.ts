/**
 * Tray entry point — builds the systray2 menu and wires it to the supervisor.
 *
 * Degrades gracefully: if systray2 fails to start the supervisor continues
 * managing serve-ui in server-only mode with a warning logged.
 */

import { spawn } from 'node:child_process';
import {
  TraySupvisor,
  acquireLock,
  serverLogPath,
  resolveRepoRoot,
  resolveScratchDir,
  resolveCliBin,
} from './supervisor.js';
import type { HealthState } from './supervisor.js';
import { TRAY_ICON_BASE64 } from './icon.js';

// ── Public entry ──────────────────────────────────────────────────────────────

export interface TrayOptions {
  port?: number;
}

/**
 * Start the tray supervisor.
 *
 * 1. Acquires the single-instance lock (exits 0 if another instance is live).
 * 2. Spawns the serve-ui child process.
 * 3. Builds the systray2 menu (degrades to server-only if systray2 fails).
 *
 * Does not return — the process keeps running until Quit or SIGINT.
 */
export async function startTray(opts: TrayOptions = {}): Promise<void> {
  const port = opts.port ?? 4242;
  const repoRoot = resolveRepoRoot();
  const scratchDir = resolveScratchDir(repoRoot);
  const cliBinPath = resolveCliBin(repoRoot);

  // ── Single-instance guard ──────────────────────────────────────────────────
  const acquired = acquireLock(scratchDir, isProcessAlive);
  if (!acquired) {
    console.log('[tray] Another tray instance is already running. Exiting.');
    process.exit(0);
  }

  // ── Supervisor ─────────────────────────────────────────────────────────────
  const supervisor = new TraySupvisor({
    repoRoot,
    port,
    scratchDir,
    cliBinPath,
    onHealthChange: (state: HealthState, reason: string) => {
      handleHealthChange(state, reason, port, trayRef);
    },
  });

  // Capture tray instance after creation below.
  let trayRef: { sendAction: (a: { type: string; menu?: unknown }) => void } | null = null;

  const cleanup = (): void => {
    supervisor.stop();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  supervisor.start();

  // ── systray2 menu ──────────────────────────────────────────────────────────
  trayRef = await startTrayMenu(supervisor, port, scratchDir);
}

// ── Menu items (exported for testing) ────────────────────────────────────────

export interface MenuItemDef {
  title: string;
  tooltip: string;
  enabled: boolean;
  handler: () => void | Promise<void>;
}

/**
 * Build the ordered menu item definitions.
 * Exported so unit tests can verify the menu without starting systray2.
 */
export function buildMenuItems(
  supervisor: TraySupvisor,
  port: number,
  scratchDir: string,
  openUrl: (url: string) => void = defaultOpenUrl,
  openFile: (path: string) => void = defaultOpenFile,
): MenuItemDef[] {
  return [
    {
      title: 'Open Dashboard',
      tooltip: `Open http://localhost:${port} in the default browser`,
      enabled: true,
      handler: (): void => {
        openUrl(`http://localhost:${port}`);
      },
    },
    {
      title: 'Update',
      tooltip: 'Rebuild the app and restart the server',
      enabled: true,
      handler: async (): Promise<void> => {
        const result = await supervisor.update();
        if (!result.ok) {
          console.error('[tray] Update failed:\n' + result.log);
        }
      },
    },
    {
      title: 'Restart server',
      tooltip: 'Restart the server without rebuilding',
      enabled: true,
      handler: (): void => {
        supervisor.restart();
      },
    },
    {
      title: 'Open Logs',
      tooltip: 'Open the server log file',
      enabled: true,
      handler: (): void => {
        openFile(serverLogPath(scratchDir));
      },
    },
    {
      title: 'Quit',
      tooltip: 'Stop the server and exit',
      enabled: true,
      handler: (): void => {
        supervisor.stop();
        process.exit(0);
      },
    },
  ];
}

// ── systray2 integration ──────────────────────────────────────────────────────

function handleHealthChange(
  state: HealthState,
  reason: string,
  port: number,
  tray: { sendAction: (a: { type: string; menu?: unknown }) => void } | null,
): void {
  const label =
    state === 'healthy'
      ? `agent-tasks — running on :${port}`
      : state === 'restarting'
        ? `agent-tasks — restarting…`
        : `agent-tasks — unhealthy: ${reason.slice(0, 60)}`;

  if (tray !== null) {
    try {
      tray.sendAction({ type: 'update-menu', menu: { title: 'agent-tasks', tooltip: label } });
    } catch {
      // Tray may not be fully started yet — ignore.
    }
  }
}

async function startTrayMenu(
  supervisor: TraySupvisor,
  port: number,
  scratchDir: string,
): Promise<{ sendAction: (a: { type: string; menu?: unknown }) => void } | null> {
  let SysTray: typeof import('systray2').default | undefined;
  try {
    const mod = await import('systray2');
    // systray2 is CJS exporting `{ default: SysTray }`. Under Node's ESM→CJS
    // interop, `mod.default` is the whole module.exports object, so the class
    // lives at `mod.default.default`. Some bundlers unwrap one level — handle
    // both shapes rather than assuming.
    const candidate = mod.default as unknown;
    const nested = (candidate as { default?: unknown } | null)?.default;
    SysTray = (typeof nested === 'function'
      ? nested
      : candidate) as typeof import('systray2').default;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[tray] systray2 unavailable — running in server-only mode. (${msg})`);
    return null;
  }

  const menuItems = buildMenuItems(supervisor, port, scratchDir);

  const systrayItems = menuItems.map((item) => ({
    title: item.title,
    tooltip: item.tooltip,
    checked: false,
    enabled: item.enabled,
  }));

  const tray = new SysTray({
    menu: {
      icon: TRAY_ICON_BASE64,
      title: 'agent-tasks',
      tooltip: `agent-tasks — running on :${port}`,
      items: systrayItems,
    },
    debug: false,
    copyDir: false,
  });

  // systray2 spawns its helper process inside ready(); `_process` is null until
  // then. onExit/onError read `_process` directly, so they MUST be registered
  // AFTER ready() resolves — registering them synchronously throws
  // "Cannot read properties of null (reading 'on')".
  try {
    await tray.ready();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[tray] systray2 failed to start — continuing in server-only mode. (${msg})`);
    return null;
  }

  tray.onClick((action) => {
    // systray2 passes __id as the zero-based index of the clicked item.
    const idx = (action as { __id?: number }).__id ?? -1;
    const item = menuItems[idx];
    if (item !== undefined) {
      Promise.resolve(item.handler()).catch((err: unknown) => {
        console.error('[tray] Menu handler error:', err);
      });
    }
  });

  tray.onExit(() => {
    supervisor.stop();
    process.exit(0);
  });

  return tray as unknown as { sendAction: (a: { type: string; menu?: unknown }) => void };
}

// ── OS helpers ────────────────────────────────────────────────────────────────

function defaultOpenUrl(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err: unknown) {
    console.error('[tray] Failed to open URL:', err);
  }
}

function defaultOpenFile(filePath: string): void {
  defaultOpenUrl(filePath);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
