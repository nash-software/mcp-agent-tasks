import { describe, it, expect, vi } from 'vitest';
import { McpTasksError } from '../../../src/types/errors.js';
import type { ToolContext } from '../../../src/tools/context.js';
import type { Task } from '../../../src/types/task.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    schema_version: 1,
    id: 'TEST-001',
    title: 'Test task',
    type: 'feature',
    status: 'todo',
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

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    store: {
      createTask: vi.fn(),
      updateTask: vi.fn(),
      transitionTask: vi.fn(),
      claimTask: vi.fn(),
      releaseTask: vi.fn(),
      archiveTask: vi.fn(),
    } as unknown as ToolContext['store'],
    index: {
      getTask: vi.fn(),
      listTasks: vi.fn(),
      searchTasks: vi.fn(),
    } as unknown as ToolContext['index'],
    sessionId: 'test-session',
    config: {
      version: 1,
      storageDir: '/tmp/mcp-tasks',
      defaultStorage: 'global',
      enforcement: 'warn',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: true,
      projects: [],
    },
    ...overrides,
  };
}

// --- task-link-commit ---

describe('task_link_commit', async () => {
  const mod = await import('../../../src/tools/task-link-commit.js');

  describe('validate()', () => {
    it('throws when id is missing', () => {
      expect(() => mod.validate({ sha: 'abc123', message: 'fix: thing' })).toThrow(McpTasksError);
    });

    it('throws when sha is missing', () => {
      expect(() => mod.validate({ id: 'TEST-001', message: 'fix: thing' })).toThrow(McpTasksError);
    });

    it('throws when message is missing', () => {
      expect(() => mod.validate({ id: 'TEST-001', sha: 'abc123' })).toThrow(McpTasksError);
    });

    it('passes with valid input', () => {
      expect(() => mod.validate({ id: 'TEST-001', sha: 'abc123', message: 'fix: thing' })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('adds commit to task and returns updated task', async () => {
      const task = makeTask({ git: { commits: [] } });
      const updated = makeTask({
        git: { commits: [{ sha: 'abc123', message: 'fix: thing', authored_at: '2024-01-01T00:00:00.000Z' }] },
      });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(task);
      vi.mocked(ctx.store.updateTask).mockReturnValue(updated);

      const result = await mod.execute({ id: 'TEST-001', sha: 'abc123', message: 'fix: thing' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task;
      expect(parsed.git.commits).toHaveLength(1);
      expect(parsed.git.commits[0].sha).toBe('abc123');
    });

    it('is idempotent: linking same SHA twice returns task without adding duplicate', async () => {
      const existingCommit = { sha: 'abc123', message: 'fix: thing', authored_at: '2024-01-01T00:00:00.000Z' };
      const task = makeTask({ git: { commits: [existingCommit] } });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(task);

      const result = await mod.execute({ id: 'TEST-001', sha: 'abc123', message: 'fix: thing' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task;
      // Should return original task without calling updateTask
      expect(parsed.git.commits).toHaveLength(1);
      expect(ctx.store.updateTask).not.toHaveBeenCalled();
    });

    it('throws TASK_NOT_FOUND when task not found', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(null);

      await expect(
        mod.execute({ id: 'MISSING', sha: 'abc', message: 'x' }, ctx),
      ).rejects.toThrow(McpTasksError);
    });
  });
});

// --- task-link-pr ---

describe('task_link_pr', async () => {
  const mod = await import('../../../src/tools/task-link-pr.js');

  describe('validate()', () => {
    it('throws when id is missing', () => {
      expect(() => mod.validate({ pr_number: 1, pr_url: 'http://x', pr_state: 'open' })).toThrow(McpTasksError);
    });

    it('throws when pr_number is missing', () => {
      expect(() => mod.validate({ id: 'TEST-001', pr_url: 'http://x', pr_state: 'open' })).toThrow(McpTasksError);
    });

    it('throws when pr_state is invalid', () => {
      expect(() =>
        mod.validate({ id: 'TEST-001', pr_number: 1, pr_url: 'http://x', pr_state: 'broken' }),
      ).toThrow(McpTasksError);
    });

    it('passes with valid input', () => {
      expect(() =>
        mod.validate({ id: 'TEST-001', pr_number: 1, pr_url: 'http://x', pr_state: 'open' }),
      ).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('links PR to task and returns updated task', async () => {
      const task = makeTask({ git: { commits: [] } });
      const updated = makeTask({
        git: {
          commits: [],
          pr: { number: 42, url: 'http://pr', title: '', state: 'open', merged_at: null, base_branch: '' },
        },
      });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(task);
      vi.mocked(ctx.store.updateTask).mockReturnValue(updated);

      const result = await mod.execute(
        { id: 'TEST-001', pr_number: 42, pr_url: 'http://pr', pr_state: 'open' },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text) as Task;
      expect(parsed.git.pr?.number).toBe(42);
    });

    it('auto-transitions to done when pr_state=merged', async () => {
      const task = makeTask({ git: { commits: [] }, status: 'in_progress' });
      const afterUpdate = makeTask({ status: 'in_progress', git: { commits: [], pr: { number: 1, url: 'http://pr', title: '', state: 'merged', merged_at: null, base_branch: '' } } });
      const afterTransition = makeTask({ status: 'done', git: afterUpdate.git });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(task);
      vi.mocked(ctx.store.updateTask).mockReturnValue(afterUpdate);
      vi.mocked(ctx.store.transitionTask).mockReturnValue(afterTransition);

      const result = await mod.execute(
        { id: 'TEST-001', pr_number: 1, pr_url: 'http://pr', pr_state: 'merged' },
        ctx,
      );
      const parsed = JSON.parse(result.content[0].text) as Task;
      expect(parsed.status).toBe('done');
      expect(ctx.store.transitionTask).toHaveBeenCalledWith('TEST-001', 'done', 'PR merged');
    });

    it('does not auto-transition if already done', async () => {
      const task = makeTask({ git: { commits: [] }, status: 'done' });
      const afterUpdate = makeTask({ status: 'done', git: { commits: [], pr: { number: 1, url: 'http://pr', title: '', state: 'merged', merged_at: null, base_branch: '' } } });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(task);
      vi.mocked(ctx.store.updateTask).mockReturnValue(afterUpdate);

      await mod.execute({ id: 'TEST-001', pr_number: 1, pr_url: 'http://pr', pr_state: 'merged' }, ctx);
      expect(ctx.store.transitionTask).not.toHaveBeenCalled();
    });

    it('throws TASK_NOT_FOUND when task not found', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(null);

      await expect(
        mod.execute({ id: 'MISSING', pr_number: 1, pr_url: 'http://x', pr_state: 'open' }, ctx),
      ).rejects.toThrow(McpTasksError);
    });
  });
});

// --- task-link-branch ---

describe('task_link_branch', async () => {
  const mod = await import('../../../src/tools/task-link-branch.js');

  describe('validate()', () => {
    it('throws when id is missing', () => {
      expect(() => mod.validate({ branch: 'feature/x' })).toThrow(McpTasksError);
    });

    it('throws when branch is missing', () => {
      expect(() => mod.validate({ id: 'TEST-001' })).toThrow(McpTasksError);
    });

    it('passes with valid input', () => {
      expect(() => mod.validate({ id: 'TEST-001', branch: 'feature/x' })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('links branch and returns updated task', async () => {
      const task = makeTask({ git: { commits: [] } });
      const updated = makeTask({ git: { commits: [], branch: 'feature/x' } });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(task);
      vi.mocked(ctx.store.updateTask).mockReturnValue(updated);

      const result = await mod.execute({ id: 'TEST-001', branch: 'feature/x' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task;
      expect(parsed.git.branch).toBe('feature/x');
    });

    it('is idempotent: same branch returns task without calling updateTask', async () => {
      const task = makeTask({ git: { commits: [], branch: 'feature/x' } });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(task);

      const result = await mod.execute({ id: 'TEST-001', branch: 'feature/x' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task;
      expect(parsed.git.branch).toBe('feature/x');
      expect(ctx.store.updateTask).not.toHaveBeenCalled();
    });

    it('throws TASK_NOT_FOUND when task not found', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(null);

      await expect(mod.execute({ id: 'MISSING', branch: 'feature/x' }, ctx)).rejects.toThrow(McpTasksError);
    });
  });
});
