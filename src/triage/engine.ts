/**
 * Triage engine — Tier-0 (git signals) + Tier-2 (LLM batch).
 *
 * Enumerates every OPEN task across all registered projects + the GEN global
 * store by reading markdown files directly — the source of truth — rather than
 * SqliteIndex (which can be stale between reconcile-on-boot runs).
 *
 * This approach is:
 *   - Lock-free: no WAL-lock contention with the running tray server
 *   - Always current: markdown files are written atomically on every task mutation
 *   - Resilient: parse failures on individual files are caught and counted; they
 *     never abort the whole sweep
 *
 * MCPAT-082 performance improvements:
 *   P1: Haiku default model (MCPAT_TRIAGE_MODEL / --model)
 *   P2: Lean CLAUDE_CONFIG_DIR with no SessionStart hooks per spawn
 *   P3: Concurrent Tier-2 batches (--concurrency / MCPAT_TRIAGE_CONCURRENCY, default 4)
 *   P4: Per-repo git-log pre-warm + in-memory ID search + grep cache
 *   P5: Concurrent Tier-0 probes with gh results cache
 *   P6: Default batchSize 10 (was 6)
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { McpTasksConfig } from '../config/loader.js';
import { getDbPath, DEFAULT_TASKS_DIR_NAME } from '../config/loader.js';
import { MarkdownStore } from '../store/markdown-store.js';
import type { Task, TaskStatus } from '../types/task.js';
import { probeMerge, defaultRunner } from './git-signals.js';
import type { CmdRunner, CmdResult } from './git-signals.js';
import { decideTier0 } from './decide.js';
import { isDecision } from './types.js';
import type { TriageDecision, TriageSkip } from './types.js';
import { taskView, buildTriagePrompt, parseTriageVerdicts, mapVerdict } from './llm-triage.js';
import { gatherRepoSignals, summarizeSignals, createRepoCache, warmCommitLog } from './repo-signals.js';
import type { RepoCache } from './repo-signals.js';
import { spawn } from 'node:child_process';
import { resolveClaudeBinary } from '../server-ui.js';
import { applyDecisions, writeRun } from './audit.js';
import { seedLeanConfigDir } from './lean-config.js';

/** Batch LLM runner: accepts a prompt string, returns the full text response. */
export type LlmRunBatch = (prompt: string) => Promise<string>;

// Claude Code env vars that make a spawned claude think it is nested — strip them
// (delete, never set undefined: undefined causes EINVAL on Windows).
const CLAUDE_ENV_STRIP = [
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_IS_HEADLESS',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'ELECTRON_RUN_AS_NODE',
];
export const LLM_BATCH_TIMEOUT_MS = 300_000;

/** Default model for Tier-2 verdicts (P1). Overridable via env or CLI. */
export const DEFAULT_TRIAGE_MODEL = 'claude-haiku-4-5';

/** Path for the lean claude config dir (seeded once per process lifetime, P2). */
const LEAN_CONFIG_DIR = join(tmpdir(), '.claude-triage');

/**
 * Default batch runner: a plain one-shot `claude -p --model <model>` reading
 * the prompt from stdin and accumulating stdout (MCPAT-082 P1 + P2).
 *
 * P1: Passes `--model` (default claude-haiku-4-5; override via MCPAT_TRIAGE_MODEL).
 * P2: Uses a lean CLAUDE_CONFIG_DIR with no SessionStart hooks to cut per-spawn overhead.
 */
export function makeDefaultLlmRunBatch(model?: string): LlmRunBatch {
  const resolvedModel = model ?? process.env['MCPAT_TRIAGE_MODEL'] ?? DEFAULT_TRIAGE_MODEL;

  return (prompt: string): Promise<string> => {
    // Seed lazily on first call — no-op on subsequent calls (idempotent).
    seedLeanConfigDir(LEAN_CONFIG_DIR);
    return new Promise<string>((resolve, reject) => {
      const bin = resolveClaudeBinary();
      const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: LEAN_CONFIG_DIR };
      for (const k of CLAUDE_ENV_STRIP) delete env[k];

      const child = spawn(
        bin,
        buildTriageSpawnArgs(resolvedModel),
        { shell: false, stdio: ['pipe', 'pipe', 'ignore'], env },
      );
      let out = '';
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => finish(() => {
        try { child.kill(); } catch { /* already dead */ }
        reject(new Error('timeout'));
      }), LLM_BATCH_TIMEOUT_MS);

      child.stdout.on('data', (c: Buffer) => { out += c.toString('utf-8'); });
      child.on('close', () => finish(() => resolve(out)));
      child.on('error', (err: Error) => finish(() => reject(err)));
      child.stdin.on('error', () => { /* ignore EPIPE if claude closes stdin early */ });
      if (child.stdin.writable) {
        child.stdin.write(prompt, 'utf-8');
        child.stdin.end();
      }
    });
  };
}

/** @deprecated Use makeDefaultLlmRunBatch() instead. Kept for backwards compat in tests. */
export const defaultLlmRunBatch: LlmRunBatch = makeDefaultLlmRunBatch();

/**
 * Return the CLI args passed to `claude` for a Tier-2 batch spawn.
 * Exported for unit testing — lets tests verify the model flag without spawning.
 */
export function buildTriageSpawnArgs(model: string): string[] {
  return ['-p', '--model', model];
}

export interface TriageLlmOpts {
  enabled: boolean;
  runBatch?: LlmRunBatch;
  threshold?: number;
  batchSize?: number;
  maxTasks?: number;
  /** Model to use for Tier-2 verdicts (P1). Default: claude-haiku-4-5 */
  model?: string;
  /** Max concurrent Tier-2 batches (P3). Default: 4 */
  concurrency?: number;
}

export interface ProjectEntry {
  prefix: string;
  tasksDir: string;
  repoPath: string | null;
}

export interface TaskWithEntry {
  task: Task;
  entry: ProjectEntry;
}

/**
 * Run at most `limit` async thunks simultaneously. Results array preserves
 * input order. Any thrown error propagates (caller decides on resilience).
 */
export async function runBounded<T>(
  thunks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  if (thunks.length === 0) return [];
  const results: T[] = new Array(thunks.length);
  let head = 0;

  const worker = async (): Promise<void> => {
    while (head < thunks.length) {
      const idx = head++;
      results[idx] = await thunks[idx]!();
    }
  };

  const concurrentWorkers = Math.min(limit, thunks.length);
  await Promise.all(Array.from({ length: concurrentWorkers }, worker));
  return results;
}

/**
 * Adaptive batch runner: attempts the full batch; on timeout or error, if tasks.length > 1,
 * splits in half and recurses on each half. If tasks.length === 1, returns an llm-error skip.
 * Bounded recursion (depth ≤ log₂(n)); never throws.
 *
 * P4: Pass `repoCaches` (Map<repoPath, RepoCache>) to share pre-warmed commit logs
 * across tasks in the same repo without redundant git spawns.
 */
export async function runLlmBatchAdaptive(
  tasks: TaskWithEntry[],
  runBatch: LlmRunBatch,
  opts: { nowMs: number; gitRun: CmdRunner; threshold: number; repoCaches?: Map<string, RepoCache> },
): Promise<{ decisions: TriageDecision[]; skips: TriageSkip[] }> {
  if (tasks.length === 0) return { decisions: [], skips: [] };

  const views = tasks.map(({ task, entry }) => {
    const cache = entry.repoPath ? opts.repoCaches?.get(entry.repoPath) : undefined;
    const repoSummary = entry.repoPath
      ? summarizeSignals(gatherRepoSignals(task, entry.repoPath, opts.gitRun, cache))
      : '';
    return taskView(task, opts.nowMs, repoSummary || undefined);
  });
  const prompt = buildTriagePrompt(views);

  let rawOutput: string;
  try {
    rawOutput = await runBatch(prompt);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[triage] LLM batch error (size=${tasks.length}): ${msg}\n`);

    if (tasks.length === 1) {
      return {
        decisions: [],
        skips: [{ taskId: tasks[0]!.task.id, project: tasks[0]!.task.project, reason: 'llm-error', detail: msg }],
      };
    }

    const mid = Math.floor(tasks.length / 2);
    const leftResult = await runLlmBatchAdaptive(tasks.slice(0, mid), runBatch, opts);
    const rightResult = await runLlmBatchAdaptive(tasks.slice(mid), runBatch, opts);
    return {
      decisions: [...leftResult.decisions, ...rightResult.decisions],
      skips: [...leftResult.skips, ...rightResult.skips],
    };
  }

  const verdicts = parseTriageVerdicts(rawOutput);
  const verdictsById = new Map(verdicts.map(v => [v.id, v]));
  const decisions: TriageDecision[] = [];
  const skips: TriageSkip[] = [];
  for (const { task } of tasks) {
    const verdict = verdictsById.get(task.id);
    const outcome = mapVerdict(task, verdict, opts.threshold);
    if (isDecision(outcome)) {
      decisions.push(outcome);
    } else {
      skips.push(outcome);
    }
  }

  return { decisions, skips };
}

// ── gh results cache (P5) ──────────────────────────────────────────────────────

interface GhCacheEntry { state: string; mergedAt: string | null }

/**
 * Wrap a CmdRunner with a gh-results cache (P5).
 * Intercepts `gh pr view <n> --json state,mergedAt` calls and returns the cached
 * result for a PR number that has already been queried in this run.
 */
export function makeGhCachedRunner(run: CmdRunner): { runner: CmdRunner; cache: Map<number, GhCacheEntry | null> } {
  const cache = new Map<number, GhCacheEntry | null>();

  const runner: CmdRunner = (cmd: string, args: string[], cwd?: string): CmdResult => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      const prNum = Number(args[2]);
      if (Number.isFinite(prNum) && prNum > 0) {
        if (cache.has(prNum)) {
          const cached = cache.get(prNum);
          if (cached === null) return { code: 1, stdout: '' };
          return { code: 0, stdout: JSON.stringify(cached) };
        }
        const result = run(cmd, args, cwd);
        if (result.code === 0) {
          try {
            cache.set(prNum, JSON.parse(result.stdout) as GhCacheEntry);
          } catch {
            cache.set(prNum, null);
          }
        } else {
          cache.set(prNum, null);
        }
        return result;
      }
    }
    return run(cmd, args, cwd);
  };

  return { runner, cache };
}

export interface TriageRunOpts {
  nowMs?: number;
  gitRun?: CmdRunner;
  llm?: TriageLlmOpts;
  apply?: boolean;
}

export interface TriageReport {
  decisions: TriageDecision[];
  skips: TriageSkip[];
  totalOpen: number;
  parseErrors: number;
  tier0Count: number;
  tier2Count: number;
  projects: { prefix: string; open: number; resolved: number }[];
  applied?: number;
  failed?: number;
  runId?: string;
}

const OPEN_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'todo', 'in_progress', 'blocked', 'draft', 'approved',
]);

function buildProjectEntries(config: McpTasksConfig): ProjectEntry[] {
  const tasksDirName = config.tasksDirName ?? DEFAULT_TASKS_DIR_NAME;
  const entries: ProjectEntry[] = [];

  if (config.projects.length === 0) {
    // No registered projects — fall back to the directory containing the global DB
    const dbPath = getDbPath(config);
    entries.push({ prefix: 'default', tasksDir: dirname(dbPath), repoPath: null });
    return entries;
  }

  for (const p of config.projects) {
    const tasksDir = join(p.path, tasksDirName);
    entries.push({ prefix: p.prefix, tasksDir, repoPath: p.path });
  }

  // Add the GEN global store if it exists
  const genTasksDir = join(homedir(), '.mcp-tasks', 'tasks', 'gen');
  if (existsSync(genTasksDir)) {
    entries.push({ prefix: 'GEN', tasksDir: genTasksDir, repoPath: null });
  }

  return entries;
}

/** Map of project prefix → tasks markdown dir (for apply/resolve outside a full sweep). */
export function projectTasksDirs(config: McpTasksConfig): Map<string, string> {
  return new Map(buildProjectEntries(config).map(e => [e.prefix, e.tasksDir]));
}

/**
 * Read all task markdown files in the given directory.
 * Skips dotfiles, index.yaml, and any non-.md files.
 * Returns parsed tasks; increments parseErrors for files that fail.
 */
function readTasksFromDir(
  store: MarkdownStore,
  tasksDir: string,
): { tasks: Task[]; parseErrors: number } {
  if (!existsSync(tasksDir)) {
    return { tasks: [], parseErrors: 0 };
  }

  let entries: string[];
  try {
    entries = readdirSync(tasksDir);
  } catch {
    return { tasks: [], parseErrors: 0 };
  }

  const tasks: Task[] = [];
  let parseErrors = 0;

  for (const entry of entries) {
    // Skip dotfiles, index.yaml, and non-.md files
    if (entry.startsWith('.')) continue;
    if (entry === 'index.yaml') continue;
    if (!entry.endsWith('.md')) continue;

    const filePath = join(tasksDir, entry);
    try {
      const task = store.read(filePath);
      tasks.push(task);
    } catch {
      // Resilient: parse failure on one file must not abort the sweep
      parseErrors++;
    }
  }

  return { tasks, parseErrors };
}


/**
 * Run the Tier-0 dry-run triage sweep across all projects.
 * Never writes to disk or SQLite.
 * Reads markdown files directly for a lock-free, always-current enumeration.
 */
export function runTier0Dryrun(
  config: McpTasksConfig,
  opts?: { nowMs?: number; run?: CmdRunner },
): TriageReport {
  const nowMs = opts?.nowMs ?? Date.now();
  const run = opts?.run ?? defaultRunner;

  const entries = buildProjectEntries(config);
  const store = new MarkdownStore();
  const decisions: TriageDecision[] = [];
  const skips: TriageSkip[] = [];
  const projectStats: Map<string, { open: number; resolved: number }> = new Map();
  const seenIds = new Set<string>();
  let totalParseErrors = 0;

  for (const entry of entries) {
    const { tasks, parseErrors } = readTasksFromDir(store, entry.tasksDir);
    totalParseErrors += parseErrors;

    const openTasks = tasks.filter(t => OPEN_STATUSES.has(t.status));
    const stats = { open: 0, resolved: 0 };
    projectStats.set(entry.prefix, stats);

    for (const task of openTasks) {
      if (seenIds.has(task.id)) continue;
      seenIds.add(task.id);

      stats.open++;

      try {
        const ev = probeMerge(task, entry.repoPath, run);
        const outcome = decideTier0(task, ev, nowMs, {});
        if (isDecision(outcome)) {
          decisions.push(outcome);
          stats.resolved++;
        } else {
          skips.push(outcome);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[triage] ERROR probing task ${task.id}: ${msg}\n`,
        );
        skips.push({
          taskId: task.id,
          project: task.project,
          reason: 'no-signal',
          detail: `probe error: ${msg}`,
        });
      }
    }
  }

  const totalOpen = Array.from(projectStats.values()).reduce((s, v) => s + v.open, 0);
  const projects = Array.from(projectStats.entries()).map(([prefix, s]) => ({
    prefix,
    open: s.open,
    resolved: s.resolved,
  }));

  return { decisions, skips, totalOpen, parseErrors: totalParseErrors, tier0Count: decisions.length, tier2Count: 0, projects };
}

/**
 * Full async triage run: Tier-0 git signals + optional Tier-2 LLM batch.
 * If opts.apply is true, applies every decision to the task store and writes an audit log.
 *
 * MCPAT-082 perf improvements applied here:
 *   P3: batches run concurrently up to `llm.concurrency` (default 4)
 *   P4: repo commit logs pre-warmed once per repo; IDs matched in-memory
 *   P5: Tier-0 probes run concurrently via Promise.allSettled + gh results cache
 */
export async function runTriage(
  config: McpTasksConfig,
  opts: TriageRunOpts = {},
): Promise<TriageReport> {
  const nowMs = opts.nowMs ?? Date.now();
  const gitRun = opts.gitRun ?? defaultRunner;
  const llmOpts = opts.llm ?? { enabled: false };
  const threshold = llmOpts.threshold ?? 0.75;
  const batchSize = llmOpts.batchSize ?? 10;  // P6: raised from 6 → 10
  const maxTasks = llmOpts.maxTasks ?? Infinity;
  const concurrency = llmOpts.concurrency ?? 4; // P3
  const runBatch = llmOpts.runBatch ?? makeDefaultLlmRunBatch(llmOpts.model);

  // ── Phase A: enumerate all open tasks from markdown ───────────────────────
  const entries = buildProjectEntries(config);
  const mdStore = new MarkdownStore();
  const allOpenWithEntry: TaskWithEntry[] = [];
  const projectStats: Map<string, { open: number; resolved: number }> = new Map();
  const seenIds = new Set<string>();
  let totalParseErrors = 0;

  for (const entry of entries) {
    const { tasks, parseErrors } = readTasksFromDir(mdStore, entry.tasksDir);
    totalParseErrors += parseErrors;
    const stats = { open: 0, resolved: 0 };
    projectStats.set(entry.prefix, stats);

    for (const task of tasks) {
      if (!OPEN_STATUSES.has(task.status)) continue;
      if (seenIds.has(task.id)) continue;
      seenIds.add(task.id);
      stats.open++;
      allOpenWithEntry.push({ task, entry });
    }
  }

  // ── Phase B: Tier-0 concurrent probes + gh cache (P5) ────────────────────
  const { runner: cachedGhRunner } = makeGhCachedRunner(gitRun);
  const tier0Decisions: TriageDecision[] = [];
  const tier0Skips: TriageSkip[] = [];
  const tier0ResolvedIds = new Set<string>();

  // Run probes concurrently; errors in one probe must not abort others (resilient P5)
  const probeResults = await Promise.allSettled(
    allOpenWithEntry.map(async ({ task, entry }) => {
      const ev = probeMerge(task, entry.repoPath, cachedGhRunner);
      const outcome = decideTier0(task, ev, nowMs, {});
      return { task, entry, outcome };
    }),
  );

  for (const result of probeResults) {
    if (result.status === 'fulfilled') {
      const { task, entry, outcome } = result.value;
      const stats = projectStats.get(entry.prefix) ?? { open: 0, resolved: 0 };
      if (isDecision(outcome)) {
        tier0Decisions.push(outcome);
        tier0ResolvedIds.add(task.id);
        stats.resolved++;
      } else {
        tier0Skips.push(outcome);
      }
    } else {
      // Probe threw — wrap as no-signal skip
      const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
      process.stderr.write(`[triage] ERROR in Tier-0 probe: ${err}\n`);
      // We don't have the task ref here if the promise itself threw before resolving;
      // skip silently (the task will be picked up by Tier-2 if LLM is enabled)
    }
  }

  // ── Phase C: Tier-2 LLM (conditional) ────────────────────────────────────
  const tier2Decisions: TriageDecision[] = [];
  const tier2Skips: TriageSkip[] = [];

  if (llmOpts.enabled) {
    // Candidate set: tasks NOT resolved by Tier-0, and NOT skipped with not-open/claimed-active
    const excludedReasons = new Set<string>(['not-open', 'claimed-active']);
    const tier0SkippedIds = new Set(tier0Skips.map(s => s.taskId));
    const tier0HardSkipIds = new Set(
      tier0Skips.filter(s => excludedReasons.has(s.reason)).map(s => s.taskId)
    );

    const llmCandidates = allOpenWithEntry
      .filter(({ task }) =>
        !tier0ResolvedIds.has(task.id) &&
        !tier0HardSkipIds.has(task.id) &&
        tier0SkippedIds.has(task.id) // must have been a tier-0 skip (not-open/claimed-active excluded above)
      )
      .slice(0, maxTasks);

    // ── P4: Pre-warm commit logs once per unique repo ─────────────────────
    const repoCaches = new Map<string, RepoCache>();
    const uniqueRepos = new Set(llmCandidates.map(({ entry }) => entry.repoPath).filter(Boolean) as string[]);
    for (const repoPath of uniqueRepos) {
      const cache = createRepoCache();
      cache.commitLog = warmCommitLog(repoPath, gitRun);
      repoCaches.set(repoPath, cache);
    }

    // Chunk into batches
    const batches: TaskWithEntry[][] = [];
    for (let i = 0; i < llmCandidates.length; i += batchSize) {
      batches.push(llmCandidates.slice(i, i + batchSize));
    }

    // ── P3: Run batches concurrently, bounded by concurrency ──────────────
    const batchThunks = batches.map(batch =>
      () => runLlmBatchAdaptive(batch, runBatch, { nowMs, gitRun, threshold, repoCaches }),
    );
    const batchResults = await runBounded(batchThunks, concurrency);

    for (const { decisions, skips } of batchResults) {
      tier2Decisions.push(...decisions);
      tier2Skips.push(...skips);
      for (const d of decisions) {
        const stats = projectStats.get(d.project) ?? { open: 0, resolved: 0 };
        stats.resolved++;
      }
    }
  }

  // ── Merge results ─────────────────────────────────────────────────────────
  const allDecisions = [...tier0Decisions, ...tier2Decisions];
  const allSkips = [...tier0Skips, ...tier2Skips];
  const totalOpen = Array.from(projectStats.values()).reduce((s, v) => s + v.open, 0);
  const projects = Array.from(projectStats.entries()).map(([prefix, s]) => ({
    prefix,
    open: s.open,
    resolved: s.resolved,
  }));

  const report: TriageReport = {
    decisions: allDecisions,
    skips: allSkips,
    totalOpen,
    parseErrors: totalParseErrors,
    tier0Count: tier0Decisions.length,
    tier2Count: tier2Decisions.length,
    projects,
  };

  // ── Phase D: Apply (optional) ─────────────────────────────────────────────
  if (opts.apply && allDecisions.length > 0) {
    const tasksDirByPrefix = new Map(entries.map(e => [e.prefix, e.tasksDir]));
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const { applied, failed, entries: auditEntries } = await applyDecisions(allDecisions, config, tasksDirByPrefix);

    if (auditEntries.length > 0) {
      try {
        await writeRun(runId, auditEntries);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[triage] WARN: could not write audit log: ${msg}\n`);
      }
    }

    report.applied = applied;
    report.failed = failed;
    report.runId = runId;
  }

  return report;
}
