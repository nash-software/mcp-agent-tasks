import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Task, TaskStatus } from '../../../src/types/task.js';
import type { MergedPr } from '../../../src/lib/gh-client.js';
import {
  reconcileTasksGithub,
  prMatchesTaskId,
  isTaskBookkeepingPr,
  pathToDone,
  type ReconcileDeps,
} from '../../../src/tools/task-reconcile-github.js';
import { resolveServerDbPath, DEFAULT_TASKS_DIR_NAME } from '../../../src/config/loader.js';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    schema_version: 1,
    id: 'TEST-001',
    title: 'Test task',
    type: 'feature',
    status: 'in_progress',
    priority: 'medium',
    project: 'TEST',
    tags: [],
    complexity: 3,
    complexity_manual: false,
    why: 'For testing.',
    created: '2024-01-01T00:00:00.000Z',
    updated: '2024-01-01T00:00:00.000Z',
    last_activity: '2024-01-01T00:00:00.000Z',
    claimed_by: null,
    claimed_at: null,
    claim_ttl_hours: 4,
    parent: null,
    children: [],
    dependencies: [],
    subtasks: [],
    git: { commits: [] },
    transitions: [],
    files: [],
    body: '',
    file_path: '/tasks/TEST-001.md',
    ...overrides,
  };
}

function makePr(overrides: Partial<MergedPr> = {}): MergedPr {
  return {
    number: 42,
    title: 'Some PR',
    headRefName: 'feat/some-branch',
    mergedAt: '2024-02-01T00:00:00.000Z',
    body: '',
    url: 'https://github.com/x/y/pull/42',
    ...overrides,
  };
}

interface FakeStore {
  updateTask: ReturnType<typeof vi.fn>;
  transitionTask: ReturnType<typeof vi.fn>;
}

function makeDeps(opts: {
  tasks: Task[];
  prs?: MergedPr[];
  commits?: Record<string, { sha: string; message: string; authored_at: string }[]>;
}): { deps: ReconcileDeps; store: FakeStore } {
  const store: FakeStore = {
    updateTask: vi.fn((id: string, fields: unknown) => ({ ...opts.tasks.find(t => t.id === id), ...(fields as object) })),
    transitionTask: vi.fn((id: string, to: TaskStatus) => ({ ...opts.tasks.find(t => t.id === id), status: to })),
  };
  const deps: ReconcileDeps = {
    store: store as unknown as ReconcileDeps['store'],
    listTasks: () => opts.tasks,
    listMergedPrs: () => opts.prs ?? [],
    getDefaultBranch: () => 'main',
    findCommitsByTaskId: (_p: string, taskId: string) => opts.commits?.[taskId] ?? [],
  };
  return { deps, store };
}

// ── pure helpers ────────────────────────────────────────────────────────────

describe('prMatchesTaskId', () => {
  it('matches when the task ID appears in the PR title', () => {
    expect(prMatchesTaskId(makePr({ title: 'HRLD-042 fix login' }), 'HRLD-042')).toBe(true);
  });

  it('matches when the ID appears in the branch name (squash-merge, branch deleted)', () => {
    expect(prMatchesTaskId(makePr({ title: 'x', headRefName: 'feat/HRLD-042-login' }), 'HRLD-042')).toBe(true);
  });

  it('does not match when the ID only appears in the PR body (RELAY-025)', () => {
    // Body prose routinely cross-references other tasks in passing without
    // the PR implementing them — see reconcileTasksGithub — PR-mismatch
    // regression (RELAY-025) below for the real incident this prevents.
    expect(prMatchesTaskId(makePr({ title: 'x', body: 'Closes HRLD-042.' }), 'HRLD-042')).toBe(false);
  });

  it('does not match a longer numeric suffix (word boundary)', () => {
    expect(prMatchesTaskId(makePr({ title: 'HRLD-0421 other' }), 'HRLD-042')).toBe(false);
  });

  it('does not match an unrelated PR', () => {
    expect(prMatchesTaskId(makePr({ title: 'COND-999 something' }), 'HRLD-042')).toBe(false);
  });
});

describe('pathToDone', () => {
  it('in_progress goes straight to done', () => {
    expect(pathToDone('in_progress')).toEqual(['done']);
  });
  it('todo routes through in_progress', () => {
    expect(pathToDone('todo')).toEqual(['in_progress', 'done']);
  });
  it('blocked routes through in_progress', () => {
    expect(pathToDone('blocked')).toEqual(['in_progress', 'done']);
  });
  it('draft routes to done via approved and in_progress', () => {
    const p = pathToDone('draft');
    expect(p[p.length - 1]).toBe('done');
    expect(p).toContain('in_progress');
  });
  it('done needs no transitions', () => {
    expect(pathToDone('done')).toEqual([]);
  });
});

// ── orchestration ───────────────────────────────────────────────────────────

describe('reconcileTasksGithub', () => {
  it('reconciles an in_progress task matched by a merged PR title', async () => {
    const tasks = [makeTask({ id: 'TEST-001', status: 'in_progress' })];
    const { deps, store } = makeDeps({ tasks, prs: [makePr({ number: 7, title: 'TEST-001 do the thing' })] });

    const summary = await reconcileTasksGithub({ projectPath: '/x', idPrefix: 'TEST' }, deps);

    expect(summary.reconciled).toBe(1);
    expect(summary.results[0].method).toBe('pr_match');
    expect(store.updateTask).toHaveBeenCalled();
    expect(store.transitionTask).toHaveBeenLastCalledWith(
      'TEST-001',
      'done',
      expect.stringContaining('reconciled via PR #7'),
    );
  });

  it('routes a todo task through in_progress before done', async () => {
    const tasks = [makeTask({ id: 'TEST-002', status: 'todo' })];
    const { deps, store } = makeDeps({ tasks, prs: [makePr({ number: 9, title: 'TEST-002 ship it' })] });

    const summary = await reconcileTasksGithub({ projectPath: '/x', idPrefix: 'TEST' }, deps);

    expect(summary.reconciled).toBe(1);
    const calls = store.transitionTask.mock.calls.map(c => c[1]);
    expect(calls).toEqual(['in_progress', 'done']);
  });

  it('falls back to a default-branch commit when no PR matches (squash-merge)', async () => {
    const tasks = [makeTask({ id: 'TEST-003', status: 'in_progress' })];
    const { deps, store } = makeDeps({
      tasks,
      prs: [],
      commits: { 'TEST-003': [{ sha: 'abc1234def', message: 'TEST-003 squashed', authored_at: '2024-03-01T00:00:00.000Z' }] },
    });

    const summary = await reconcileTasksGithub({ projectPath: '/x', idPrefix: 'TEST' }, deps);

    expect(summary.reconciled).toBe(1);
    expect(summary.results[0].method).toBe('commit_match');
    expect(store.transitionTask).toHaveBeenLastCalledWith(
      'TEST-003',
      'done',
      expect.stringContaining('reconciled via abc1234'),
    );
  });

  it('leaves non-matching tasks untouched', async () => {
    const tasks = [makeTask({ id: 'TEST-004', status: 'in_progress' })];
    const { deps, store } = makeDeps({ tasks, prs: [makePr({ title: 'OTHER-1 nope' })] });

    const summary = await reconcileTasksGithub({ projectPath: '/x', idPrefix: 'TEST' }, deps);

    expect(summary.reconciled).toBe(0);
    expect(summary.noSignal).toBe(1);
    expect(store.transitionTask).not.toHaveBeenCalled();
    expect(store.updateTask).not.toHaveBeenCalled();
  });

  it('dry-run writes nothing but reports would-be reconciliations', async () => {
    const tasks = [makeTask({ id: 'TEST-005', status: 'in_progress' })];
    const { deps, store } = makeDeps({ tasks, prs: [makePr({ number: 5, title: 'TEST-005 x' })] });

    const summary = await reconcileTasksGithub({ projectPath: '/x', idPrefix: 'TEST', dryRun: true }, deps);

    expect(summary.dryRun).toBe(true);
    expect(summary.reconciled).toBe(1);
    expect(store.updateTask).not.toHaveBeenCalled();
    expect(store.transitionTask).not.toHaveBeenCalled();
  });

  it('ignores tasks that are already done', async () => {
    const tasks = [makeTask({ id: 'TEST-006', status: 'done' })];
    const { deps } = makeDeps({ tasks, prs: [makePr({ title: 'TEST-006 x' })] });

    const summary = await reconcileTasksGithub({ projectPath: '/x', idPrefix: 'TEST' }, deps);

    expect(summary.scanned).toBe(0);
  });
});

// ── RELAY-025 regression: PR-mismatch when a task ID is merely mentioned  ──
// in another PR's prose, or when multiple merged PRs textually name the
// same task. Reproduces the 2026-07-09 incident where reconcile-github
// wrote wrong PR links onto 4 unrelated tasks in one run.
describe('reconcileTasksGithub — PR-mismatch regression (RELAY-025)', () => {
  it('does not reconcile a task whose ID is only mentioned in another PR\'s body prose', async () => {
    // Mirrors real PR #78 (fix(RELAY-022): ...), whose body narrates
    // "the trigger for the RELAY-021 false-done incident (#75)" — a
    // cross-reference to a different task's *own* PR, not evidence that
    // #78 implements RELAY-021.
    const tasks = [makeTask({ id: 'RELAY-021', status: 'in_progress' })];
    const { deps } = makeDeps({
      tasks,
      prs: [
        makePr({
          number: 78,
          title: 'fix(RELAY-022): sentinel launches from mutable dev checkout',
          headRefName: 'fix/RELAY-022-sentinel-launch-path',
          body: 'Fixes the trigger for the RELAY-021 false-done incident (#75).',
        }),
      ],
    });

    const summary = await reconcileTasksGithub({ projectPath: '/x', idPrefix: 'RELAY' }, deps);

    expect(summary.results[0].method).toBe('none');
    expect(summary.results[0].evidence?.prNumber).not.toBe(78);
    expect(summary.noSignal).toBe(1);
  });

  it('prefers the PR that actually implements the task over a later PR that merely also names it', async () => {
    // Mirrors real PR #78 (the true fix) and #79 (a later chore/task-sync
    // PR whose title also happens to name RELAY-022). gh's default
    // ordering returns the newer PR first, so an unranked `.find()` picks
    // the wrong one.
    const tasks = [makeTask({ id: 'RELAY-022', status: 'in_progress' })];
    const { deps } = makeDeps({
      tasks,
      prs: [
        makePr({
          number: 79,
          title: 'chore: task-state sync — RELAY-022 in_progress, PR #78 linked',
          headRefName: 'chore/task-sync-relay-021-022',
          mergedAt: '2026-07-09T02:00:00.000Z',
        }),
        makePr({
          number: 78,
          title: 'fix(RELAY-022): sentinel launches from mutable dev checkout',
          headRefName: 'fix/RELAY-022-sentinel-launch-path',
          mergedAt: '2026-07-09T01:00:00.000Z',
        }),
      ],
    });

    const summary = await reconcileTasksGithub({ projectPath: '/x', idPrefix: 'RELAY' }, deps);

    expect(summary.results[0].evidence?.prNumber).toBe(78);
  });
});

// ── MCPAT-138: task-bookkeeping PRs must never be reconciliation evidence ──
// Reproduces the 2026-07-14 atlas-pipeline incident where the candidates[0]
// fallback picked a batch task-registration PR and an administrative sync
// PR as "the PR that closed" tasks neither of them ever touched.
describe('isTaskBookkeepingPr', () => {
  it('flags a batch task-registration commit', () => {
    expect(isTaskBookkeepingPr(makePr({ title: 'chore(agent-tasks): register ALFI-086 through ALFI-090' }))).toBe(true);
  });

  it('flags an administrative task-commit sync', () => {
    expect(isTaskBookkeepingPr(makePr({ title: 'chore: sync stray ALFI-080 task commit into main' }))).toBe(true);
  });

  it('does not flag a genuine implementing PR', () => {
    expect(isTaskBookkeepingPr(makePr({ title: 'fix(ALFI-009): unblock /markets/rank — token headroom' }))).toBe(false);
  });
});

describe('reconcileTasksGithub — bookkeeping-PR fallback regression (MCPAT-138)', () => {
  it('does not reconcile via a batch task-registration PR (real PR #127 incident)', async () => {
    const tasks = [makeTask({ id: 'ALFI-090', status: 'todo' })];
    const { deps, store } = makeDeps({
      tasks,
      prs: [
        makePr({
          number: 127,
          title: 'chore(agent-tasks): register ALFI-086 through ALFI-090',
          headRefName: 'chore/register-p2-outreach-tasks',
        }),
      ],
    });

    const summary = await reconcileTasksGithub({ projectPath: '/x', idPrefix: 'ALFI' }, deps);

    expect(summary.results[0].action).toBe('no_signal');
    expect(summary.noSignal).toBe(1);
    expect(store.transitionTask).not.toHaveBeenCalled();
  });

  it('does not reconcile via an administrative task-commit sync PR (real PR #113 incident)', async () => {
    const tasks = [makeTask({ id: 'ALFI-080', status: 'todo' })];
    const { deps, store } = makeDeps({
      tasks,
      prs: [
        makePr({
          number: 113,
          title: 'chore: sync stray ALFI-080 task commit into main',
          headRefName: 'chore/sync-main-alfi080-and-spec-merge',
        }),
      ],
    });

    const summary = await reconcileTasksGithub({ projectPath: '/x', idPrefix: 'ALFI' }, deps);

    expect(summary.results[0].action).toBe('no_signal');
    expect(store.transitionTask).not.toHaveBeenCalled();
  });

  it('still reconciles via a genuine implementing PR even when a bookkeeping PR also mentions the task', async () => {
    const tasks = [makeTask({ id: 'ALFI-090', status: 'todo' })];
    const { deps, store } = makeDeps({
      tasks,
      prs: [
        makePr({
          number: 127,
          title: 'chore(agent-tasks): register ALFI-086 through ALFI-090',
          headRefName: 'chore/register-p2-outreach-tasks',
        }),
        makePr({
          number: 140,
          title: 'feat(ALFI-090): implement the actual feature',
          headRefName: 'feat/ALFI-090-implement',
        }),
      ],
    });

    const summary = await reconcileTasksGithub({ projectPath: '/x', idPrefix: 'ALFI' }, deps);

    expect(summary.results[0].evidence?.prNumber).toBe(140);
    expect(store.transitionTask).toHaveBeenCalled();
  });
});

// ── MCPAT-115: buildStore must use the storage-aware resolveServerDbPath ───
// helper instead of its own divergent fs.existsSync heuristic. Without the
// fix, a storage:local project's reconcile run writes to a DB path that
// resolveServerDbPath would NOT pick for that project, so the long-lived
// MCP server (which always calls resolveServerDbPath) never sees the write.
describe('reconcileTasksGithub — DB path resolution (MCPAT-115)', () => {
  let tempDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-reconcile-dbpath-'));
    saved.MCP_TASKS_CONFIG = process.env['MCP_TASKS_CONFIG'];
    saved.MCP_TASKS_DB = process.env['MCP_TASKS_DB'];
    delete process.env['MCP_TASKS_DB'];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    // reconcileTasksGithub's buildStore keeps its SqliteIndex open for the
    // process lifetime (same as production — a real CLI invocation exits
    // right after, releasing the handle; the test process does not). On
    // Windows the resulting WAL lock can outlive the test, so cleanup here
    // is best-effort and must never fail the test on this unrelated teardown
    // race — the OS reclaims the temp dir on its own schedule.
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch { /* best-effort — see comment above */ }
  });

  it('writes a storage:global project\'s reconciled task into the SAME db path resolveServerDbPath resolves for it, even when a local agent-tasks/ dir also exists on disk', async () => {
    // Regression scenario: the project's config says storage:global, but its
    // agent-tasks/ dir also physically exists on disk (e.g. leftover from a
    // prior local checkout). The OLD buildStore heuristic only checked
    // fs.existsSync(tasksDir) — ignoring config — so it would wrongly write
    // to the LOCAL db even though this project is storage:global and the
    // real MCP server (which always honors config via resolveServerDbPath)
    // reads/writes the GLOBAL db.
    const projectRoot = path.join(tempDir, 'global-project');
    const tasksDir = path.join(projectRoot, DEFAULT_TASKS_DIR_NAME);
    fs.mkdirSync(tasksDir, { recursive: true }); // exists on disk despite storage:global

    const globalStorageDir = path.join(tempDir, 'global');
    fs.mkdirSync(globalStorageDir, { recursive: true });

    const configPath = path.join(tempDir, 'config.json');
    const config = {
      version: 1,
      storageDir: globalStorageDir,
      defaultStorage: 'global' as const,
      enforcement: 'off' as const,
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      tasksDirName: DEFAULT_TASKS_DIR_NAME,
      projects: [
        { prefix: 'GLBL', path: projectRoot, storage: 'global' as const },
      ],
    };
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');
    process.env['MCP_TASKS_CONFIG'] = configPath;

    // Seed a real task directly into the index at the path resolveServerDbPath
    // says this storage:global project should use (the GLOBAL db), mirroring
    // how the running MCP server would have created it.
    const expectedDbPath = resolveServerDbPath(tasksDir, config, 'GLBL');
    expect(expectedDbPath).toBe(path.join(globalStorageDir, '.index.db'));

    const seedIndex = new SqliteIndex(expectedDbPath);
    seedIndex.init();
    seedIndex.ensureProject('GLBL');
    const now = new Date().toISOString();
    seedIndex.upsertTask({
      schema_version: 1, id: 'GLBL-001', title: 'Global task', type: 'chore', status: 'in_progress',
      priority: 'medium', project: 'GLBL', tags: [], complexity: 1, complexity_manual: false, why: '',
      created: now, updated: now, last_activity: now, claimed_by: null, claimed_at: null, claim_ttl_hours: 4,
      parent: null, children: [], dependencies: [], subtasks: [], git: { commits: [] }, transitions: [],
      files: [], body: '', file_path: path.join(tasksDir, 'GLBL-001.md'),
    });
    seedIndex.close();

    // Run reconcile with NO injected store/listTasks — this exercises the real
    // buildStore path resolution inside task-reconcile-github.ts.
    await reconcileTasksGithub(
      { projectPath: projectRoot, idPrefix: 'GLBL' },
      { listMergedPrs: () => [{ number: 1, title: 'GLBL-001 done', headRefName: 'feat/GLBL-001', mergedAt: now, body: '', url: 'https://x/1' }] },
    );

    // Re-open the index at the resolveServerDbPath-resolved path (the GLOBAL
    // db) and confirm the transition landed THERE — not in the local db file
    // the old fs.existsSync heuristic would have written to instead.
    const verifyIndex = new SqliteIndex(expectedDbPath);
    verifyIndex.init();
    const tasks = verifyIndex.listTasks({ project: 'GLBL', limit: 10 });
    verifyIndex.close();

    const task = tasks.find(t => t.id === 'GLBL-001');
    expect(task?.status).toBe('done');
  });
});
