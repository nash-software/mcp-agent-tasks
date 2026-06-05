/**
 * Tray supervisor — manages the serve-ui child process lifetime.
 *
 * Responsibilities:
 *  - Single-instance lock (scratchpads/.tray/tray.lock)
 *  - Spawn + supervise the serve-ui child process
 *  - Exponential-backoff respawn on unexpected exit (cap 5 rapid retries → unhealthy)
 *  - Coordinate rebuild-and-respawn via runBuild (Update path)
 *  - Expose health state for the tray icon tooltip
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  statSync,
  renameSync,
  createWriteStream,
  type WriteStream,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { runBuild } from '../dev/build-runner.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum log file size before rotation (5 MB). */
export const LOG_SIZE_LIMIT = 5 * 1024 * 1024;

/** Number of rapid restarts inside the burst window that triggers unhealthy state. */
export const MAX_RAPID_RESTARTS = 5;

/** Time window (ms) in which rapid restarts are counted. */
export const RAPID_RESTART_WINDOW_MS = 60_000;

/** Initial backoff delay (ms) for the first restart attempt. */
export const INITIAL_BACKOFF_MS = 500;

/** Maximum backoff delay (ms). */
export const MAX_BACKOFF_MS = 30_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type HealthState = 'healthy' | 'restarting' | 'unhealthy';

export interface SupervisorOptions {
  /** Absolute path to the repo root (contains package.json). */
  repoRoot: string;
  /** Port to pass to serve-ui. */
  port: number;
  /** Absolute path to the scratchpads directory. */
  scratchDir: string;
  /** Absolute path to the dist/cli.js binary. */
  cliBinPath: string;
  /**
   * Injectable setTimeout for unit testing.
   * Defaults to globalThis.setTimeout.
   */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  /** Callback invoked whenever health state changes. */
  onHealthChange?: (state: HealthState, reason: string) => void;
}

interface LockData {
  pid: number;
  startedAt: string;
}

// ── Directory helpers ────────────────────────────────────────────────────────

function trayDir(scratchDir: string): string {
  return join(scratchDir, '.tray');
}

function lockFilePath(scratchDir: string): string {
  return join(trayDir(scratchDir), 'tray.lock');
}

export function serverLogPath(scratchDir: string): string {
  return join(trayDir(scratchDir), 'server.log');
}

// ── Lock helpers ─────────────────────────────────────────────────────────────

/**
 * Attempt to acquire the single-instance lock.
 *
 * @returns `true` if the lock was acquired (this process owns the tray),
 *          `false` if a live peer already holds it.
 */
export function acquireLock(
  scratchDir: string,
  isProcessAlive: (pid: number) => boolean,
): boolean {
  const dir = trayDir(scratchDir);
  mkdirSync(dir, { recursive: true });
  const lp = lockFilePath(scratchDir);

  if (existsSync(lp)) {
    try {
      const raw = readFileSync(lp, 'utf8');
      const data = JSON.parse(raw) as LockData;
      if (isProcessAlive(data.pid)) {
        // Another live process holds the lock.
        return false;
      }
    } catch {
      // Stale or corrupt lock — fall through and overwrite.
    }
  }

  const lockData: LockData = { pid: process.pid, startedAt: new Date().toISOString() };
  writeFileSync(lp, JSON.stringify(lockData), 'utf8');
  return true;
}

/** Release the lock (delete the lock file). */
export function releaseLock(scratchDir: string): void {
  const lp = lockFilePath(scratchDir);
  try {
    unlinkSync(lp);
  } catch {
    // Best-effort: ignore if already gone.
  }
}

// ── Log rotation ─────────────────────────────────────────────────────────────

/**
 * Open (or rotate) the server log file.
 * If the existing log exceeds LOG_SIZE_LIMIT it is renamed to `.bak` first.
 */
function openLogStream(scratchDir: string): WriteStream {
  const lp = serverLogPath(scratchDir);
  mkdirSync(trayDir(scratchDir), { recursive: true });

  if (existsSync(lp)) {
    try {
      const { size } = statSync(lp);
      if (size >= LOG_SIZE_LIMIT) {
        try { renameSync(lp, lp + '.bak'); } catch { /* ignore */ }
      }
    } catch {
      // Ignore stat errors — proceed to open.
    }
  }

  return createWriteStream(lp, { flags: 'a' });
}

// ── Supervisor ────────────────────────────────────────────────────────────────

/**
 * Manages the serve-ui child process, supervising it with exponential-backoff
 * respawn on unexpected failures.
 *
 * Usage:
 *   const sup = new TraySupvisor(opts);
 *   sup.start();
 *   // later…
 *   await sup.update();   // rebuild + respawn
 *   sup.restart();        // kill + respawn
 *   sup.stop();           // clean shutdown
 */
export class TraySupvisor {
  private readonly repoRoot: string;
  private readonly port: number;
  private readonly scratchDir: string;
  private readonly cliBinPath: string;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly onHealthChange?: (state: HealthState, reason: string) => void;

  private child: ChildProcess | null = null;
  private health: HealthState = 'restarting';
  private stopped = false;

  /** Timestamps of recent unexpected exits — used for burst detection. */
  private exitTimestamps: number[] = [];
  /** Current backoff delay (ms). */
  private currentBackoffMs: number = INITIAL_BACKOFF_MS;

  constructor(opts: SupervisorOptions) {
    this.repoRoot = opts.repoRoot;
    this.port = opts.port;
    this.scratchDir = opts.scratchDir;
    this.cliBinPath = opts.cliBinPath;
    this.setTimeoutFn = opts.setTimeoutFn ?? defaultSetTimeout;
    this.onHealthChange = opts.onHealthChange;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get healthState(): HealthState {
    return this.health;
  }

  get serverPort(): number {
    return this.port;
  }

  /** Start the supervisor; spawns the first child immediately. */
  start(): void {
    this.spawnChild({ isUpdate: false });
  }

  /** Kill child, release lock, exit supervision. */
  stop(): void {
    this.stopped = true;
    this.killChild();
    releaseLock(this.scratchDir);
  }

  /**
   * Run a build then respawn on success. On build failure the running child is untouched.
   */
  async update(): Promise<{ ok: boolean; log: string; buildId: string }> {
    const result = await runBuild(this.repoRoot);
    if (result.ok) {
      this.killChild();
      this.spawnChild({ isUpdate: true });
    } else {
      this.writeLog(`[supervisor] Update build FAILED — existing server kept running.\n${result.log}`);
    }
    return result;
  }

  /** Kill + respawn without rebuilding. */
  restart(): void {
    this.killChild();
    this.spawnChild({ isUpdate: false });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private setHealth(state: HealthState, reason: string): void {
    this.health = state;
    this.writeLog(`[supervisor] Health → ${state}: ${reason}`);
    this.onHealthChange?.(state, reason);
  }

  private writeLog(msg: string): void {
    process.stderr.write(`${msg}\n`);
  }

  private killChild(): void {
    if (this.child !== null && !this.child.killed) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        // Process may have already exited — ignore.
      }
    }
    this.child = null;
  }

  private spawnChild(opts: { isUpdate: boolean }): void {
    if (this.stopped) return;

    const logStream = openLogStream(this.scratchDir);

    let child: ChildProcess;
    try {
      child = spawn(
        process.execPath, // node binary — same runtime
        [this.cliBinPath, 'serve-ui', '--port', String(this.port)],
        {
          env: { ...process.env, MCPAT_DEV_TRAY: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          windowsHide: true,
        },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('EADDRINUSE')) {
        this.setHealth('unhealthy', `Port ${this.port} already in use — not retrying.`);
      } else {
        this.setHealth('unhealthy', `Spawn error: ${msg}`);
      }
      return;
    }

    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });

    child.on('error', (err: Error) => {
      this.writeLog(`[supervisor] Child error: ${err.message}`);
      if (err.message.includes('EADDRINUSE')) {
        this.setHealth('unhealthy', `Port ${this.port} already in use — not retrying.`);
      }
    });

    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.handleChildExit(code, signal, opts.isUpdate);
    });

    this.child = child;

    // Reset burst counter on a successful explicit spawn (update or initial).
    if (opts.isUpdate) {
      this.exitTimestamps = [];
      this.currentBackoffMs = INITIAL_BACKOFF_MS;
    }

    this.setHealth('healthy', `Server started (pid=${child.pid ?? 'unknown'}, port=${this.port})`);
  }

  private handleChildExit(
    code: number | null,
    signal: NodeJS.Signals | null,
    wasUpdateSpawn: boolean,
  ): void {
    if (this.stopped) return;

    // Update-initiated clean exit → immediate respawn.
    if (code === 0 && wasUpdateSpawn) {
      this.writeLog('[supervisor] Child exited after update — respawning immediately.');
      this.spawnChild({ isUpdate: false });
      return;
    }

    this.writeLog(`[supervisor] Unexpected child exit (code=${code}, signal=${signal})`);

    const now = Date.now();
    this.exitTimestamps.push(now);
    // Prune timestamps older than the burst window.
    this.exitTimestamps = this.exitTimestamps.filter(
      (t) => now - t <= RAPID_RESTART_WINDOW_MS,
    );

    if (this.exitTimestamps.length > MAX_RAPID_RESTARTS) {
      this.setHealth(
        'unhealthy',
        `Server crashed ${this.exitTimestamps.length} times in ${RAPID_RESTART_WINDOW_MS / 1000}s — stopped retrying.`,
      );
      return;
    }

    const delay = Math.min(this.currentBackoffMs, MAX_BACKOFF_MS);
    this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, MAX_BACKOFF_MS);

    this.setHealth('restarting', `Respawn scheduled in ${delay}ms (attempt ${this.exitTimestamps.length})`);

    this.setTimeoutFn(() => {
      if (!this.stopped) {
        this.spawnChild({ isUpdate: false });
      }
    }, delay);
  }
}

// ── Default injectable implementations ────────────────────────────────────────

function defaultSetTimeout(fn: () => void, ms: number): unknown {
  return globalThis.setTimeout(fn, ms);
}


// ── Path utilities (used by CLI and tray/index) ───────────────────────────────

/**
 * Resolve the absolute path to `dist/cli.js` for the given repo root.
 */
export function resolveCliBin(repoRoot: string): string {
  return join(repoRoot, 'dist', 'cli.js');
}

/**
 * Walk up from this file's location until a `package.json` is found.
 * Returns that directory as the repo root.
 */
export function resolveRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}

/**
 * Resolve the scratchpads directory adjacent to `src/` in the repo.
 */
export function resolveScratchDir(repoRoot: string): string {
  return join(repoRoot, 'scratchpads');
}
