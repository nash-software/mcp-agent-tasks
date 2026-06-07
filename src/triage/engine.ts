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
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { McpTasksConfig } from '../config/loader.js';
import { getDbPath, DEFAULT_TASKS_DIR_NAME } from '../config/loader.js';
import { MarkdownStore } from '../store/markdown-store.js';
import type { Task, TaskStatus } from '../types/task.js';
import { probeMerge, defaultRunner } from './git-signals.js';
import type { CmdRunner } from './git-signals.js';
import { decideTier0 } from './decide.js';
import { isDecision } from './types.js';
import type { TriageDecision, TriageSkip } from './types.js';
import { taskView, buildTriagePrompt, parseTriageVerdicts, mapVerdict } from './llm-triage.js';
import { spawnClaudeStream } from '../lib/claude-stream.js';
import { resolveClaudeBinary } from '../server-ui.js';
import { applyDecisions, writeRun } from './audit.js';

/** Batch LLM runner: accepts a prompt string, returns the full text response. */
export type LlmRunBatch = (prompt: string) => Promise<string>;

/** Default batch runner using the streaming claude CLI. */
const defaultLlmRunBatch: LlmRunBatch = async (prompt: string): Promise<string> => {
  const bin = resolveClaudeBinary();
  let text = '';
  for await (const f of spawnClaudeStream({ bin, prompt, timeoutMs: 180_000 })) {
    if (f.type === 'delta') text += f.text;
    else if (f.type === 'error') throw new Error(f.message);
  }
  return text;
};

export interface TriageLlmOpts {
  enabled: boolean;
  runBatch?: LlmRunBatch;
  threshold?: number;
  batchSize?: number;
  maxTasks?: number;
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

interface ProjectEntry {
  prefix: string;
  tasksDir: string;
  repoPath: string | null;
}

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

/** Internal: a task paired with the project entry that owns it. */
interface TaskWithEntry {
  task: Task;
  entry: ProjectEntry;
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
 */
export async function runTriage(
  config: McpTasksConfig,
  opts: TriageRunOpts = {},
): Promise<TriageReport> {
  const nowMs = opts.nowMs ?? Date.now();
  const gitRun = opts.gitRun ?? defaultRunner;
  const llmOpts = opts.llm ?? { enabled: false };
  const threshold = llmOpts.threshold ?? 0.85;
  const batchSize = llmOpts.batchSize ?? 15;
  const maxTasks = llmOpts.maxTasks ?? Infinity;
  const runBatch = llmOpts.runBatch ?? defaultLlmRunBatch;

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

  // ── Phase B: Tier-0 per-task ──────────────────────────────────────────────
  const tier0Decisions: TriageDecision[] = [];
  const tier0Skips: TriageSkip[] = [];
  const tier0ResolvedIds = new Set<string>();

  for (const { task, entry } of allOpenWithEntry) {
    const stats = projectStats.get(entry.prefix) ?? { open: 0, resolved: 0 };
    try {
      const ev = probeMerge(task, entry.repoPath, gitRun);
      const outcome = decideTier0(task, ev, nowMs, {});
      if (isDecision(outcome)) {
        tier0Decisions.push(outcome);
        tier0ResolvedIds.add(task.id);
        stats.resolved++;
      } else {
        tier0Skips.push(outcome);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[triage] ERROR probing task ${task.id}: ${msg}\n`);
      tier0Skips.push({ taskId: task.id, project: task.project, reason: 'no-signal', detail: `probe error: ${msg}` });
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

    // Chunk into batches
    const batches: TaskWithEntry[][] = [];
    for (let i = 0; i < llmCandidates.length; i += batchSize) {
      batches.push(llmCandidates.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      const views = batch.map(({ task }) => taskView(task, nowMs));
      const prompt = buildTriagePrompt(views);

      let rawOutput: string;
      try {
        rawOutput = await runBatch(prompt);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[triage] LLM batch error: ${msg}\n`);
        for (const { task } of batch) {
          tier2Skips.push({ taskId: task.id, project: task.project, reason: 'llm-error', detail: msg });
        }
        continue;
      }

      const verdicts = parseTriageVerdicts(rawOutput);
      const verdictsById = new Map(verdicts.map(v => [v.id, v]));

      for (const { task } of batch) {
        const verdict = verdictsById.get(task.id);
        const outcome = mapVerdict(task, verdict, threshold);
        const stats = projectStats.get(task.project) ?? { open: 0, resolved: 0 };
        if (isDecision(outcome)) {
          tier2Decisions.push(outcome);
          stats.resolved++;
        } else {
          tier2Skips.push(outcome);
        }
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
