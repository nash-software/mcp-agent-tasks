import fs from 'node:fs';
import path from 'node:path';
import { SqliteIndex } from '../store/sqlite-index.js';
import { MarkdownStore } from '../store/markdown-store.js';
import { ManifestWriter } from '../store/manifest-writer.js';
import { TaskStore } from '../store/task-store.js';
import { loadConfig, getDbPath, DEFAULT_TASKS_DIR_NAME } from '../config/loader.js';
import type { TaskUpdateInput } from '../types/tools.js';
import { listMergedPrs, findPrByBranch } from '../lib/gh-client.js';
import { matchTasksToPrs } from '../lib/llm-matcher.js';
import { resolvePath } from '../lib/normalize-path.js';
import type { Task } from '../types/task.js';
import type { MergedPr } from '../lib/gh-client.js';

export type AuditAction = 'transitioned_done' | 'tagged_review' | 'no_signal';
export type AuditMethod = 'branch_lookup' | 'llm_match' | 'none';
export type AuditConfidence = 'high' | 'medium' | 'low' | 'none';

export interface AuditResult {
  taskId: string;
  title: string;
  action: AuditAction;
  method: AuditMethod;
  confidence: AuditConfidence;
  evidence?: {
    prNumber?: number;
    prTitle?: string;
    mergedAt?: string;
    reason?: string;
  };
}

export interface AuditSummary {
  dryRun: boolean;
  scanned: number;
  transitioned: number;
  taggedReview: number;
  noSignal: number;
  results: AuditResult[];
}

function buildStore(projectPath: string, prefix: string, tasksDirName: string): { store: TaskStore; index: SqliteIndex } {
  const tasksDir = path.join(projectPath, tasksDirName);
  const dbPath = fs.existsSync(tasksDir)
    ? path.join(tasksDir, '.index.db')
    : getDbPath();
  const index = new SqliteIndex(dbPath);
  index.init();
  const markdownStore = new MarkdownStore();
  const manifestWriter = new ManifestWriter();
  const store = new TaskStore(markdownStore, index, manifestWriter, tasksDir, prefix);
  return { store, index };
}

function derivePrefix(projectPath: string): string {
  try {
    const raw = fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { name?: string };
    if (typeof pkg.name === 'string' && pkg.name) {
      return pkg.name.replace(/^@[^/]+\//, '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    }
  } catch { /* fall through */ }
  return path.basename(projectPath).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

export async function auditTasks(opts: {
  projectPath: string;
  idPrefix?: string;
  dryRun?: boolean;
  noLlm?: boolean;
}): Promise<AuditSummary> {
  const projectPath = resolvePath(opts.projectPath);
  const dryRun = opts.dryRun ?? false;
  const noLlm = opts.noLlm ?? false;

  const config = loadConfig();
  const tasksDirName = config.tasksDirName ?? DEFAULT_TASKS_DIR_NAME;
  const prefix = opts.idPrefix ?? derivePrefix(projectPath);

  const { store, index } = buildStore(projectPath, prefix, tasksDirName);

  // Load all in_progress tasks
  const tasks: Task[] = index.listTasks({ status: 'in_progress', project: prefix });

  if (tasks.length === 0) {
    return { dryRun, scanned: 0, transitioned: 0, taggedReview: 0, noSignal: 0, results: [] };
  }

  const results: AuditResult[] = [];
  const remaining: Task[] = [];

  // ── Stage 1: branch lookup ─────────────────────────────────────────────────
  for (const task of tasks) {
    const branch = task.git?.branch;
    if (!branch) {
      remaining.push(task);
      continue;
    }

    const pr = findPrByBranch(projectPath, branch);
    if (pr) {
      results.push({
        taskId: task.id,
        title: task.title,
        action: 'transitioned_done',
        method: 'branch_lookup',
        confidence: 'high',
        evidence: { prNumber: pr.number, prTitle: pr.title, mergedAt: pr.mergedAt },
      });
    } else {
      // Branch exists in task but not merged yet — keep as-is
      results.push({
        taskId: task.id,
        title: task.title,
        action: 'no_signal',
        method: 'branch_lookup',
        confidence: 'none',
      });
    }
  }

  // ── Stage 2: LLM title matching ────────────────────────────────────────────
  if (remaining.length > 0 && !noLlm) {
    const allPrs: MergedPr[] = listMergedPrs(projectPath);

    if (allPrs.length > 0) {
      const matches = await matchTasksToPrs(
        remaining.map(t => ({ id: t.id, title: t.title })),
        allPrs,
      );

      const matchMap = new Map(matches.map(m => [m.taskId, m]));

      for (const task of remaining) {
        const match = matchMap.get(task.id);
        const pr = match ? allPrs.find(p => p.number === match.prNumber) : undefined;

        if (match && pr && match.confidence !== 'low') {
          results.push({
            taskId: task.id,
            title: task.title,
            action: 'transitioned_done',
            method: 'llm_match',
            confidence: match.confidence,
            evidence: {
              prNumber: pr.number,
              prTitle: pr.title,
              mergedAt: pr.mergedAt,
              reason: match.reason,
            },
          });
        } else {
          // Low confidence or no match → tag for manual review
          results.push({
            taskId: task.id,
            title: task.title,
            action: 'tagged_review',
            method: match ? 'llm_match' : 'none',
            confidence: match?.confidence ?? 'none',
            evidence: match && pr
              ? { prNumber: pr.number, prTitle: pr.title, reason: match.reason }
              : undefined,
          });
        }
      }
    } else {
      // gh not available or no PRs found — tag everything remaining
      for (const task of remaining) {
        results.push({
          taskId: task.id,
          title: task.title,
          action: 'tagged_review',
          method: 'none',
          confidence: 'none',
        });
      }
    }
  } else if (remaining.length > 0) {
    // --no-llm: tag all remaining for review
    for (const task of remaining) {
      results.push({
        taskId: task.id,
        title: task.title,
        action: 'tagged_review',
        method: 'none',
        confidence: 'none',
      });
    }
  }

  // ── Apply transitions ──────────────────────────────────────────────────────
  if (!dryRun) {
    for (const r of results) {
      if (r.action === 'transitioned_done') {
        const reason = r.evidence?.prNumber
          ? `Completed via PR #${r.evidence.prNumber} — detected by ${r.method} (${r.confidence} confidence)`
          : `Detected as done by ${r.method}`;
        try {
          store.transitionTask(r.taskId, 'done', reason);
        } catch {
          // Task may no longer exist or already transitioned — skip silently
        }
      } else if (r.action === 'tagged_review') {
        // Add needs_review tag without changing status
        try {
          const task = index.getTask(r.taskId);
          if (task && !task.tags.includes('needs_review')) {
            const update: TaskUpdateInput = { id: r.taskId, tags: [...task.tags, 'needs_review'] };
            store.updateTask(r.taskId, update);
          }
        } catch {
          // Skip silently
        }
      }
    }
  }

  const transitioned = results.filter(r => r.action === 'transitioned_done').length;
  const taggedReview = results.filter(r => r.action === 'tagged_review').length;
  const noSignal = results.filter(r => r.action === 'no_signal').length;

  return { dryRun, scanned: tasks.length, transitioned, taggedReview, noSignal, results };
}
