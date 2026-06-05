/**
 * Integration test for the tray single-instance lock — AC-1.
 *
 * Uses the real filesystem under scratchpads/.tray-test/ to verify
 * that a second tray instance detects the live lock and exits without
 * spawning another server.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { acquireLock, releaseLock, serverLogPath } from '../../src/tray/supervisor.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..', '..');
const SCRATCH_DIR = join(REPO_ROOT, 'scratchpads', '.tray-test-integration');

function ensureScratch(): void {
  mkdirSync(SCRATCH_DIR, { recursive: true });
}

function cleanup(): void {
  try {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
  } catch { /* ignore */ }
}

/** Check if a PID is currently alive. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  cleanup();
});

describe('acquireLock integration — AC-1', () => {
  it('first call acquires the lock', () => {
    ensureScratch();
    const acquired = acquireLock(SCRATCH_DIR, isAlive);
    expect(acquired).toBe(true);
    releaseLock(SCRATCH_DIR);
  });

  it('second call from same process is refused while lock is held', () => {
    ensureScratch();

    // First instance acquires the lock.
    const first = acquireLock(SCRATCH_DIR, isAlive);
    expect(first).toBe(true);

    // Second call should detect the live lock (same PID = live process).
    const second = acquireLock(SCRATCH_DIR, isAlive);
    expect(second).toBe(false);

    releaseLock(SCRATCH_DIR);
  });

  it('lock is re-acquirable after release', () => {
    ensureScratch();

    const first = acquireLock(SCRATCH_DIR, isAlive);
    expect(first).toBe(true);
    releaseLock(SCRATCH_DIR);

    const second = acquireLock(SCRATCH_DIR, isAlive);
    expect(second).toBe(true);
    releaseLock(SCRATCH_DIR);
  });

  it('stale lock (dead PID) is overwritten', () => {
    ensureScratch();

    // Simulate a stale lock with a non-existent PID.
    const deadPid = 999999;
    const fakeLive = (pid: number): boolean => {
      if (pid === deadPid) return false; // pretend it's dead
      return isAlive(pid);
    };

    // Pre-write a lock file pointing to the dead PID.
    const lockFile = join(SCRATCH_DIR, '.tray', 'tray.lock');
    mkdirSync(join(SCRATCH_DIR, '.tray'), { recursive: true });
    writeFileSync(lockFile, JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }));

    const acquired = acquireLock(SCRATCH_DIR, fakeLive);
    expect(acquired).toBe(true);
    releaseLock(SCRATCH_DIR);
  });

  it('serverLogPath returns expected path', () => {
    const lp = serverLogPath(SCRATCH_DIR);
    expect(lp).toBe(join(SCRATCH_DIR, '.tray', 'server.log'));
  });
});
