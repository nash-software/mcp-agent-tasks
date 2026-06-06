/**
 * Unit tests for the install-tray helpers (src/cli-install-tray.ts).
 *
 * child_process.execFileSync is mocked so the suite runs cross-platform and
 * never touches the real Windows registry.
 *
 * Autostart is registered via the per-user HKCU \…\Run key (no elevation),
 * NOT a Scheduled Task (schtasks /Create requires admin).
 *
 * process.platform is overridden per-test via vi.stubGlobal where needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── child_process mock ────────────────────────────────────────────────────────

interface ExecFileCall { file: string; args: string[]; }
const execFileCalls: ExecFileCall[] = [];
let execFileError: Error | null = null;

vi.mock('node:child_process', () => ({
  execFileSync: (file: string, args: string[], _opts?: unknown): void => {
    execFileCalls.push({ file, args });
    if (execFileError) throw execFileError;
  },
}));

/** Flatten a captured call to "file arg1 arg2 …" for substring assertions. */
const flat = (call: ExecFileCall): string => [call.file, ...call.args].join(' ');

// ── Import helpers under test (after mocks are in place) ─────────────────────

const {
  buildTrayCommand,
  TRAY_TASK_NAME,
  RUN_KEY,
  NODE_HIDDEN_EXE,
  installTray,
  uninstallTray,
} = await import('../../src/cli-install-tray.js');

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  execFileCalls.length = 0;
  execFileError = null;
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
  it('is the canonical autostart name "AgentTasksTray"', () => {
    expect(TRAY_TASK_NAME).toBe('AgentTasksTray');
  });
});

describe('RUN_KEY', () => {
  it('targets the per-user (HKCU) Run key — no elevation required', () => {
    expect(RUN_KEY).toContain('HKCU');
    expect(RUN_KEY).toContain('CurrentVersion\\Run');
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
    expect(cmd.endsWith('tray')).toBe(true);
  });

  it('quotes exe and cli path so paths with spaces survive', () => {
    const cmd = buildTrayCommand('/repo/dist/cli.js');
    expect(cmd).toContain(`"${NODE_HIDDEN_EXE}"`);
    expect(cmd).toContain('"/repo/dist/cli.js"');
  });
});

// ── installTray — AC-1 ────────────────────────────────────────────────────────

describe('installTray — AC-1: idempotent install', () => {
  it('calls reg add on the HKCU Run key with /f (overwrite = idempotent)', () => {
    installTray('/repo/dist/cli.js');

    expect(execFileCalls).toHaveLength(1);
    const call = execFileCalls[0]!;
    expect(call.file).toBe('reg');
    expect(call.args).toContain('add');
    expect(call.args).toContain(RUN_KEY);
    expect(call.args).toContain('/v');
    expect(call.args).toContain(TRAY_TASK_NAME);
    expect(call.args).toContain('/f');
  });

  it('passes the full tray command as a SINGLE /d value (regression: must not be split)', () => {
    const cliBin = '/repo/dist/cli.js';
    installTray(cliBin);

    const { args } = execFileCalls[0]!;
    const dIndex = args.indexOf('/d');
    expect(dIndex).toBeGreaterThanOrEqual(0);
    // The element immediately after /d must be the entire command, not just the exe.
    const dValue = args[dIndex + 1]!;
    expect(dValue).toBe(buildTrayCommand(cliBin));
    expect(dValue).toContain('node-hidden.exe');
    expect(dValue).toContain(cliBin);
    expect(dValue).toContain('tray');
  });

  it('registers REG_SZ type', () => {
    installTray('/repo/dist/cli.js');
    const { args } = execFileCalls[0]!;
    const tIndex = args.indexOf('/t');
    expect(tIndex).toBeGreaterThanOrEqual(0);
    expect(args[tIndex + 1]).toBe('REG_SZ');
  });

  it('re-running install issues a second reg add /f — overwrites, no duplicate', () => {
    installTray('/repo/dist/cli.js');
    installTray('/repo/dist/cli.js');

    expect(execFileCalls).toHaveLength(2);
    for (const call of execFileCalls) {
      expect(call.args).toContain('/f');
      expect(call.args).toContain('add');
    }
  });
});

// ── uninstallTray — AC-2 ──────────────────────────────────────────────────────

describe('uninstallTray — AC-2: uninstall removes the entry', () => {
  it('calls reg delete on the HKCU Run key value with /f', () => {
    uninstallTray();

    expect(execFileCalls).toHaveLength(1);
    const call = execFileCalls[0]!;
    expect(call.file).toBe('reg');
    expect(call.args).toContain('delete');
    expect(call.args).toContain(RUN_KEY);
    expect(call.args).toContain('/v');
    expect(call.args).toContain(TRAY_TASK_NAME);
    expect(call.args).toContain('/f');
  });

  it('does not throw when the value was never registered ("unable to find")', () => {
    execFileError = new Error('ERROR: The system was unable to find the specified registry key or value.');
    const logSpy = vi.spyOn(console, 'log');

    expect(() => uninstallTray()).not.toThrow();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('nothing to remove'));
  });

  it('does not throw when the error says "cannot find"', () => {
    execFileError = new Error('reg: cannot find value AgentTasksTray');

    expect(() => uninstallTray()).not.toThrow();
  });

  it('re-throws unexpected errors', () => {
    execFileError = new Error('Access is denied.');

    expect(() => uninstallTray()).toThrow('Access is denied.');
  });
});

// ── installTray — AC-3 ────────────────────────────────────────────────────────

describe('installTray — AC-3: registered value embeds tray via node-hidden.exe', () => {
  it('reg add value contains node-hidden.exe, the cli path, the tray subcommand and the value name', () => {
    const cliBin = '/my/repo/dist/cli.js';
    installTray(cliBin);

    const cmd = flat(execFileCalls[0]!);
    expect(cmd).toContain('node-hidden.exe');
    expect(cmd).toContain(cliBin);
    expect(cmd).toContain('tray');
    expect(cmd).toContain(TRAY_TASK_NAME);
    expect(cmd).toContain(RUN_KEY);
  });
});

// ── Cross-platform guard ──────────────────────────────────────────────────────

describe('cross-platform guard', () => {
  it('installTray no-ops with a message on linux', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });
    const logSpy = vi.spyOn(console, 'log');

    installTray('/some/dist/cli.js');

    expect(execFileCalls).toHaveLength(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Windows-only'));
  });

  it('installTray no-ops on darwin', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });

    installTray('/some/dist/cli.js');

    expect(execFileCalls).toHaveLength(0);
  });

  it('uninstallTray no-ops on non-Windows', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' });

    uninstallTray();

    expect(execFileCalls).toHaveLength(0);
  });
});
