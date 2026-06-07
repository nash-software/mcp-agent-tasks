/**
 * Tier-0 triage engine (dry-run enumeration).
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

export interface TriageReport {
  decisions: TriageDecision[];
  skips: TriageSkip[];
  totalOpen: number;
  parseErrors: number;
  projects: { prefix: string; open: number; resolved: number }[];
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
      // Dedup: the same task id must not be processed twice across directories
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

  return { decisions, skips, totalOpen, parseErrors: totalParseErrors, projects };
}
