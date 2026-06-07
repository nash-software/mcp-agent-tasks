/**
 * Tier-0 triage engine (dry-run enumeration).
 *
 * Enumerates every OPEN task across all registered projects + the GEN global
 * store, probes each for merge evidence, and returns a TriageReport — without
 * writing anything to disk or SQLite.
 *
 * DB open strategy: opens each SqliteIndex read-only (no reconcileIndexOnBoot);
 * if an index is locked or broken, that project is skipped with a stderr warning
 * so a single bad index cannot abort the sweep.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { McpTasksConfig } from '../config/loader.js';
import { getDbPath, resolveServerDbPath, DEFAULT_TASKS_DIR_NAME } from '../config/loader.js';
import { SqliteIndex } from '../store/sqlite-index.js';
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
  projects: { prefix: string; open: number; resolved: number }[];
}

const OPEN_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'todo', 'in_progress', 'blocked', 'draft', 'approved',
]);

interface ProjectEntry {
  prefix: string;
  dbPath: string;
  repoPath: string | null;
}

function buildProjectEntries(config: McpTasksConfig): ProjectEntry[] {
  const tasksDirName = config.tasksDirName ?? DEFAULT_TASKS_DIR_NAME;
  const entries: ProjectEntry[] = [];

  if (config.projects.length === 0) {
    // No registered projects — fall back to global DB (repoPath unknown)
    entries.push({ prefix: 'default', dbPath: getDbPath(config), repoPath: null });
    return entries;
  }

  for (const p of config.projects) {
    const tasksDir = join(p.path, tasksDirName);
    const dbPath = resolveServerDbPath(tasksDir, config, p.prefix);
    entries.push({ prefix: p.prefix, dbPath, repoPath: p.path });
  }

  // Add the GEN global store if it exists
  const genTasksDir = join(homedir(), '.mcp-tasks', 'tasks', 'gen');
  const genDbPath = join(genTasksDir, '.index.db');
  if (existsSync(genDbPath)) {
    entries.push({ prefix: 'GEN', dbPath: genDbPath, repoPath: null });
  }

  return entries;
}

/**
 * Run the Tier-0 dry-run triage sweep across all projects.
 * Never writes to disk or SQLite.
 */
export function runTier0Dryrun(
  config: McpTasksConfig,
  opts?: { nowMs?: number; run?: CmdRunner },
): TriageReport {
  const nowMs = opts?.nowMs ?? Date.now();
  const run = opts?.run ?? defaultRunner;

  const entries = buildProjectEntries(config);
  const decisions: TriageDecision[] = [];
  const skips: TriageSkip[] = [];
  const projectStats: Map<string, { open: number; resolved: number }> = new Map();
  const seenIds = new Set<string>();

  for (const entry of entries) {
    // Resilient: a locked/broken index must not abort the whole sweep
    let index: SqliteIndex | null = null;
    let tasks: Task[] = [];

    try {
      index = new SqliteIndex(entry.dbPath);
      index.init();
      // listTasks({}) returns all tasks; we filter to open statuses below
      tasks = index.listTasks({});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[triage] SKIP project ${entry.prefix} (${entry.dbPath}): ${msg}\n`,
      );
      continue;
    } finally {
      try { index?.close(); } catch { /* ignore */ }
    }

    const openTasks = tasks.filter(t => OPEN_STATUSES.has(t.status));
    const stats = { open: 0, resolved: 0 };
    projectStats.set(entry.prefix, stats);

    for (const task of openTasks) {
      // Dedup: global store can surface the same task under multiple project indexes
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

  return { decisions, skips, totalOpen, projects };
}
