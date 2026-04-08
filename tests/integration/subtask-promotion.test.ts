/**
 * Subtask promotion integration tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskStore } from '../../src/store/task-store.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { ManifestWriter } from '../../src/store/manifest-writer.js';
import type { ToolContext } from '../../src/tools/context.js';
import type { McpTasksConfig } from '../../src/config/loader.js';
import type { Task } from '../../src/types/task.js';

function makeConfig(storageDir: string): McpTasksConfig {
  return {
    version: 1,
    storageDir,
    defaultStorage: 'global',
    enforcement: 'warn',
    autoCommit: false,
    claimTtlHours: 4,
    trackManifest: true,
    projects: [],
  };
}

describe('Subtask promotion', () => {
  let tmpDir: string;
  let tasksDir: string;
  let idx: SqliteIndex;
  let store: TaskStore;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-subtask-test-'));
    tasksDir = path.join(tmpDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });

    const dbPath = path.join(tmpDir, 'tasks.db');
    idx = new SqliteIndex(dbPath);
    idx.init();

    const markdownStore = new MarkdownStore();
    const manifestWriter = new ManifestWriter();
    store = new TaskStore(markdownStore, idx, manifestWriter, tasksDir, 'TEST');

    ctx = {
      store,
      index: idx,
      sessionId: 'test-session',
      config: makeConfig(tmpDir),
    };
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a subtask to a parent task via task_add_subtask', async () => {
    const { execute: addSubtaskExecute } = await import('../../src/tools/task-add-subtask.js');

    const parent = store.createTask({ project: 'TEST', title: 'Parent', type: 'feature', priority: 'medium', why: 'y' });
    expect(parent.id).toBe('TEST-001');

    const result = await addSubtaskExecute({ parent_id: parent.id, title: 'Subtask 1' }, ctx);
    const updated = JSON.parse(result.content[0].text) as Task;

    expect(updated.subtasks).toHaveLength(1);
    expect(updated.subtasks[0].id).toBe('TEST-001.1');
    expect(updated.subtasks[0].title).toBe('Subtask 1');
    expect(updated.subtasks[0].status).toBe('todo');
  });

  it('promotes a subtask to a full task via task_promote_subtask', async () => {
    const { execute: addSubtaskExecute } = await import('../../src/tools/task-add-subtask.js');
    const { execute: promoteExecute } = await import('../../src/tools/task-promote-subtask.js');

    const parent = store.createTask({ project: 'TEST', title: 'Parent', type: 'feature', priority: 'medium', why: 'y' });

    // Add subtask
    await addSubtaskExecute({ parent_id: parent.id, title: 'My subtask' }, ctx);

    // Promote it
    const promoteResult = await promoteExecute({ parent_id: parent.id, subtask_id: 'TEST-001.1' }, ctx);
    const promoteData = JSON.parse(promoteResult.content[0].text) as { promoted_task_id: string; parent_task_id: string };

    expect(promoteData.parent_task_id).toBe('TEST-001');
    expect(promoteData.promoted_task_id).toBe('TEST-002'); // Next sequential ID

    // Verify promoted task exists in index
    const promotedTask = idx.getTask(promoteData.promoted_task_id);
    expect(promotedTask).not.toBeNull();
    expect(promotedTask?.parent).toBe('TEST-001');
    expect(promotedTask?.title).toBe('My subtask');

    // Verify parent no longer has the subtask but has promoted task in children
    const updatedParent = idx.getTask(parent.id);
    expect(updatedParent?.subtasks).toHaveLength(0);
    expect(updatedParent?.children).toContain('TEST-002');
  });

  it('can add multiple subtasks and promote one without affecting others', async () => {
    const { execute: addSubtaskExecute } = await import('../../src/tools/task-add-subtask.js');
    const { execute: promoteExecute } = await import('../../src/tools/task-promote-subtask.js');

    const parent = store.createTask({ project: 'TEST', title: 'Parent', type: 'feature', priority: 'medium', why: 'y' });

    await addSubtaskExecute({ parent_id: parent.id, title: 'Sub 1' }, ctx);
    await addSubtaskExecute({ parent_id: parent.id, title: 'Sub 2' }, ctx);
    await addSubtaskExecute({ parent_id: parent.id, title: 'Sub 3' }, ctx);

    // Promote the second subtask
    await promoteExecute({ parent_id: parent.id, subtask_id: 'TEST-001.2' }, ctx);

    const updatedParent = idx.getTask(parent.id);
    // Should have 2 remaining subtasks (sub 1 and sub 3)
    expect(updatedParent?.subtasks).toHaveLength(2);
    const subtaskIds = updatedParent?.subtasks.map(s => s.id) ?? [];
    expect(subtaskIds).toContain('TEST-001.1');
    expect(subtaskIds).toContain('TEST-001.3');
    expect(subtaskIds).not.toContain('TEST-001.2');
  });
});
