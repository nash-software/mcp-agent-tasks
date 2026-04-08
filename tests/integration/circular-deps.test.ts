/**
 * Circular dependency detection tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskStore } from '../../src/store/task-store.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { ManifestWriter } from '../../src/store/manifest-writer.js';
import { McpTasksError } from '../../src/types/errors.js';
import type { TaskUpdateInput } from '../../src/types/tools.js';

// Helper: updateTask accepts extended fields (dependencies, subtasks, etc.) via Record cast
function updateDeps(store: TaskStore, id: string, deps: string[]) {
  return store.updateTask(id, { id, dependencies: deps } as unknown as TaskUpdateInput);
}

describe('Circular dependency detection', () => {
  let tmpDir: string;
  let tasksDir: string;
  let idx: SqliteIndex;
  let store: TaskStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-circdep-test-'));
    tasksDir = path.join(tmpDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });

    const dbPath = path.join(tmpDir, 'tasks.db');
    idx = new SqliteIndex(dbPath);
    idx.init();

    const markdownStore = new MarkdownStore();
    const manifestWriter = new ManifestWriter();
    store = new TaskStore(markdownStore, idx, manifestWriter, tasksDir, 'TEST');
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creating B → A and C → B succeeds (no cycle)', () => {
    const taskA = store.createTask({ project: 'TEST', title: 'A', type: 'feature', priority: 'low', why: 'y' });
    const taskB = store.createTask({ project: 'TEST', title: 'B', type: 'feature', priority: 'low', why: 'y', dependencies: [taskA.id] });
    const taskC = store.createTask({ project: 'TEST', title: 'C', type: 'feature', priority: 'low', why: 'y', dependencies: [taskB.id] });

    expect(taskB.dependencies).toContain(taskA.id);
    expect(taskC.dependencies).toContain(taskB.id);
  });

  it('updateTask: setting A → B when B already depends on A throws CIRCULAR_DEPENDENCY', () => {
    const taskA = store.createTask({ project: 'TEST', title: 'A', type: 'feature', priority: 'low', why: 'y' });
    const taskB = store.createTask({ project: 'TEST', title: 'B', type: 'feature', priority: 'low', why: 'y', dependencies: [taskA.id] });

    // B → A exists. Setting A → B would create A ↔ B mutual cycle.
    expect(() => updateDeps(store, taskA.id, [taskB.id])).toThrow(McpTasksError);

    try {
      updateDeps(store, taskA.id, [taskB.id]);
    } catch (err) {
      expect(err).toBeInstanceOf(McpTasksError);
      expect((err as McpTasksError).code).toBe('CIRCULAR_DEPENDENCY');
    }
  });

  it('updateTask: longer chain cycle — A → B → C, then C → A throws CIRCULAR_DEPENDENCY', () => {
    const taskA = store.createTask({ project: 'TEST', title: 'A', type: 'feature', priority: 'low', why: 'y' });
    const taskB = store.createTask({ project: 'TEST', title: 'B', type: 'feature', priority: 'low', why: 'y', dependencies: [taskA.id] });
    const taskC = store.createTask({ project: 'TEST', title: 'C', type: 'feature', priority: 'low', why: 'y', dependencies: [taskB.id] });

    // Chain: C → B → A. Setting A → C would create A → C → B → A cycle.
    expect(() => updateDeps(store, taskA.id, [taskC.id])).toThrow(McpTasksError);

    try {
      updateDeps(store, taskA.id, [taskC.id]);
    } catch (err) {
      expect(err).toBeInstanceOf(McpTasksError);
      expect((err as McpTasksError).code).toBe('CIRCULAR_DEPENDENCY');
    }
  });

  it('createTask: direct cycle detected when new task would close an existing loop', () => {
    const taskA = store.createTask({ project: 'TEST', title: 'A', type: 'feature', priority: 'low', why: 'y' });
    const taskB = store.createTask({ project: 'TEST', title: 'B', type: 'feature', priority: 'low', why: 'y', dependencies: [taskA.id] });

    // Now update A to depend on B — should throw
    expect(() => updateDeps(store, taskA.id, [taskB.id])).toThrow(McpTasksError);
  });

  it('self-dependency: task depending on itself throws CIRCULAR_DEPENDENCY', () => {
    const taskA = store.createTask({ project: 'TEST', title: 'A', type: 'feature', priority: 'low', why: 'y' });

    expect(() => updateDeps(store, taskA.id, [taskA.id])).toThrow(McpTasksError);
  });
});
