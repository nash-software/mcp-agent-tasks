import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';

// --- Mocks for node:fs and node:child_process -------------------------------------------------
const fsState: {
  files: Map<string, { size: number; mtimeMs: number } | 'throws'>;
} = { files: new Map() };

vi.mock('node:fs', () => ({
  existsSync: (p: string): boolean => fsState.files.has(p),
  statSync: (p: string): { size: number; mtimeMs: number } => {
    const entry = fsState.files.get(p);
    if (entry === undefined) throw new Error(`ENOENT: ${p}`);
    if (entry === 'throws') throw new Error(`EACCES: ${p}`);
    return entry;
  },
}));

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]): unknown => spawnMock(...args),
}));

// Imported after mocks are registered.
const { computeBuildId, runBuild } = await import('./build-runner.js');

const DIST = join('/repo', 'dist');
const INDEX = join(DIST, 'ui', 'index.html');
const CLI = join(DIST, 'cli.js');

beforeEach(() => {
  fsState.files.clear();
  spawnMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeBuildId (AC-1)', () => {
  it('returns a stable string for unchanged inputs', () => {
    fsState.files.set(INDEX, { size: 100, mtimeMs: 1000 });
    fsState.files.set(CLI, { size: 200, mtimeMs: 2000 });
    const a = computeBuildId(DIST);
    const b = computeBuildId(DIST);
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });

  it('returns a different string when index.html size/mtime changes', () => {
    fsState.files.set(INDEX, { size: 100, mtimeMs: 1000 });
    fsState.files.set(CLI, { size: 200, mtimeMs: 2000 });
    const before = computeBuildId(DIST);

    fsState.files.set(INDEX, { size: 100, mtimeMs: 1500 }); // mtime change
    expect(computeBuildId(DIST)).not.toBe(before);

    fsState.files.set(INDEX, { size: 999, mtimeMs: 1000 }); // size change
    expect(computeBuildId(DIST)).not.toBe(before);
  });

  it('returns a different string when cli.js size/mtime changes', () => {
    fsState.files.set(INDEX, { size: 100, mtimeMs: 1000 });
    fsState.files.set(CLI, { size: 200, mtimeMs: 2000 });
    const before = computeBuildId(DIST);

    fsState.files.set(CLI, { size: 200, mtimeMs: 2500 });
    expect(computeBuildId(DIST)).not.toBe(before);
  });

  it('treats missing files as a sentinel and never throws', () => {
    // No files present at all.
    expect(() => computeBuildId(DIST)).not.toThrow();
    const allMissing = computeBuildId(DIST);

    // Adding a file changes the id away from the all-missing sentinel.
    fsState.files.set(INDEX, { size: 1, mtimeMs: 1 });
    expect(computeBuildId(DIST)).not.toBe(allMissing);
  });

  it('does not throw when statSync fails after existsSync', () => {
    fsState.files.set(INDEX, 'throws');
    fsState.files.set(CLI, { size: 200, mtimeMs: 2000 });
    expect(() => computeBuildId(DIST)).not.toThrow();
  });
});

/** Build a fake ChildProcess that emits the given exit code (or an error). */
function makeFakeChild(opts: { code?: number; stdout?: string; stderr?: string; error?: Error }): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // Emit asynchronously so listeners attached after spawn() returns still fire.
  setImmediate(() => {
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
    if (opts.error) {
      child.emit('error', opts.error);
      return;
    }
    child.emit('close', opts.code ?? 0);
  });
  return child;
}

describe('runBuild (AC-2, AC-3)', () => {
  it('resolves {ok:true, buildId} on zero exit', async () => {
    fsState.files.set(INDEX, { size: 10, mtimeMs: 1 });
    fsState.files.set(CLI, { size: 20, mtimeMs: 2 });
    spawnMock.mockReturnValue(makeFakeChild({ code: 0, stdout: 'build ok' }));

    const result = await runBuild('/repo');
    expect(result.ok).toBe(true);
    expect(result.buildId).toBe(computeBuildId(DIST));
    expect(result.buildId.length).toBeGreaterThan(0);
    expect(result.log).toContain('build ok');
  });

  it('resolves {ok:false, log} on non-zero exit and never throws, capturing stderr', async () => {
    spawnMock.mockReturnValue(
      makeFakeChild({ code: 1, stdout: 'partial', stderr: 'TS error: boom' }),
    );

    const result = await runBuild('/repo');
    expect(result.ok).toBe(false);
    expect(result.buildId).toBe('');
    expect(result.log).toContain('TS error: boom');
    expect(result.log).toContain('partial');
  });

  it('resolves {ok:false} (never throws) when spawn emits an error', async () => {
    spawnMock.mockReturnValue(makeFakeChild({ error: new Error('ENOENT npm') }));

    const result = await runBuild('/repo');
    expect(result.ok).toBe(false);
    expect(result.log).toContain('ENOENT npm');
  });

  it('passes the resolved package root as cwd, not process.cwd() (AC-3)', async () => {
    spawnMock.mockReturnValue(makeFakeChild({ code: 0 }));
    await runBuild('/some/package/root');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = spawnMock.mock.calls[0] as [string, string[], { cwd: string; shell: boolean }];
    expect(cmd).toMatch(/^npm(\.cmd)?$/);
    expect(args).toEqual(['run', 'build']);
    expect(options.cwd).toBe('/some/package/root');
    expect(options.cwd).not.toBe(process.cwd());
    expect(options.shell).toBe(false);
  });
});
