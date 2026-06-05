/**
 * Unit tests for the install-tray helpers (src/cli-install-tray.ts).
 *
 * child_process.execSync is mocked so the suite runs cross-platform and never
 * touches the real Windows Task Scheduler.
 *
 * process.platform is overridden per-test via vi.stubGlobal where needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── child_process mock ────────────────────────────────────────────────────────

const execSyncCalls: string[] = [];
let execSyncError: Error | null = null;

vi.mock('node:child_process', () => ({
  execSync: (cmd: string, _opts?: unknown): void => {
    execSyncCalls.push(cmd);
    if (execSyncError) throw execSyncError;
  },
}));

// ── Import helpers under test (after mocks are in place) ─────────────────────

const {
  buildTrayCommand,
  TRAY_TASK_NAME,
  NODE_HIDDEN_EXE,
  installTray,
  uninstallTray,
} = await import('../../src/cli-install-tray.js');

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  execSyncCalls.length = 0;
  execSyncError = null;
  vi.spyOn(console, 'log').mockImplementation(() => { /* silent */ });
  vi.spyOn(console, 'error').mockImplementation(() => { /* silent */ });
  // Reset platform to win32 for each test
  vi.stubGlobal('process', { ...process, platform: 'win32' });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── Constants ─────────────────────────────────────────────────────────────────

describe('TRAY_TASK_NAME', () => {
  it('is the canonical task name "AgentTasksTray"', () => {
    expect(TRAY_TASK_NAME).toBe('AgentTasksTray');
  });
});

describe('NODE_HIDDEN_EXE', () => {
  it('points to the node-hidden.exe launcher', () => {
    expect(NODE_HIDDEN_EXE).toContain('node-hidden.exe');
  });
});

// ── buildTrayCommand ──────────────────────────────────────────────────────────

describe('buildTrayCommand', () => {
  it('includes node-hidden.exe', () => {
    const cmd = buildTrayCommand('/path/dist/cli.js');
    expect(cmd).toContain('node-hidden.exe');
  });

  it('includes the cli bin path', () => {
    const cmd = buildTrayCommand('/repo/dist/cli.js');
    expect(cmd).toContain('/repo/dist/cli.js');
  });

  it('ends with the "tray" subcommand — AC-3', () => {
    const cmd = buildTrayCommand('/repo/dist/cli.js');
    // The tray arg must appear after the cli path and at the end of the string
    expect(cmd.endsWith('tray')).toBe(true);
  });
});

// ── installTray — AC-1 ────────────────────────────────────────────────────────

describe('installTray — AC-1: idempotent install', () => {
  it('calls schtasks /Create with /F flag (OS-level idempotency)', () => {
    installTray('/repo/dist/cli.js');

    expect(execSyncCalls).toHaveLength(1);
    expect(execSyncCalls[0]).toContain('schtasks');
    expect(execSyncCalls[0]).toContain('/Create');
    expect(execSyncCalls[0]).toContain('/F');
  });

  it('re-running install issues a second schtasks /Create /F — /F overwrites, no duplicate', () => {
    installTray('/repo/dist/cli.js');
    installTray('/repo/dist/cli.js');

    expect(execSyncCalls).toHaveLength(2);
    for (const cmd of execSyncCalls) {
      expect(cmd).toContain('/F');
      expect(cmd).toContain('/Create');
    }
  });
});

// ── uninstallTray — AC-2 ──────────────────────────────────────────────────────

describe('uninstallTray — AC-2: uninstall removes the entry', () => {
  it('calls schtasks /Delete /F with the canonical task name', () => {
    uninstallTray();

    expect(execSyncCalls).toHaveLength(1);
    const cmd = execSyncCalls[0]!;
    expect(cmd).toContain('schtasks');
    expect(cmd).toContain('/Delete');
    expect(cmd).toContain('/F');
    expect(cmd).toContain(TRAY_TASK_NAME);
  });

  it('does not throw when the task was never registered ("cannot find")', () => {
    execSyncError = new Error('ERROR: The system cannot find the task specified.');
    const logSpy = vi.spyOn(console, 'log');

    expect(() => uninstallTray()).not.toThrow();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('nothing to remove'));
  });

  it('does not throw when the error says "does not exist"', () => {
    execSyncError = new Error('Task does not exist: AgentTasksTray');

    expect(() => uninstallTray()).not.toThrow();
  });

  it('re-throws unexpected errors', () => {
    execSyncError = new Error('Access is denied.');

    expect(() => uninstallTray()).toThrow('Access is denied.');
  });
});

// ── installTray — AC-3 ────────────────────────────────────────────────────────

describe('installTray — AC-3: command string embeds tray via node-hidden.exe', () => {
  it('schtasks /TR contains node-hidden.exe, the cli path, ONLOGON and task name', () => {
    const cliBin = '/my/repo/dist/cli.js';
    installTray(cliBin);

    const cmd = execSyncCalls[0]!;
    expect(cmd).toContain('node-hidden.exe');
    expect(cmd).toContain(cliBin);
    expect(cmd).toContain('tray');
    expect(cmd).toContain('ONLOGON');
    expect(cmd).toContain(TRAY_TASK_NAME);
  });
});

// ── Cross-platform guard ──────────────────────────────────────────────────────

describe('cross-platform guard', () => {
  it('installTray no-ops with a message on linux', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    const logSpy = vi.spyOn(console, 'log');

    installTray('/some/dist/cli.js');

    expect(execSyncCalls).toHaveLength(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Windows-only'));
  });

  it('installTray no-ops on darwin', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });

    installTray('/some/dist/cli.js');

    expect(execSyncCalls).toHaveLength(0);
  });

  it('uninstallTray no-ops on non-Windows', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });

    uninstallTray();

    expect(execSyncCalls).toHaveLength(0);
  });
});
