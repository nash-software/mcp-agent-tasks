/**
 * Rebuild index integration tests.
 * Tests that Reconciler can rebuild SQLite from markdown files on disk.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskStore } from '../../src/store/task-store.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { ManifestWriter } from '../../src/store/manifest-writer.js';
import { Reconciler } from '../../src/store/reconciler.js';

describe('Rebuild index via Reconciler', () => {
  let tmpDir: string;
  let tasksDir: string;
  let idx: SqliteIndex;
  let dbPath: string;
  let store: TaskStore;
  // Track any secondary index created inside tests so afterEach can always close it
  let secondaryIdx: SqliteIndex | null = null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-rebuild-test-'));
    tasksDir = path.join(tmpDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });

    dbPath = path.join(tmpDir, 'tasks.db');
    idx = new SqliteIndex(dbPath);
    idx.init();

    const markdownStore = new MarkdownStore();
    const manifestWriter = new ManifestWriter();
    store = new TaskStore(markdownStore, idx, manifestWriter, tasksDir, 'TEST');
    secondaryIdx = null;
  });

  afterEach(() => {
    try {
      secondaryIdx?.close();
    } catch {
      // May already be closed
    }
    try {
      idx.close();
    } catch {
      // May already be closed
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rebuilds SQLite index from 3 markdown files after DB deletion', () => {
    // Create 3 tasks (writes markdown + SQLite)
    const task1 = store.createTask({ project: 'TEST', title: 'Task One', type: 'feature', priority: 'high', why: 'y' });
    const task2 = store.createTask({ project: 'TEST', title: 'Task Two', type: 'bug', priority: 'medium', why: 'y' });
    const task3 = store.createTask({ project: 'TEST', title: 'Task Three', type: 'chore', priority: 'low', why: 'y' });

    // Verify all 3 are in index
    expect(idx.getTask(task1.id)).not.toBeNull();
    expect(idx.getTask(task2.id)).not.toBeNull();
    expect(idx.getTask(task3.id)).not.toBeNull();

    // Close and delete the SQLite database
    idx.close();
    fs.rmSync(dbPath);

    // Create a fresh index at the same path (tracked for afterEach cleanup)
    secondaryIdx = new SqliteIndex(dbPath);
    secondaryIdx.init();

    // Verify all 3 are gone from fresh index
    expect(secondaryIdx.getTask(task1.id)).toBeNull();
    expect(secondaryIdx.getTask(task2.id)).toBeNull();
    expect(secondaryIdx.getTask(task3.id)).toBeNull();

    // Run reconciler
    const reconciler = new Reconciler(secondaryIdx, tasksDir, 'TEST');
    const count = reconciler.reconcile();

    expect(count).toBe(3);

    // Verify all 3 are back in the index
    expect(secondaryIdx.getTask(task1.id)).not.toBeNull();
    expect(secondaryIdx.getTask(task2.id)).not.toBeNull();
    expect(secondaryIdx.getTask(task3.id)).not.toBeNull();

    // Verify task data integrity
    const rebuilt1 = secondaryIdx.getTask(task1.id);
    expect(rebuilt1?.title).toBe('Task One');
    expect(rebuilt1?.type).toBe('feature');
    expect(rebuilt1?.priority).toBe('high');
  });

  it('reconcile() skips corrupt markdown files and continues', () => {
    // Create 2 valid tasks
    const task1 = store.createTask({ project: 'TEST', title: 'Task One', type: 'feature', priority: 'high', why: 'y' });
    store.createTask({ project: 'TEST', title: 'Task Two', type: 'bug', priority: 'medium', why: 'y' });

    // Write a corrupt markdown file
    fs.writeFileSync(path.join(tasksDir, 'CORRUPT.md'), 'not valid frontmatter at all', 'utf-8');

    // Rebuild from scratch
    idx.close();
    fs.rmSync(dbPath);

    secondaryIdx = new SqliteIndex(dbPath);
    secondaryIdx.init();

    const reconciler = new Reconciler(secondaryIdx, tasksDir, 'TEST');
    // Should not throw — skips corrupt file
    const count = reconciler.reconcile();
    expect(count).toBe(2); // Only the 2 valid ones

    expect(secondaryIdx.getTask(task1.id)).not.toBeNull();
  });
});
