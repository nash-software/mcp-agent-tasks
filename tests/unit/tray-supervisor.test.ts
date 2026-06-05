/**
 * Unit tests for the tray supervisor.
 *
 * All I/O is mocked. A fake clock is injected for backoff scheduling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';

// ── fs mock ────────────────────────────────────────────────────────────────────

type FsFile = { size?: number; content?: string } | 'missing';

const fsFiles = new Map<string, { size: number; content: string }>();
const createdStreams: FakeWriteStream[] = [];

class FakeWriteStream extends EventEmitter {
  data = '';
  pipe(_dest: unknown, _opts?: unknown): this { return this; }
  write(chunk: Buffer | string): boolean {
    this.data += chunk.toString();
    return true;
  }
}

vi.mock('node:fs', async () => {
  return {
    existsSync: (p: string): boolean => fsFiles.has(p),
    mkdirSync: (_p: string, _opts?: unknown): void => { /* noop */ },
    writeFileSync: (p: string, content: string): void => {
      fsFiles.set(p, { size: Buffer.byteLength(content), content });
    },
    readFileSync: (p: string, _enc?: string): string => {
      const entry = fsFiles.get(p);
      if (!entry) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return entry.content;
    },
    unlinkSync: (p: string): void => { fsFiles.delete(p); },
    statSync: (p: string): { size: number } => {
      const entry = fsFiles.get(p);
      if (!entry) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return { size: entry.size };
    },
    renameSync: (src: string, dst: string): void => {
      const entry = fsFiles.get(src);
      if (entry) { fsFiles.set(dst, entry); fsFiles.delete(src); }
    },
    createWriteStream: (_p: string, _opts?: unknown): FakeWriteStream => {
      const s = new FakeWriteStream();
      createdStreams.push(s);
      return s;
    },
    WriteStream: FakeWriteStream,
  };
});

// ── child_process mock ─────────────────────────────────────────────────────────

class FakeChild extends EventEmitter {
  pid: number;
  killed = false;
  stdout = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  stderr = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;

  constructor(pid: number) {
    super();
    this.pid = pid;
    // Make stdout/stderr pipeable for piping to log stream.
    (this.stdout as EventEmitter & { pipe: unknown }).pipe = (): FakeWriteStream => new FakeWriteStream();
    (this.stderr as EventEmitter & { pipe: unknown }).pipe = (): FakeWriteStream => new FakeWriteStream();
  }

  kill(_signal?: string): boolean {
    this.killed = true;
    return true;
  }

  simulateExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('exit', code, signal);
  }
}

let spawnCallCount = 0;
let nextPid = 1000;
const spawnedChildren: FakeChild[] = [];

const spawnMock = vi.fn((): FakeChild => {
  spawnCallCount++;
  const child = new FakeChild(nextPid++);
  spawnedChildren.push(child);
  return child;
});

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]): unknown => spawnMock(...args),
}));

// ── runBuild mock ─────────────────────────────────────────────────────────────

let runBuildResult: { ok: boolean; log: string; buildId: string } = {
  ok: true,
  log: '',
  buildId: 'abc123',
};

vi.mock('../../src/dev/build-runner.js', () => ({
  runBuild: async (_repoRoot: string): Promise<{ ok: boolean; log: string; buildId: string }> =>
    runBuildResult,
}));

// ── Import under test (after mocks) ───────────────────────────────────────────

const {
  TraySupvisor,
  acquireLock,
  releaseLock,
  serverLogPath,
  resolveCliBin,
  resolveScratchDir,
  MAX_RAPID_RESTARTS,
  INITIAL_BACKOFF_MS,
  LOG_SIZE_LIMIT,
} = await import('../../src/tray/supervisor.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCRATCH = '/fake/scratch';
const REPO = '/fake/repo';
const CLI_BIN = '/fake/repo/dist/cli.js';

/** Scheduled callbacks injected via setTimeout. */
type ScheduledCb = { fn: () => void; ms: number };
const scheduled: ScheduledCb[] = [];

function fakeSetTimeout(fn: () => void, ms: number): unknown {
  scheduled.push({ fn, ms });
  return scheduled.length - 1;
}

function flushScheduled(): void {
  while (scheduled.length > 0) {
    const cb = scheduled.shift()!;
    cb.fn();
  }
}

function makeSupvisor(onHealthChange?: (state: string, reason: string) => void): InstanceType<typeof TraySupvisor> {
  return new TraySupvisor({
    repoRoot: REPO,
    port: 4242,
    scratchDir: SCRATCH,
    cliBinPath: CLI_BIN,
    setTimeoutFn: fakeSetTimeout,
    onHealthChange: onHealthChange as ((state: 'healthy' | 'restarting' | 'unhealthy', reason: string) => void) | undefined,
  });
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  fsFiles.clear();
  createdStreams.length = 0;
  spawnedChildren.length = 0;
  spawnCallCount = 0;
  nextPid = 1000;
  scheduled.length = 0;
  spawnMock.mockClear();
  runBuildResult = { ok: true, log: '', buildId: 'abc123' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('acquireLock / releaseLock', () => {
  it('writes lock file on first call when no existing lock', () => {
    const acquired = acquireLock(SCRATCH, () => false);
    expect(acquired).toBe(true);
    const lp = join(SCRATCH, '.tray', 'tray.lock');
    expect(fsFiles.has(lp)).toBe(true);
    const data = JSON.parse(fsFiles.get(lp)!.content) as { pid: number };
    expect(data.pid).toBe(process.pid);
  });

  it('returns false when a live process holds the lock', () => {
    // Pre-populate a lock file with a "live" PID.
    const lp = join(SCRATCH, '.tray', 'tray.lock');
    fsFiles.set(lp, { size: 50, content: JSON.stringify({ pid: 9999, startedAt: new Date().toISOString() }) });
    const acquired = acquireLock(SCRATCH, (_pid) => true); // always alive
    expect(acquired).toBe(false);
  });

  it('overwrites a stale lock (process dead)', () => {
    const lp = join(SCRATCH, '.tray', 'tray.lock');
    fsFiles.set(lp, { size: 50, content: JSON.stringify({ pid: 9999, startedAt: new Date().toISOString() }) });
    const acquired = acquireLock(SCRATCH, (_pid) => false); // dead process
    expect(acquired).toBe(true);
    const data = JSON.parse(fsFiles.get(lp)!.content) as { pid: number };
    expect(data.pid).toBe(process.pid);
  });

  it('overwrites a corrupt lock file', () => {
    const lp = join(SCRATCH, '.tray', 'tray.lock');
    fsFiles.set(lp, { size: 5, content: '!CORRUPT!' });
    const acquired = acquireLock(SCRATCH, () => true);
    expect(acquired).toBe(true);
  });

  it('releaseLock removes the lock file', () => {
    acquireLock(SCRATCH, () => false);
    const lp = join(SCRATCH, '.tray', 'tray.lock');
    expect(fsFiles.has(lp)).toBe(true);
    releaseLock(SCRATCH);
    expect(fsFiles.has(lp)).toBe(false);
  });
});

describe('serverLogPath', () => {
  it('returns path under .tray/server.log', () => {
    const lp = serverLogPath(SCRATCH);
    expect(lp).toBe(join(SCRATCH, '.tray', 'server.log'));
  });
});

describe('resolveCliBin', () => {
  it('returns dist/cli.js under repoRoot', () => {
    expect(resolveCliBin('/my/repo')).toBe(join('/my/repo', 'dist', 'cli.js'));
  });
});

describe('resolveScratchDir', () => {
  it('returns scratchpads under repoRoot', () => {
    expect(resolveScratchDir('/my/repo')).toBe(join('/my/repo', 'scratchpads'));
  });
});

describe('TraySupvisor — AC-5: child spawned with MCPAT_DEV_TRAY=1 and --port', () => {
  it('spawns with correct args and env', () => {
    const sup = makeSupvisor();
    sup.start();

    expect(spawnMock).toHaveBeenCalledOnce();
    const [exe, args, spawnOpts] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string>; windowsHide: boolean },
    ];
    expect(exe).toBe(process.execPath);
    expect(args).toContain(CLI_BIN);
    expect(args).toContain('serve-ui');
    expect(args).toContain('--port');
    expect(args).toContain('4242');
    expect(spawnOpts.env['MCPAT_DEV_TRAY']).toBe('1');
    expect(spawnOpts.windowsHide).toBe(true);

    sup.stop();
  });
});

describe('TraySupvisor — AC-2: backoff state machine', () => {
  it('respawns after unexpected exit', () => {
    const sup = makeSupvisor();
    sup.start();
    expect(spawnCallCount).toBe(1);

    const child = spawnedChildren[0]!;
    child.simulateExit(1); // unexpected exit

    expect(scheduled.length).toBe(1);
    flushScheduled();
    expect(spawnCallCount).toBe(2);

    sup.stop();
  });

  it('marks unhealthy after MAX_RAPID_RESTARTS rapid failures', () => {
    const healthEvents: Array<{ state: string; reason: string }> = [];
    const sup = makeSupvisor((state, reason) => healthEvents.push({ state, reason }));
    sup.start();

    // Simulate MAX_RAPID_RESTARTS + 1 crashes rapidly
    for (let i = 0; i <= MAX_RAPID_RESTARTS; i++) {
      const child = spawnedChildren[spawnedChildren.length - 1]!;
      child.simulateExit(1);
      if (scheduled.length > 0) flushScheduled();
    }

    const finalHealth = healthEvents[healthEvents.length - 1]!;
    expect(finalHealth.state).toBe('unhealthy');
    expect(sup.healthState).toBe('unhealthy');

    sup.stop();
  });

  it('does NOT respawn after MAX_RAPID_RESTARTS exceeded', () => {
    const sup = makeSupvisor();
    sup.start();
    const initialSpawnCount = spawnCallCount;

    for (let i = 0; i <= MAX_RAPID_RESTARTS; i++) {
      const child = spawnedChildren[spawnedChildren.length - 1]!;
      child.simulateExit(1);
      if (scheduled.length > 0) flushScheduled();
    }

    // After going unhealthy, no further spawn should be scheduled.
    expect(scheduled.length).toBe(0);
    // Total spawns should be bounded.
    expect(spawnCallCount).toBeLessThanOrEqual(initialSpawnCount + MAX_RAPID_RESTARTS + 1);

    sup.stop();
  });

  it('uses exponential backoff delays', () => {
    const sup = makeSupvisor();
    sup.start();

    const child1 = spawnedChildren[0]!;
    child1.simulateExit(1);
    expect(scheduled[0]!.ms).toBe(INITIAL_BACKOFF_MS);
    flushScheduled();

    const child2 = spawnedChildren[1]!;
    child2.simulateExit(1);
    expect(scheduled[0]!.ms).toBe(INITIAL_BACKOFF_MS * 2);
    flushScheduled();

    sup.stop();
  });
});

describe('TraySupvisor — AC-4: Update path', () => {
  it('respawns child on ok:true build', async () => {
    runBuildResult = { ok: true, log: '', buildId: 'new123' };
    const sup = makeSupvisor();
    sup.start();
    expect(spawnCallCount).toBe(1);

    const result = await sup.update();

    expect(result.ok).toBe(true);
    expect(spawnCallCount).toBe(2);

    sup.stop();
  });

  it('does NOT respawn on ok:false build', async () => {
    runBuildResult = { ok: false, log: 'build failed', buildId: '' };
    const sup = makeSupvisor();
    sup.start();
    expect(spawnCallCount).toBe(1);

    const result = await sup.update();

    expect(result.ok).toBe(false);
    expect(spawnCallCount).toBe(1); // no additional spawn

    sup.stop();
  });
});

describe('TraySupvisor — health state', () => {
  it('reports healthy after start', () => {
    const sup = makeSupvisor();
    sup.start();
    expect(sup.healthState).toBe('healthy');
    sup.stop();
  });

  it('reports restarting after unexpected exit', () => {
    const sup = makeSupvisor();
    sup.start();
    spawnedChildren[0]!.simulateExit(1);
    expect(sup.healthState).toBe('restarting');
    sup.stop();
  });
});

describe('TraySupvisor — restart()', () => {
  it('kills the current child and spawns a new one', () => {
    const sup = makeSupvisor();
    sup.start();
    expect(spawnCallCount).toBe(1);
    const firstChild = spawnedChildren[0]!;

    sup.restart();

    expect(firstChild.killed).toBe(true);
    expect(spawnCallCount).toBe(2);

    sup.stop();
  });
});

describe('TraySupvisor — stop()', () => {
  it('kills the child and stops supervising', () => {
    const sup = makeSupvisor();
    sup.start();
    const child = spawnedChildren[0]!;
    sup.stop();

    expect(child.killed).toBe(true);
    // Subsequent exit events should NOT trigger respawns.
    child.simulateExit(1);
    expect(scheduled.length).toBe(0);
  });
});
