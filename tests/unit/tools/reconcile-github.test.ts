import { describe, it, expect, vi } from 'vitest';
import type { Task, TaskStatus } from '../../../src/types/task.js';
import type { MergedPr } from '../../../src/lib/gh-client.js';
import {
  reconcileTasksGithub,
  prMatchesTaskId,
  pathToDone,
  type ReconcileDeps,
} from '../../../src/tools/task-reconcile-github.js';

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
