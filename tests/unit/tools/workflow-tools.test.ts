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

// --- task-claim ---

describe('task_claim', async () => {
  const mod = await import('../../../src/tools/task-claim.js');

  describe('validate()', () => {
    it('throws when id is missing', () => {
      expect(() => mod.validate({})).toThrow(McpTasksError);
    });

    it('throws when ttl_hours is not a number', () => {
      expect(() => mod.validate({ id: 'TEST-001', ttl_hours: 'bad' })).toThrow(McpTasksError);
    });

    it('passes with just id', () => {
      expect(() => mod.validate({ id: 'TEST-001' })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('returns claimed=true on successful claim', async () => {
      const task = makeTask({ claimed_by: 'test-session' });
      const ctx = makeCtx();
      vi.mocked(ctx.store.claimTask).mockReturnValue({ claimed: true, task });

      const result = await mod.execute({ id: 'TEST-001' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { claimed: boolean; task: Task };
      expect(parsed.claimed).toBe(true);
      expect(parsed.task.id).toBe('TEST-001');
    });

    it('returns claimed=false when already claimed by another session', async () => {
      const task = makeTask({ claimed_by: 'other-session' });
      const ctx = makeCtx();
      vi.mocked(ctx.store.claimTask).mockReturnValue({ claimed: false, task });

      const result = await mod.execute({ id: 'TEST-001' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { claimed: boolean };
      expect(parsed.claimed).toBe(false);
    });

    it('passes ttl_hours to store', async () => {
      const task = makeTask();
      const ctx = makeCtx();
      vi.mocked(ctx.store.claimTask).mockReturnValue({ claimed: true, task });

      await mod.execute({ id: 'TEST-001', ttl_hours: 8 }, ctx);
      expect(ctx.store.claimTask).toHaveBeenCalledWith('TEST-001', 'test-session', 8);
    });
  });
});

// --- task-release ---

describe('task_release', async () => {
  const mod = await import('../../../src/tools/task-release.js');

  describe('validate()', () => {
    it('throws when id is missing', () => {
      expect(() => mod.validate({})).toThrow(McpTasksError);
    });

    it('passes with id', () => {
      expect(() => mod.validate({ id: 'TEST-001' })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('returns released=true when successful', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.store.releaseTask).mockReturnValue(true);

      const result = await mod.execute({ id: 'TEST-001' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { released: boolean };
      expect(parsed.released).toBe(true);
      expect(ctx.store.releaseTask).toHaveBeenCalledWith('TEST-001', 'test-session');
    });

    it('returns released=false when task was not claimed by this session', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.store.releaseTask).mockReturnValue(false);

      const result = await mod.execute({ id: 'TEST-001' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { released: boolean };
      expect(parsed.released).toBe(false);
    });
  });
});

// --- task-transition ---

describe('task_transition', async () => {
  const mod = await import('../../../src/tools/task-transition.js');

  describe('validate()', () => {
    it('throws when id is missing', () => {
      expect(() => mod.validate({ to_status: 'done' })).toThrow(McpTasksError);
    });

    it('throws when to_status is invalid', () => {
      expect(() => mod.validate({ id: 'TEST-001', to_status: 'deleted' })).toThrow(McpTasksError);
    });

    it('passes for all valid statuses', () => {
      for (const s of ['todo', 'in_progress', 'done', 'blocked']) {
        expect(() => mod.validate({ id: 'TEST-001', to_status: s })).not.toThrow();
      }
    });
  });

  describe('execute()', () => {
    it('calls store.transitionTask with id and status', async () => {
      const task = makeTask({ status: 'in_progress' });
      const ctx = makeCtx();
      vi.mocked(ctx.store.transitionTask).mockReturnValue(task);

      const result = await mod.execute({ id: 'TEST-001', to_status: 'in_progress' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task;
      expect(parsed.status).toBe('in_progress');
      expect(ctx.store.transitionTask).toHaveBeenCalledWith('TEST-001', 'in_progress', undefined);
    });

    it('passes reason to store', async () => {
      const task = makeTask({ status: 'done' });
      const ctx = makeCtx();
      vi.mocked(ctx.store.transitionTask).mockReturnValue(task);

      await mod.execute({ id: 'TEST-001', to_status: 'done', reason: 'PR merged' }, ctx);
      expect(ctx.store.transitionTask).toHaveBeenCalledWith('TEST-001', 'done', 'PR merged');
    });

    it('propagates INVALID_TRANSITION from store', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.store.transitionTask).mockImplementation(() => {
        throw new McpTasksError('INVALID_TRANSITION', 'Cannot transition');
      });

      await expect(mod.execute({ id: 'TEST-001', to_status: 'todo' }, ctx)).rejects.toThrow(McpTasksError);
    });
  });
});

// --- task-add-subtask ---

describe('task_add_subtask', async () => {
  const mod = await import('../../../src/tools/task-add-subtask.js');

  describe('validate()', () => {
    it('throws when parent_id is missing', () => {
      expect(() => mod.validate({ title: 'Sub' })).toThrow(McpTasksError);
    });

    it('throws when title is missing', () => {
      expect(() => mod.validate({ parent_id: 'TEST-001' })).toThrow(McpTasksError);
    });

    it('throws when title exceeds 200 chars', () => {
      expect(() => mod.validate({ parent_id: 'TEST-001', title: 'a'.repeat(201) })).toThrow(McpTasksError);
    });

    it('passes with valid input', () => {
      expect(() => mod.validate({ parent_id: 'TEST-001', title: 'Sub task' })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('adds subtask to parent and returns updated task', async () => {
      const parent = makeTask({ subtasks: [] });
      const updated = makeTask({ subtasks: [{ id: 'TEST-001.1', title: 'Sub', status: 'todo' }] });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(parent);
      vi.mocked(ctx.store.updateTask).mockReturnValue(updated);

      const result = await mod.execute({ parent_id: 'TEST-001', title: 'Sub' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as Task;
      expect(parsed.subtasks).toHaveLength(1);
      expect(parsed.subtasks[0].id).toBe('TEST-001.1');
    });

    it('throws TASK_NOT_FOUND when parent not found', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(null);

      await expect(mod.execute({ parent_id: 'MISSING', title: 'Sub' }, ctx)).rejects.toThrow(McpTasksError);
    });

    it('throws INVALID_FIELD when parent already has 10 subtasks', async () => {
      const subtasks = Array.from({ length: 10 }, (_, i) => ({
        id: `TEST-001.${i + 1}`,
        title: `Sub ${i + 1}`,
        status: 'todo' as const,
      }));
      const parent = makeTask({ subtasks });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(parent);

      await expect(mod.execute({ parent_id: 'TEST-001', title: 'Over limit' }, ctx)).rejects.toThrow(McpTasksError);
    });
  });
});

// --- task-promote-subtask ---

describe('task_promote_subtask', async () => {
  const mod = await import('../../../src/tools/task-promote-subtask.js');

  describe('validate()', () => {
    it('throws when parent_id is missing', () => {
      expect(() => mod.validate({ subtask_id: 'TEST-001.1' })).toThrow(McpTasksError);
    });

    it('throws when subtask_id is missing', () => {
      expect(() => mod.validate({ parent_id: 'TEST-001' })).toThrow(McpTasksError);
    });

    it('passes with valid input', () => {
      expect(() => mod.validate({ parent_id: 'TEST-001', subtask_id: 'TEST-001.1' })).not.toThrow();
    });
  });

  describe('execute()', () => {
    it('promotes subtask to a full task and returns promoted_task_id', async () => {
      const parent = makeTask({
        subtasks: [{ id: 'TEST-001.1', title: 'Sub', status: 'todo' }],
        children: [],
      });
      const promoted = makeTask({ id: 'TEST-002', parent: 'TEST-001' });
      const updatedParent = makeTask({ subtasks: [], children: ['TEST-002'] });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(parent);
      vi.mocked(ctx.store.createTask).mockReturnValue(promoted);
      vi.mocked(ctx.store.updateTask).mockReturnValue(updatedParent);

      const result = await mod.execute({ parent_id: 'TEST-001', subtask_id: 'TEST-001.1' }, ctx);
      const parsed = JSON.parse(result.content[0].text) as { promoted_task_id: string; parent_task_id: string };
      expect(parsed.promoted_task_id).toBe('TEST-002');
      expect(parsed.parent_task_id).toBe('TEST-001');
    });

    it('throws TASK_NOT_FOUND when parent not found', async () => {
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(null);

      await expect(
        mod.execute({ parent_id: 'MISSING', subtask_id: 'MISSING.1' }, ctx),
      ).rejects.toThrow(McpTasksError);
    });

    it('throws TASK_NOT_FOUND when subtask not in parent', async () => {
      const parent = makeTask({ subtasks: [] });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask).mockReturnValue(parent);

      await expect(
        mod.execute({ parent_id: 'TEST-001', subtask_id: 'TEST-001.99' }, ctx),
      ).rejects.toThrow(McpTasksError);
    });

    it('throws MAX_DEPTH_EXCEEDED when grandparent already has parent', async () => {
      // parent.parent = 'ROOT-001', grandparent.parent = 'GREAT-001' → depth 4 would be exceeded
      const parent = makeTask({ parent: 'ROOT-001', subtasks: [{ id: 'TEST-001.1', title: 'Sub', status: 'todo' }] });
      const grandparent = makeTask({ id: 'ROOT-001', parent: 'GREAT-001' });
      const ctx = makeCtx();
      vi.mocked(ctx.index.getTask)
        .mockReturnValueOnce(parent)      // first call: parent
        .mockReturnValueOnce(grandparent); // second call: grandparent

      await expect(
        mod.execute({ parent_id: 'TEST-001', subtask_id: 'TEST-001.1' }, ctx),
      ).rejects.toThrow(McpTasksError);
    });
  });
});
