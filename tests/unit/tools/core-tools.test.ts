import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpTasksError } from '../../../src/types/errors.js';
import type { ToolContext } from '../../../src/tools/context.js';
import type { Task } from '../../../src/types/task.js';

// --- Shared helpers ---

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
      getNextTask: vi.fn(),
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
    ...overrides,
  };
}

// --- task-create ---

describe('task_create', async () => {
  const mod = await import('../../../src/tools/task-create.js');

  describe('validate()', () => {
    it('throws INVALID_FIELD when input is not an object', () => {
      expect(() => mod.validate('bad')).toThrow(McpTasksError);
    });

    it('throws INVALID_FIELD when project is missing', () => {
      expect(() => mod.validate({ title: 'T', type: 'feature', priority: 'low', why: 'y' })).toThrow(McpTasksError);
    });

    it('throws INVALID_FIELD when title exceeds 200 chars', () => {
      expect(() =>
        mod.validate({ project: 'X', title: 'a'.repeat(201), type: 'feature', priority: 'low', why: 'y' }),
      ).toThrow(McpTasksError);
    });

    it('throws INVALID_FIELD when type is invalid', () => {
      expect(() =>
        mod.validate({ project: 'X', title: 'T', type: 'invalid', priority: 'low', why: 'y' }),
      ).toThrow(McpTasksError);
    });

    it('throws INVALID_FIELD when priority is invalid', () => {
      expect(() =>
        mod.validate({ project: 'X', title: 'T', type: 'feature', priority: 'urgent', why: 'y' }),
      ).toThrow(McpTasksError);
    });

    it('throws INVALID_FIELD when tags exceeds 10', () => {
      expect(() =>
        mod.validate({
          project: 'X', title: 'T', type: 'feature', priority: 'low', why: 'y',
          tags: ['a','b','c','d','e','f','g','h','i','j','k'],
        }),
      ).toThrow(McpTasksError);
    });

    it('passes with valid minimum input', () => {
      expect(() =>
        mod.validate({ project: 'X', title: 'T', type: 'feature', priority: 'low', why: 'y' }),
      ).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('calls store.createTask and returns the task', async () => {
      const task = makeTask();
      const ctx = makeCtx();
      vi.mocked(ctx.store.createTask).mockReturnValue(task);

      const input = { project: 'TEST', title: 'T', type: 'feature' as const, priority: 'medium' as const, why: 'y' };
      const result = await mod.execute(input, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task;

      expect(ctx.store.createTask).toHaveBeenCalledWith(input);
      expect(parsed.id).toBe('TEST-001');
    });
  });
});

// --- task-get ---

describe('task_get', async () => {
  const mod = await import('../../../src/tools/task-get.js');

  describe('validate()', () => {
    it('throws when id is missing', () => {
      expect(() => mod.validate({})).toThrow(McpTasksError);
    });

    it('passes with id string', () => {
      expect(() => mod.validate({ id: 'TEST-001' })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('returns task when found', async () => {
      const task = makeTask();
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(task);

      const result = await mod.execute({ id: 'TEST-001' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task;
      expect(parsed.id).toBe('TEST-001');
    });

    it('returns error response when not found', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(null);

      const result = await mod.execute({ id: 'MISSING-999' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { error: string };
      expect(parsed.error).toBe('TASK_NOT_FOUND');
    });
  });
});

// --- task-list ---

describe('task_list', async () => {
  const mod = await import('../../../src/tools/task-list.js');

  describe('validate()', () => {
    it('passes with empty input', () => {
      expect(() => mod.validate({})).not.toThrow();
    });

    it('throws when status is invalid', () => {
      expect(() => mod.validate({ status: 'unknown' })).toThrow(McpTasksError);
    });

    it('throws when limit is less than 1', () => {
      expect(() => mod.validate({ limit: 0 })).toThrow(McpTasksError);
    });
  });

  describe('execute()', () => {
    it('calls index.listTasks with defaults', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.listTasks).mockReturnValue([]);

      await mod.execute({}, ctx);
      expect(ctx.index.listTasks).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    });

    it('passes filters through', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.listTasks).mockReturnValue([makeTask()]);

      const result = await mod.execute({ project: 'TEST', status: 'todo', limit: 10 }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task[];
      expect(parsed).toHaveLength(1);
    });
  });
});

// --- task-delete ---

describe('task_delete', async () => {
  const mod = await import('../../../src/tools/task-delete.js');

  describe('validate()', () => {
    it('throws when id is missing', () => {
      expect(() => mod.validate({})).toThrow(McpTasksError);
    });
  });

  describe('execute()', () => {
    it('calls store.archiveTask and returns archived=true', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.store.archiveTask).mockReturnValue(undefined);

      const result = await mod.execute({ id: 'TEST-001' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { archived: boolean; id: string };
      expect(parsed.archived).toBe(true);
      expect(parsed.id).toBe('TEST-001');
      expect(ctx.store.archiveTask).toHaveBeenCalledWith('TEST-001');
    });

    it('propagates error from store.archiveTask', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.store.archiveTask).mockImplementation(() => {
        throw new McpTasksError('TASK_NOT_FOUND', 'Not found');
      });

      await expect(mod.execute({ id: 'MISSING-999' }, ctx)).rejects.toThrow(McpTasksError);
    });
  });
});

// --- task-search ---

describe('task_search', async () => {
  const mod = await import('../../../src/tools/task-search.js');

  describe('validate()', () => {
    it('throws when query is missing', () => {
      expect(() => mod.validate({})).toThrow(McpTasksError);
    });

    it('passes with query', () => {
      expect(() => mod.validate({ query: 'hello' })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('returns search results', async () => {
      const ctx = makeCtx();
      const task = makeTask();
      vi.mocked(ctx.index.searchTasks).mockReturnValue([task]);

      const result = await mod.execute({ query: 'test' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task[];
      expect(parsed).toHaveLength(1);
    });

    it('filters by project when provided', async () => {
      const ctx = makeCtx();
      const taskA = makeTask({ project: 'A', id: 'A-001' });
      const taskB = makeTask({ project: 'B', id: 'B-001' });
      vi.mocked(ctx.index.searchTasks).mockReturnValue([taskA, taskB]);

      const result = await mod.execute({ query: 'test', project: 'A' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0].project).toBe('A');
    });
  });
});

// --- task-update ---

describe('task_update', async () => {
  const mod = await import('../../../src/tools/task-update.js');

  describe('validate()', () => {
    it('throws when id is missing', () => {
      expect(() => mod.validate({})).toThrow(McpTasksError);
    });

    it('throws when title exceeds 200 chars', () => {
      expect(() => mod.validate({ id: 'X', title: 'a'.repeat(201) })).toThrow(McpTasksError);
    });

    it('throws when priority is invalid', () => {
      expect(() => mod.validate({ id: 'X', priority: 'urgent' })).toThrow(McpTasksError);
    });

    it('throws when complexity is out of range', () => {
      expect(() => mod.validate({ id: 'X', complexity: 11 })).toThrow(McpTasksError);
      expect(() => mod.validate({ id: 'X', complexity: 0 })).toThrow(McpTasksError);
    });

    it('passes with valid input', () => {
      expect(() => mod.validate({ id: 'X', title: 'New title', priority: 'high', complexity: 5 })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('calls store.updateTask and returns result', async () => {
      const ctx = makeCtx();
      const updated = makeTask({ title: 'New title' });
      vi.mocked(ctx.store.updateTask).mockReturnValue(updated);

      const result = await mod.execute({ id: 'TEST-001', title: 'New title' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task;
      expect(parsed.title).toBe('New title');
    });
  });
});

// --- task-next ---

describe('task_next', async () => {
  const mod = await import('../../../src/tools/task-next.js');

  describe('validate()', () => {
    it('throws when project is missing', () => {
      expect(() => mod.validate({})).toThrow(McpTasksError);
    });
  });

  describe('execute()', () => {
    it('returns task when available', async () => {
      const ctx = makeCtx();
      const task = makeTask();
      vi.mocked(ctx.index.getNextTask).mockReturnValue(task);

      const result = await mod.execute({ project: 'TEST' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task;
      expect(parsed.id).toBe('TEST-001');
    });

    it('returns available=false when no tasks', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.getNextTask).mockReturnValue(null);

      const result = await mod.execute({ project: 'TEST' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { available: boolean };
      expect(parsed.available).toBe(false);
    });
  });
});
