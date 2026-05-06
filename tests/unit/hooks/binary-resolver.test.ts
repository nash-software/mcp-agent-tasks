/**
 * Regression: passive-capture's binary resolution must prefer the
 * Windows `.cmd` wrapper when `where agent-tasks` returns multiple lines.
 *
 * Background: on Windows, `where` returns BOTH the POSIX shell script
 * (`agent-tasks`) and the batch wrapper (`agent-tasks.cmd`). Picking the
 * shell script and feeding it to `node.exe` produces a SyntaxError,
 * which the PostToolUse dispatcher silently swallows — passive capture
 * never fires.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';

// CJS require because hooks/passive-capture.js is a Node script, not TS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hook = require(path.resolve('hooks/passive-capture.js'));

describe('pickBestBinary', () => {
  it('on Windows, prefers .cmd over the bare POSIX script', () => {
    const lines = [
      'C:\\Users\\micha\\AppData\\Roaming\\npm\\agent-tasks',
      'C:\\Users\\micha\\AppData\\Roaming\\npm\\agent-tasks.cmd',
    ];
    expect(hook.pickBestBinary(lines, 'win32')).toBe(
      'C:\\Users\\micha\\AppData\\Roaming\\npm\\agent-tasks.cmd',
    );
  });

  it('on Windows, falls back to the bare path when no .cmd is present', () => {
    const lines = ['C:\\some\\path\\agent-tasks'];
    expect(hook.pickBestBinary(lines, 'win32')).toBe('C:\\some\\path\\agent-tasks');
  });

  it('on non-Windows, returns the first non-empty line', () => {
    const lines = ['/usr/local/bin/agent-tasks'];
    expect(hook.pickBestBinary(lines, 'linux')).toBe('/usr/local/bin/agent-tasks');
  });

  it('returns null when given empty or whitespace-only input', () => {
    expect(hook.pickBestBinary([], 'win32')).toBeNull();
    expect(hook.pickBestBinary(['', '  '], 'win32')).toBeNull();
  });

  it('matches .cmd case-insensitively (covers .CMD, .Cmd from `where`)', () => {
    const lines = ['C:\\agent-tasks', 'C:\\agent-tasks.CMD'];
    expect(hook.pickBestBinary(lines, 'win32')).toBe('C:\\agent-tasks.CMD');
  });
});
