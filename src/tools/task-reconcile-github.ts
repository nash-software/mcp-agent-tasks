import fs from 'node:fs';
import path from 'node:path';
import { SqliteIndex } from '../store/sqlite-index.js';
import { MarkdownStore } from '../store/markdown-store.js';
import { ManifestWriter } from '../store/manifest-writer.js';
import { TaskStore } from '../store/task-store.js';
import { loadConfig, getDbPath, DEFAULT_TASKS_DIR_NAME } from '../config/loader.js';
import { listMergedPrs } from '../lib/gh-client.js';
import { getDefaultBranch, findCommitsByTaskId } from '../lib/git-inference.js';
import { resolvePath } from '../lib/normalize-path.js';
import { VALID_TRANSITIONS } from '../types/transitions.js';
import { MAX_COMMITS } from '../store/limits.js';
import type { MergedPr } from '../lib/gh-client.js';
import type { TaskUpdateInput } from '../types/tools.js';
import type { Task, TaskStatus, GitLink, PRRef, CommitRef } from '../types/task.js';

// Carries the git link through updateTask, matching task-link-pr/commit.
interface UpdateWithGit extends TaskUpdateInput {
  git?: GitLink;
}

/** Statuses that represent open work still able to reach `done`. */
const RECONCILABLE_STATUSES: readonly TaskStatus[] = [
  'todo',
  'in_progress',
  'blocked',
  'approved',
  'draft',
];

export type ReconcileMethod = 'pr_match' | 'commit_match' | 'none';

export interface ReconcileResult {
  taskId: string;
  title: string;
  fromStatus: TaskStatus;
  action: 'reconciled' | 'no_signal';
  method: ReconcileMethod;
  evidence?: {
    prNumber?: number;
    prUrl?: string;
    prTitle?: string;
    sha?: string;
    commitMessage?: string;
    mergedAt?: string;
  };
}

export interface ReconcileSummary {
  dryRun: boolean;
  scanned: number;
  reconciled: number;
  noSignal: number;
  results: ReconcileResult[];
}

/**
 * Injectable dependencies. Defaults wire the real store, gh, and git helpers;
 * tests pass fakes so the orchestration is exercised without a live repo.
 */
export interface ReconcileDeps {
  store: Pick<TaskStore, 'updateTask' | 'transitionTask'>;
  listTasks: () => Task[];
  listMergedPrs: (projectPath: string) => MergedPr[];
  getDefaultBranch: (projectPath: string) => string;
  findCommitsByTaskId: (projectPath: string, taskId: string, branch?: string) => CommitRef[];
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

function buildStore(projectPath: string, prefix: string, tasksDirName: string): { store: TaskStore; index: SqliteIndex } {
  const tasksDir = path.join(projectPath, tasksDirName);
  const dbPath = fs.existsSync(tasksDir) ? path.join(tasksDir, '.index.db') : getDbPath();
  const index = new SqliteIndex(dbPath);
  index.init();
  const store = new TaskStore(new MarkdownStore(), index, new ManifestWriter(), tasksDir, prefix);
  return { store, index };
}

/** True when the task ID appears as a whole word in the PR title, branch, or body. */
export function prMatchesTaskId(pr: MergedPr, taskId: string): boolean {
  const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`);
  return re.test(pr.title) || re.test(pr.headRefName) || re.test(pr.body ?? '');
}

/**
 * Ordered list of statuses to transition through to reach `done`, computed via
 * BFS over the state machine. `todo`/`blocked`/`draft`/`approved` cannot go to
 * `done` directly, so they route through `in_progress`. Empty when already done
 * or unreachable.
 */
export function pathToDone(from: TaskStatus): TaskStatus[] {
  if (from === 'done') return [];
  const queue: TaskStatus[][] = [[from]];
  const seen = new Set<TaskStatus>([from]);
  while (queue.length > 0) {
    const p = queue.shift() as TaskStatus[];
    const last = p[p.length - 1] as TaskStatus;
    for (const next of VALID_TRANSITIONS[last]) {
      if (next === 'done') return [...p.slice(1), next];
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...p, next]);
      }
    }
  }
  return [];
}

function transitionToDone(
  store: Pick<TaskStore, 'transitionTask'>,
  taskId: string,
  from: TaskStatus,
  finalReason: string,
): void {
  const steps = pathToDone(from);
  steps.forEach((to, i) => {
    const reason = i === steps.length - 1 ? finalReason : `reconcile: advancing to ${to} to reach done`;
    store.transitionTask(taskId, to, reason);
  });
}

export async function reconcileTasksGithub(
  opts: { projectPath: string; idPrefix?: string; dryRun?: boolean },
  deps?: Partial<ReconcileDeps>,
): Promise<ReconcileSummary> {
  const projectPath = resolvePath(opts.projectPath);
  const dryRun = opts.dryRun ?? false;

  const config = loadConfig();
  const tasksDirName = config.tasksDirName ?? DEFAULT_TASKS_DIR_NAME;
  const prefix = opts.idPrefix ?? derivePrefix(projectPath);

  // Resolve store + index (real by default, injected in tests).
  let store = deps?.store;
  let listTasks = deps?.listTasks;
  if (!store || !listTasks) {
    const built = buildStore(projectPath, prefix, tasksDirName);
    store = store ?? built.store;
    const index = built.index;
    listTasks = listTasks ?? ((): Task[] => index.listTasks({ project: prefix, limit: 5000 }));
  }

  const listPrs = deps?.listMergedPrs ?? listMergedPrs;
  const defaultBranchFn = deps?.getDefaultBranch ?? getDefaultBranch;
  const findCommits = deps?.findCommitsByTaskId ?? findCommitsByTaskId;

  const tasks = listTasks().filter(t => RECONCILABLE_STATUSES.includes(t.status));

  if (tasks.length === 0) {
    return { dryRun, scanned: 0, reconciled: 0, noSignal: 0, results: [] };
  }

  const prs = listPrs(projectPath);
  const defaultBranch = defaultBranchFn(projectPath);

  const results: ReconcileResult[] = [];

  for (const task of tasks) {
    // ── Signal 1: merged PR referencing the task ID ──────────────────────────
    const pr = prs.find(p => prMatchesTaskId(p, task.id));
    if (pr) {
      results.push({
        taskId: task.id,
        title: task.title,
        fromStatus: task.status,
        action: 'reconciled',
        method: 'pr_match',
        evidence: { prNumber: pr.number, prUrl: pr.url, prTitle: pr.title, mergedAt: pr.mergedAt },
      });
      continue;
    }

    // ── Signal 2: default-branch commit referencing the task ID (squash-merge) ─
    const commit = findCommits(projectPath, task.id, defaultBranch)[0];
    if (commit) {
      results.push({
        taskId: task.id,
        title: task.title,
        fromStatus: task.status,
        action: 'reconciled',
        method: 'commit_match',
        evidence: { sha: commit.sha, commitMessage: commit.message },
      });
      continue;
    }

    results.push({
      taskId: task.id,
      title: task.title,
      fromStatus: task.status,
      action: 'no_signal',
      method: 'none',
    });
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  if (!dryRun) {
    for (const r of results) {
      if (r.action !== 'reconciled') continue;
      try {
        const original = tasks.find(t => t.id === r.taskId);
        if (!original) continue;

        if (r.method === 'pr_match' && r.evidence?.prNumber !== undefined) {
          const pr: PRRef = {
            number: r.evidence.prNumber,
            url: r.evidence.prUrl ?? '',
            title: r.evidence.prTitle ?? '',
            state: 'merged',
            merged_at: r.evidence.mergedAt ?? null,
            base_branch: original.git.pr?.base_branch ?? '',
          };
          const git: GitLink = { ...original.git, pr };
          const payload: UpdateWithGit = { id: r.taskId, git };
          store.updateTask(r.taskId, payload);
          transitionToDone(store, r.taskId, r.fromStatus, `reconciled via PR #${pr.number} (GitHub)`);
        } else if (r.method === 'commit_match' && r.evidence?.sha) {
          const commit: CommitRef = {
            sha: r.evidence.sha,
            message: r.evidence.commitMessage ?? '',
            authored_at: new Date().toISOString(),
          };
          const alreadyLinked = original.git.commits.some(c => c.sha === commit.sha);
          const git: GitLink = {
            ...original.git,
            commits: alreadyLinked ? original.git.commits : [...original.git.commits, commit].slice(-MAX_COMMITS),
          };
          const payload: UpdateWithGit = { id: r.taskId, git };
          store.updateTask(r.taskId, payload);
          transitionToDone(store, r.taskId, r.fromStatus, `reconciled via ${commit.sha.slice(0, 7)} (GitHub)`);
        }
      } catch {
        // Task may have changed underneath us — skip silently, leave for next run.
      }
    }
  }

  const reconciled = results.filter(r => r.action === 'reconciled').length;
  const noSignal = results.filter(r => r.action === 'no_signal').length;

  return { dryRun, scanned: tasks.length, reconciled, noSignal, results };
}
