/**
 * Integration test for rebuild-index --prune-orphans behavior.
 * Verifies that after reconcile(), pruneOrphans() removes stale index rows
 * for tasks whose markdown files were deleted after initial indexing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { ManifestWriter } from '../../src/store/manifest-writer.js';
import { TaskStore } from '../../src/store/task-store.js';
import { Reconciler } from '../../src/store/reconciler.js';

describe('rebuild-index --prune-orphans behavior', () => {
  let tmpDir: string;
  let tasksDir: string;
  let idx: SqliteIndex;
  let store: TaskStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-prune-int-test-'));
    tasksDir = path.join(tmpDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });

    const dbPath = path.join(tmpDir, '.index.db');
    idx = new SqliteIndex(dbPath);
    idx.init();

    const markdownStore = new MarkdownStore();
    const manifestWriter = new ManifestWriter();
    store = new TaskStore(markdownStore, idx, manifestWriter, tasksDir, 'PRUNE');
  });

  afterEach(() => {
    try { idx.close(); } catch { /* already closed */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('pruneOrphans() removes stale rows after reconcile when markdown file deleted', () => {
    // Create two tasks (writes markdown + inserts into SQLite)
    const task1 = store.createTask({ project: 'PRUNE', title: 'Stays', type: 'chore', priority: 'low', why: 'test' });
    const task2 = store.createTask({ project: 'PRUNE', title: 'Gets Deleted', type: 'chore', priority: 'low', why: 'test' });

    expect(idx.getTask(task1.id)).not.toBeNull();
    expect(idx.getTask(task2.id)).not.toBeNull();

    // Simulate external file deletion — only task2's markdown is removed
    fs.rmSync(task2.file_path);

    // Run the same sequence the CLI uses: reconcile() then pruneOrphans()
    const reconciler = new Reconciler(idx, tasksDir, 'PRUNE');
    reconciler.reconcile();
    const pruned = reconciler.pruneOrphans();

    // task2 should be pruned; task1 should survive
    expect(pruned).toBe(1);
    expect(idx.getTask(task1.id)).not.toBeNull();
    expect(idx.getTask(task2.id)).toBeNull();
  });
});
