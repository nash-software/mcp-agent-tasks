/**
 * Integration test: MarkdownStore references → SQLite task_references sync
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskStore } from '../../src/store/task-store.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { ManifestWriter } from '../../src/store/manifest-writer.js';

describe('reference-sync: task_references ↔ SQLite', () => {
  let tmpDir: string;
  let tasksDir: string;
  let idx: SqliteIndex;
  let store: TaskStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-ref-sync-'));
    tasksDir = path.join(tmpDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

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

  it('creates task with references and syncs them to task_references table', () => {
    const task = store.createTask({
      project: 'TEST',
      title: 'Task with refs',
      type: 'feature',
      priority: 'medium',
      why: 'Test references',
      references: [{ type: 'closes', id: 'TEST-002' }],
    });

    // Verify the references appear in the index
    const loaded = idx.getTask(task.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.references).toHaveLength(1);
    expect(loaded!.references![0]).toEqual({ type: 'closes', id: 'TEST-002' });

    // Verify via raw DB
    const rawDb = idx.getRawDb();
    const rows = rawDb.prepare(
      'SELECT ref_type, to_id FROM task_references WHERE from_id=?',
    ).all(task.id) as Array<{ ref_type: string; to_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ ref_type: 'closes', to_id: 'TEST-002' });
  });

  it('re-upsert with empty references removes task_references rows', () => {
    const task = store.createTask({
      project: 'TEST',
      title: 'Task to clear refs',
      type: 'feature',
      priority: 'medium',
      why: 'Test reference removal',
      references: [{ type: 'closes', id: 'TEST-002' }],
    });

    // Confirm refs exist
    const rawDb = idx.getRawDb();
    const before = rawDb.prepare(
      'SELECT COUNT(*) as cnt FROM task_references WHERE from_id=?',
    ).get(task.id) as { cnt: number };
    expect(before.cnt).toBe(1);

    // Update task to remove references
    store.updateTask(task.id, { references: [] });

    // Confirm refs are gone
    const after = rawDb.prepare(
      'SELECT COUNT(*) as cnt FROM task_references WHERE from_id=?',
    ).get(task.id) as { cnt: number };
    expect(after.cnt).toBe(0);

    const loaded = idx.getTask(task.id);
    expect(loaded?.references ?? []).toHaveLength(0);
  });
});
