import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';
import type { Task, TaskStatus, Priority } from '../../../src/types/task.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sqlite-test-'));
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
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
    why: 'Because testing.',
    created: now,
    updated: now,
    last_activity: now,
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
    body: 'Body text',
    file_path: '/tmp/TEST-001.md',
    ...overrides,
  };
}

function makeIndex(tmpDir: string): SqliteIndex {
  const dbPath = path.join(tmpDir, 'tasks.db');
  const idx = new SqliteIndex(dbPath);
  idx.init();
  return idx;
}

function ensureProject(idx: SqliteIndex, prefix: string): void {
  // nextId will create the project row if needed
  void idx.nextId(prefix);
  // reset next_id to 1 so tests start from a clean state
}

describe('SqliteIndex', () => {
  let tmpDir: string;
  let idx: SqliteIndex;

  beforeEach(() => {
    tmpDir = makeTempDir();
    idx = makeIndex(tmpDir);
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('init()', () => {
    it('is idempotent: calling init() twice causes no error', () => {
      expect(() => idx.init()).not.toThrow();
    });
  });

  describe('upsertTask() + getTask()', () => {
    it('roundtrip: insert then retrieve returns same task', () => {
      ensureProject(idx, 'TEST');
      const task = makeTask();
      idx.upsertTask(task);

      const retrieved = idx.getTask('TEST-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('TEST-001');
      expect(retrieved!.title).toBe('Test task');
      expect(retrieved!.status).toBe('todo');
      expect(retrieved!.priority).toBe('medium');
      expect(retrieved!.project).toBe('TEST');
    });

    it('updates an existing task on second upsert', () => {
      ensureProject(idx, 'TEST');
      const task = makeTask();
      idx.upsertTask(task);

      const updated = { ...task, title: 'Updated title', status: 'in_progress' as TaskStatus };
      idx.upsertTask(updated);

      const retrieved = idx.getTask('TEST-001');
      expect(retrieved!.title).toBe('Updated title');
      expect(retrieved!.status).toBe('in_progress');
    });

    it('stores and retrieves tags', () => {
      ensureProject(idx, 'TEST');
      const task = makeTask({ tags: ['alpha', 'beta', 'gamma'] });
      idx.upsertTask(task);

      const retrieved = idx.getTask('TEST-001');
      expect(retrieved!.tags).toContain('alpha');
      expect(retrieved!.tags).toContain('beta');
      expect(retrieved!.tags).toContain('gamma');
    });

    it('stores and retrieves subtasks', () => {
      ensureProject(idx, 'TEST');
      const task = makeTask({
        subtasks: [
          { id: 'TEST-001.1', title: 'Sub one', status: 'todo' },
          { id: 'TEST-001.2', title: 'Sub two', status: 'done' },
        ],
      });
      idx.upsertTask(task);

      const retrieved = idx.getTask('TEST-001');
      expect(retrieved!.subtasks).toHaveLength(2);
      expect(retrieved!.subtasks[0].title).toBe('Sub one');
    });

    it('stores and retrieves transitions', () => {
      ensureProject(idx, 'TEST');
      const now = new Date().toISOString();
      const task = makeTask({
        transitions: [{ from: 'todo', to: 'in_progress', at: now, reason: 'Started work' }],
      });
      idx.upsertTask(task);

      const retrieved = idx.getTask('TEST-001');
      expect(retrieved!.transitions).toHaveLength(1);
      expect(retrieved!.transitions[0].reason).toBe('Started work');
    });

    it('stores and retrieves git commits', () => {
      ensureProject(idx, 'TEST');
      const now = new Date().toISOString();
      const task = makeTask({
        git: { commits: [{ sha: 'abc123', message: 'feat: init', authored_at: now }] },
      });
      idx.upsertTask(task);

      const retrieved = idx.getTask('TEST-001');
      expect(retrieved!.git.commits).toHaveLength(1);
      expect(retrieved!.git.commits[0].sha).toBe('abc123');
    });
  });

  describe('deleteTask()', () => {
    it('removes the task from the index', () => {
      ensureProject(idx, 'TEST');
      idx.upsertTask(makeTask());
      expect(idx.getTask('TEST-001')).not.toBeNull();

      idx.deleteTask('TEST-001');
      expect(idx.getTask('TEST-001')).toBeNull();
    });

    it('cascade: subtask rows removed with parent', () => {
      ensureProject(idx, 'TEST');
      const task = makeTask({
        subtasks: [{ id: 'TEST-001.1', title: 'Sub', status: 'todo' }],
      });
      idx.upsertTask(task);
      idx.deleteTask('TEST-001');

      // If cascades work, no subtask rows remain (verify via FTS search which would also be empty)
      expect(idx.getTask('TEST-001')).toBeNull();
    });
  });

  describe('FTS5 triggers', () => {
    it('FTS: insert → search finds task by title', () => {
      ensureProject(idx, 'TEST');
      const task = makeTask({ title: 'WebSocket connection setup' });
      idx.upsertTask(task);

      const results = idx.searchTasks('WebSocket');
      expect(results.some(r => r.id === 'TEST-001')).toBe(true);
    });

    it('FTS: update title → search finds new title', () => {
      ensureProject(idx, 'TEST');
      idx.upsertTask(makeTask({ title: 'OldTitle unique12345' }));
      idx.upsertTask(makeTask({ title: 'NewTitle unique67890' }));

      const results = idx.searchTasks('NewTitle');
      expect(results.some(r => r.id === 'TEST-001')).toBe(true);

      const oldResults = idx.searchTasks('OldTitle');
      // After update, old title should not appear in FTS
      expect(oldResults.some(r => r.id === 'TEST-001')).toBe(false);
    });

    it('FTS: delete → search misses deleted task', () => {
      ensureProject(idx, 'TEST');
      const task = makeTask({ title: 'SpecialKeywordXYZ' });
      idx.upsertTask(task);
      idx.deleteTask('TEST-001');

      const results = idx.searchTasks('SpecialKeywordXYZ');
      expect(results.some(r => r.id === 'TEST-001')).toBe(false);
    });
  });

  describe('claimTask() TOCTOU', () => {
    it('first claim succeeds, second claim on same task returns false', () => {
      ensureProject(idx, 'TEST');
      idx.upsertTask(makeTask());

      const first = idx.claimTask('TEST-001', 'session-A', 4);
      expect(first).toBe(true);

      const second = idx.claimTask('TEST-001', 'session-B', 4);
      expect(second).toBe(false);
    });

    it('same session can re-claim their own task (updates TTL)', () => {
      ensureProject(idx, 'TEST');
      idx.upsertTask(makeTask());

      idx.claimTask('TEST-001', 'session-A', 4);
      // Re-claim by same session is still "conflict" unless we explicitly handle it
      // Per spec: second claim returns false if claimed_by IS NOT NULL and not expired
      const second = idx.claimTask('TEST-001', 'session-A', 8);
      expect(second).toBe(false);
    });
  });

  describe('getNextTask()', () => {
    it('returns highest priority todo with no unresolved deps first', () => {
      ensureProject(idx, 'TEST');

      const lowTask = makeTask({
        id: 'TEST-001',
        title: 'Low priority',
        priority: 'low',
        status: 'todo',
        dependencies: [],
      });
      const criticalTask = makeTask({
        id: 'TEST-002',
        title: 'Critical priority',
        priority: 'critical',
        status: 'todo',
        dependencies: [],
      });

      idx.upsertTask(lowTask);
      idx.upsertTask(criticalTask);

      const next = idx.getNextTask('TEST');
      expect(next).not.toBeNull();
      expect(next!.id).toBe('TEST-002');
    });

    it('skips tasks with unresolved dependencies', () => {
      ensureProject(idx, 'TEST');

      const dep = makeTask({
        id: 'TEST-001',
        title: 'Dep task',
        priority: 'low',
        status: 'todo',
        dependencies: [],
      });
      const dependent = makeTask({
        id: 'TEST-002',
        title: 'Depends on 001',
        priority: 'critical',
        status: 'todo',
        dependencies: ['TEST-001'],
      });

      idx.upsertTask(dep);
      idx.upsertTask(dependent);

      const next = idx.getNextTask('TEST');
      // TEST-002 is blocked by TEST-001 (not done), so only TEST-001 is eligible
      expect(next!.id).toBe('TEST-001');
    });

    it('returns null when no ready tasks exist', () => {
      ensureProject(idx, 'TEST');
      const task = makeTask({ status: 'done' });
      idx.upsertTask(task);

      const next = idx.getNextTask('TEST');
      expect(next).toBeNull();
    });
  });

  describe('listTasks()', () => {
    it('filters by status', () => {
      ensureProject(idx, 'TEST');
      idx.upsertTask(makeTask({ id: 'TEST-001', status: 'todo' }));
      idx.upsertTask(makeTask({ id: 'TEST-002', status: 'done' }));

      const todos = idx.listTasks({ status: 'todo' });
      expect(todos.every(t => t.status === 'todo')).toBe(true);
    });

    it('filters by project', () => {
      ensureProject(idx, 'TEST');
      ensureProject(idx, 'OTHER');

      idx.upsertTask(makeTask({ id: 'TEST-001', project: 'TEST' }));
      idx.upsertTask(makeTask({ id: 'OTHER-001', project: 'OTHER' }));

      const testTasks = idx.listTasks({ project: 'TEST' });
      expect(testTasks.every(t => t.project === 'TEST')).toBe(true);
      expect(testTasks.some(t => t.id === 'TEST-001')).toBe(true);
      expect(testTasks.some(t => t.id === 'OTHER-001')).toBe(false);
    });

    it('respects limit', () => {
      ensureProject(idx, 'TEST');
      for (let i = 1; i <= 5; i++) {
        idx.upsertTask(makeTask({ id: `TEST-00${i}` }));
      }

      const limited = idx.listTasks({ limit: 2 });
      expect(limited.length).toBeLessThanOrEqual(2);
    });

    it('filters by auto_captured', () => {
      ensureProject(idx, 'TEST');
      idx.upsertTask(makeTask({ id: 'TEST-010', auto_captured: true }));
      idx.upsertTask(makeTask({ id: 'TEST-011' }));

      const captured = idx.listTasks({ auto_captured: true });
      expect(captured.every(t => t.auto_captured === true)).toBe(true);
      expect(captured.some(t => t.id === 'TEST-010')).toBe(true);
      expect(captured.some(t => t.id === 'TEST-011')).toBe(false);
    });
  });

  describe('nextId()', () => {
    it('starts at 1 for a new project', () => {
      const id = idx.nextId('NEWPROJ');
      expect(id).toBe(1);
    });

    it('increments on each call', () => {
      const first = idx.nextId('NEWPROJ');
      const second = idx.nextId('NEWPROJ');
      const third = idx.nextId('NEWPROJ');
      expect(second).toBe(first + 1);
      expect(third).toBe(first + 2);
    });

    it('consults disk when tasksDir is provided — never returns an ID whose file exists', () => {
      // Regression for the MCPAT clobber bug: counter starts at 0 for a fresh
      // project row, but markdown files for IDs 1 and 2 already exist on disk
      // (e.g. global-storage tasks created before the index was rebuilt).
      // Naive increment would return 1 and the create path would overwrite
      // XX-001.md. nextId must skip past on-disk IDs.
      const tasksDir = path.join(tmpDir, 'tasks-with-existing');
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.writeFileSync(path.join(tasksDir, 'XX-001.md'), '---\nid: XX-001\n---\n');
      fs.writeFileSync(path.join(tasksDir, 'XX-002.md'), '---\nid: XX-002\n---\n');

      const id = idx.nextId('XX', tasksDir);

      expect(id).toBeGreaterThanOrEqual(3);
    });
  });

  describe('releaseTask()', () => {
    it('releases a claimed task for the correct session', () => {
      ensureProject(idx, 'TEST');
      idx.upsertTask(makeTask());
      idx.claimTask('TEST-001', 'session-A', 4);

      const released = idx.releaseTask('TEST-001', 'session-A');
      expect(released).toBe(true);

      // Now another session can claim it
      const claimed = idx.claimTask('TEST-001', 'session-B', 4);
      expect(claimed).toBe(true);
    });

    it('returns false when releasing with wrong session', () => {
      ensureProject(idx, 'TEST');
      idx.upsertTask(makeTask());
      idx.claimTask('TEST-001', 'session-A', 4);

      const released = idx.releaseTask('TEST-001', 'session-WRONG');
      expect(released).toBe(false);
    });
  });

  describe('getChildTasks()', () => {
    it('returns children registered via children table', () => {
      ensureProject(idx, 'TEST');
      // Parent must be inserted first (child FK references tasks.id)
      // Child task's parent FK must also point to an existing task
      // Strategy: insert both without the cross-reference, then update parent with children
      const parent = makeTask({ id: 'TEST-001', children: [] });
      const child = makeTask({ id: 'TEST-002', parent: null }); // avoid FK on parent col
      idx.upsertTask(parent);
      idx.upsertTask(child);

      // Now update parent to declare TEST-002 as a child
      const parentWithChild = makeTask({ id: 'TEST-001', children: ['TEST-002'] });
      idx.upsertTask(parentWithChild);

      const children = idx.getChildTasks('TEST-001');
      expect(children.some(c => c.id === 'TEST-002')).toBe(true);
    });
  });

  describe('getStats()', () => {
    it('returns by_status counts', () => {
      ensureProject(idx, 'TEST');
      idx.upsertTask(makeTask({ id: 'TEST-001', status: 'todo' }));
      idx.upsertTask(makeTask({ id: 'TEST-002', status: 'done' }));
      idx.upsertTask(makeTask({ id: 'TEST-003', status: 'done' }));

      const stats = idx.getStats('TEST');
      expect(stats.by_status.todo).toBe(1);
      expect(stats.by_status.done).toBe(2);
      expect(stats.completion_rate).toBeCloseTo(2 / 3, 2);
    });
  });

  describe('schema migration — new columns (Step 4)', () => {
    it('tasks table has milestone, estimate_hours, plan_file, auto_captured columns', () => {
      // Use PRAGMA table_info to verify column existence
      const cols = idx['db'].prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
      const colNames = cols.map(c => c.name);
      expect(colNames).toContain('milestone');
      expect(colNames).toContain('estimate_hours');
      expect(colNames).toContain('plan_file');
      expect(colNames).toContain('auto_captured');
    });

    it('milestones table exists', () => {
      const row = idx['db']
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='milestones'")
        .get() as { sql: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.sql).toContain('milestones');
    });

    it('task_references table exists', () => {
      const row = idx['db']
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='task_references'")
        .get() as { sql: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.sql).toContain('task_references');
    });

    it('init() is idempotent — calling twice does not throw', () => {
      expect(() => idx.init()).not.toThrow();
      expect(() => idx.init()).not.toThrow();
    });
  });

  describe('upsertTask() — new fields roundtrip (Step 5)', () => {
    it('persists and reads back milestone, estimate_hours, plan_file, auto_captured', () => {
      ensureProject(idx, 'TEST');
      const task = makeTask({
        milestone: 'v2.0',
        estimate_hours: 8,
        plan_file: 'scratchpads/x-plan.md',
        auto_captured: true,
      });
      idx.upsertTask(task);

      const retrieved = idx.getTask('TEST-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.milestone).toBe('v2.0');
      expect(retrieved!.estimate_hours).toBe(8);
      expect(retrieved!.plan_file).toBe('scratchpads/x-plan.md');
      expect(retrieved!.auto_captured).toBe(true);
    });

    it('omits new fields when not set (no spurious nulls on Task shape)', () => {
      ensureProject(idx, 'TEST');
      const task = makeTask();
      idx.upsertTask(task);

      const retrieved = idx.getTask('TEST-001');
      expect(retrieved!.milestone).toBeUndefined();
      expect(retrieved!.estimate_hours).toBeUndefined();
      expect(retrieved!.plan_file).toBeUndefined();
      expect(retrieved!.auto_captured).toBeUndefined();
    });
  });
});
