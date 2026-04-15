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
    store: {} as ToolContext['store'],
    index: {
      getTask: vi.fn(),
      listTasks: vi.fn(),
      searchTasks: vi.fn(),
      getStats: vi.fn(),
      getStaleTasks: vi.fn(),
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
    milestones: {} as unknown as ToolContext['milestones'],
    ...overrides,
  };
}

// --- task-blocked-by ---

describe('task_blocked_by', async () => {
  const mod = await import('../../../src/tools/task-blocked-by.js');

  describe('validate()', () => {
    it('throws when id is missing', () => {
      expect(() => mod.validate({})).toThrow(McpTasksError);
    });

    it('passes with id', () => {
      expect(() => mod.validate({ id: 'TEST-001' })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('returns empty blocking list when no dependencies', async () => {
      const task = makeTask({ dependencies: [] });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(task);

      const result = await mod.execute({ id: 'TEST-001' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { blocking: Task[] };
      expect(parsed.blocking).toHaveLength(0);
    });

    it('returns only non-done dependencies as blocking', async () => {
      const dep1 = makeTask({ id: 'TEST-002', status: 'todo' });
      const dep2 = makeTask({ id: 'TEST-003', status: 'done' });
      const task = makeTask({ dependencies: ['TEST-002', 'TEST-003'] });
      const ctx = makeCtx();

      vi.mocked(ctx.index.getTask)
        .mockReturnValueOnce(task)  // first call: the main task
        .mockReturnValueOnce(dep1) // second call: dep1
        .mockReturnValueOnce(dep2); // third call: dep2

      const result = await mod.execute({ id: 'TEST-001' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { blocking: Task[] };
      expect(parsed.blocking).toHaveLength(1);
      expect(parsed.blocking[0].id).toBe('TEST-002');
    });

    it('throws TASK_NOT_FOUND when task not found', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(null);

      await expect(mod.execute({ id: 'MISSING' }, ctx)).rejects.toThrow(McpTasksError);
    });
  });
});

// --- task-unblocks ---

describe('task_unblocks', async () => {
  const mod = await import('../../../src/tools/task-unblocks.js');

  describe('validate()', () => {
    it('throws when id is missing', () => {
      expect(() => mod.validate({})).toThrow(McpTasksError);
    });

    it('passes with id', () => {
      expect(() => mod.validate({ id: 'TEST-001' })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('returns tasks that depend on the given task', async () => {
      const task = makeTask({ id: 'TEST-001' });
      const dependent = makeTask({ id: 'TEST-002', dependencies: ['TEST-001'] });
      const independent = makeTask({ id: 'TEST-003', dependencies: [] });
      const ctx = makeCtx();

      vi.mocked(ctx.index.getTask).mockReturnValue(task);
      vi.mocked(ctx.index.listTasks).mockReturnValue([task, dependent, independent]);

      const result = await mod.execute({ id: 'TEST-001' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { unblocks: Task[] };
      expect(parsed.unblocks).toHaveLength(1);
      expect(parsed.unblocks[0].id).toBe('TEST-002');
    });

    it('returns empty list when nothing depends on this task', async () => {
      const task = makeTask({ id: 'TEST-001' });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(task);
      vi.mocked(ctx.index.listTasks).mockReturnValue([task]);

      const result = await mod.execute({ id: 'TEST-001' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { unblocks: Task[] };
      expect(parsed.unblocks).toHaveLength(0);
    });

    it('throws TASK_NOT_FOUND when task not found', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(null);

      await expect(mod.execute({ id: 'MISSING' }, ctx)).rejects.toThrow(McpTasksError);
    });
  });
});

// --- task-stale ---

describe('task_stale', async () => {
  const mod = await import('../../../src/tools/task-stale.js');

  describe('validate()', () => {
    it('passes with empty input', () => {
      expect(() => mod.validate({})).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('calls index.getStaleTasks and returns result', async () => {
      const task = makeTask({ status: 'in_progress', claimed_by: 'old-session' });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getStaleTasks).mockReturnValue([task]);

      const result = await mod.execute({}, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task[];
      expect(parsed).toHaveLength(1);
      expect(ctx.index.getStaleTasks).toHaveBeenCalledWith(undefined);
    });

    it('passes project filter to getStaleTasks', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.getStaleTasks).mockReturnValue([]);

      await mod.execute({ project: 'TEST' }, ctx);
      expect(ctx.index.getStaleTasks).toHaveBeenCalledWith('TEST');
    });
  });
});

// --- task-stats ---

describe('task_stats', async () => {
  const mod = await import('../../../src/tools/task-stats.js');

  describe('validate()', () => {
    it('passes with empty input', () => {
      expect(() => mod.validate({})).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('calls index.getStats and returns stats', async () => {
      const stats = { total: 5, by_status: { todo: 3, in_progress: 1, done: 1, blocked: 0, archived: 0 }, cycle_time_avg_hours: null, completion_rate: 0.2 };
      const ctx = makeCtx();
      vi.mocked(ctx.index.getStats).mockReturnValue(stats);

      const result = await mod.execute({}, ctx);
      const parsed = JSON.parse(result.content[0].text) as typeof stats;
      expect(parsed.total).toBe(5);
      expect(ctx.index.getStats).toHaveBeenCalledWith(undefined);
    });

    it('passes project filter to getStats', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.getStats).mockReturnValue({ total: 0, by_status: { todo: 0, in_progress: 0, done: 0, blocked: 0, archived: 0 }, cycle_time_avg_hours: null, completion_rate: 0 });

      await mod.execute({ project: 'TEST' }, ctx);
      expect(ctx.index.getStats).toHaveBeenCalledWith('TEST');
    });
  });
});
