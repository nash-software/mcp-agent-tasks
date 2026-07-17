/**
 * Triage audit log — write/read JSONL audit files, apply decisions to stores,
 * and undo a prior run by reversing each applied transition.
 *
 * Audit dir: scratchpads/.triage-runs/ under the process cwd (or package root).
 * One file per run: <runId>.jsonl, atomic write (temp + rename).
 */
import { existsSync, mkdirSync, writeFileSync, renameSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { McpTasksConfig } from '../config/loader.js';
import { resolveServerDbPath, resolveProjectTasksDir } from '../config/loader.js';
import { SqliteIndex } from '../store/sqlite-index.js';
import { MarkdownStore } from '../store/markdown-store.js';
import { ManifestWriter } from '../store/manifest-writer.js';
import { TaskStore } from '../store/task-store.js';
import { transitionPath } from './decide.js';
import type { TriageDecision } from './types.js';
import type { TaskStatus } from '../types/task.js';
import type { TriageReport } from './engine.js';

/** One entry per successfully applied decision, written to the run JSONL file. */
export interface AuditEntry {
  taskId: string;
  project: string;
  tier: 0 | 2;
  signal: string;
  detail: string;
  confidence?: number;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  path: TaskStatus[];
  appliedAt: string;
}

/** Directory where audit JSONL files are written. */
function auditDir(): string {
  return join(process.cwd(), 'scratchpads', '.triage-runs');
}

/** Full path to a run's JSONL file. */
function runFilePath(runId: string): string {
  return join(auditDir(), `${runId}.jsonl`);
}

/** Ensure the audit directory exists. */
function ensureAuditDir(): void {
  const dir = auditDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Atomically write audit entries for a run.
 * Each line is a JSON-serialised AuditEntry.
 */
export async function writeRun(runId: string, entries: AuditEntry[]): Promise<void> {
  ensureAuditDir();
  const filePath = runFilePath(runId);
  const tmp = `${filePath}.tmp.${process.pid}`;
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

/**
 * Read and parse an existing run's audit entries.
 * Returns an empty array if the file does not exist.
 */
export function readRun(runId: string): AuditEntry[] {
  const filePath = runFilePath(runId);
  if (!existsSync(filePath)) return [];

  const lines = readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim().length > 0);
  const entries: AuditEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as AuditEntry;
      entries.push(parsed);
    } catch {
      // Malformed line — skip silently (resilient)
    }
  }
  return entries;
}

// ── Latest-report persistence ──────────────────────────────────────────────────
// A single "latest.report.json" file in the audit dir lets TriageView rehydrate
// its sweep result across page navigations without re-running the AI sweep.

/** A persisted triage report — extends TriageReport with a savedAt ISO-8601 timestamp. */
export interface PersistedTriageReport extends TriageReport {
  savedAt: string;
}

/** Full path to the latest report JSON file. */
function latestReportPath(): string {
  return join(auditDir(), 'latest.report.json');
}

/**
 * Atomically write the latest triage report to disk.
 * Uses a temp-file rename to be NTFS/POSIX safe.
 */
export function writeLatestReport(report: TriageReport): void {
  ensureAuditDir();
  const filePath = latestReportPath();
  const tmp = `${filePath}.tmp.${process.pid}`;
  const persisted: PersistedTriageReport = { ...report, savedAt: new Date().toISOString() };
  writeFileSync(tmp, JSON.stringify(persisted), 'utf-8');
  renameSync(tmp, filePath);
}

/**
 * Read and parse the latest persisted triage report.
 * Returns null if the file is absent or unreadable.
 */
export function readLatestReport(): PersistedTriageReport | null {
  const filePath = latestReportPath();
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PersistedTriageReport;
  } catch {
    return null;
  }
}

/**
 * Delete the latest persisted triage report (called after successful Apply).
 * Silently ignores missing files.
 */
export function deleteLatestReport(): void {
  const filePath = latestReportPath();
  try {
    rmSync(filePath, { force: true });
  } catch {
    // Silently ignore deletion errors (file may not exist)
  }
}

// ──────────────────────────────────────────────────────────────────────────────

/** Build a TaskStore for the given project/tasksDir, mirroring cli.ts buildStore. */
function buildStore(tasksDir: string, project: string, config: McpTasksConfig): TaskStore {
  const dbPath = resolveServerDbPath(tasksDir, config, project !== 'DEFAULT' ? project : undefined);
  const sqliteIndex = new SqliteIndex(dbPath);
  sqliteIndex.init();
  const markdownStore = new MarkdownStore();
  const manifestWriter = new ManifestWriter();
  return new TaskStore(markdownStore, sqliteIndex, manifestWriter, tasksDir, project);
}

export interface ApplyResult {
  applied: number;
  failed: number;
  entries: AuditEntry[];
}

/**
 * Apply all triage decisions by walking each decision's transition path hop-by-hop.
 * A failed per-task transition never aborts the run.
 */
export async function applyDecisions(
  decisions: TriageDecision[],
  config: McpTasksConfig,
  tasksDirByPrefix: Map<string, string>,
): Promise<ApplyResult> {
  let applied = 0;
  let failed = 0;
  const entries: AuditEntry[] = [];

  for (const decision of decisions) {
    const prefix = decision.taskId.split('-')[0] ?? decision.project;
    const tasksDir = tasksDirByPrefix.get(prefix) ?? tasksDirByPrefix.get(decision.project);

    if (!tasksDir) {
      process.stderr.write(`[triage] WARN: no tasksDir for prefix ${prefix}, skipping ${decision.taskId}\n`);
      failed++;
      continue;
    }

    let store: TaskStore;
    try {
      store = buildStore(tasksDir, prefix, config);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[triage] WARN: could not open store for ${prefix}: ${msg}\n`);
      failed++;
      continue;
    }

    // Walk the path hop-by-hop (skipping the first element which is fromStatus)
    const hops = decision.path.slice(1); // [hop1, hop2, ..., done]
    let stepFailed = false;
    for (const nextStatus of hops) {
      try {
        store.transitionTask(
          decision.taskId,
          nextStatus,
          `auto-triage:tier${decision.tier}:${decision.signal}`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[triage] WARN: transition ${decision.taskId} → ${nextStatus} failed: ${msg}\n`);
        stepFailed = true;
        break;
      }
    }

    if (stepFailed) {
      failed++;
    } else {
      applied++;
      const entry: AuditEntry = {
        taskId: decision.taskId,
        project: decision.project,
        tier: decision.tier,
        signal: decision.signal,
        detail: decision.detail,
        fromStatus: decision.fromStatus,
        toStatus: decision.toStatus,
        path: decision.path,
        appliedAt: new Date().toISOString(),
        ...(decision.confidence !== undefined ? { confidence: decision.confidence } : {}),
      };
      entries.push(entry);
    }
  }

  return { applied, failed, entries };
}

export interface UndoResult {
  reverted: number;
  failed: number;
}

/**
 * Undo a prior triage run: read the audit JSONL and for each entry, compute
 * the reverse transition path (toStatus → fromStatus) and apply it.
 */
export async function undoRun(runId: string, config: McpTasksConfig): Promise<UndoResult> {
  const entries = readRun(runId);
  if (entries.length === 0) return { reverted: 0, failed: 0 };

  // Re-enumerate project entries to get tasksDirs
  // (We need the same prefix→tasksDir mapping as the forward run.)
  const { homedir } = await import('node:os');
  const { join: pathJoin } = await import('node:path');

  const tasksDirByPrefix = new Map<string, string>();
  for (const p of config.projects) {
    tasksDirByPrefix.set(p.prefix, resolveProjectTasksDir(p, config));
  }
  const genDir = pathJoin(homedir(), '.mcp-tasks', 'tasks', 'gen');
  if (existsSync(genDir)) {
    tasksDirByPrefix.set('GEN', genDir);
  }

  let reverted = 0;
  let failed = 0;

  for (const entry of entries) {
    const prefix = entry.taskId.split('-')[0] ?? entry.project;
    const tasksDir = tasksDirByPrefix.get(prefix) ?? tasksDirByPrefix.get(entry.project);

    if (!tasksDir) {
      process.stderr.write(`[triage-undo] WARN: no tasksDir for prefix ${prefix}, skipping ${entry.taskId}\n`);
      failed++;
      continue;
    }

    let store: TaskStore;
    try {
      store = buildStore(tasksDir, prefix, config);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[triage-undo] WARN: could not open store for ${prefix}: ${msg}\n`);
      failed++;
      continue;
    }

    // Compute reverse path: current status → fromStatus
    const reversePath = transitionPath(entry.toStatus, entry.fromStatus);
    if (!reversePath) {
      process.stderr.write(`[triage-undo] WARN: no reverse path ${entry.toStatus}→${entry.fromStatus} for ${entry.taskId}\n`);
      failed++;
      continue;
    }

    const hops = reversePath.slice(1);
    let stepFailed = false;
    for (const nextStatus of hops) {
      try {
        store.transitionTask(entry.taskId, nextStatus, `undo-triage:${runId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[triage-undo] WARN: reverse transition ${entry.taskId} → ${nextStatus} failed: ${msg}\n`);
        stepFailed = true;
        break;
      }
    }

    if (stepFailed) {
      failed++;
    } else {
      reverted++;
    }
  }

  return { reverted, failed };
}
