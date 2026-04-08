/**
 * Performance benchmarks. Only run when PERF_TESTS=1 is set in environment.
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

const PERF_ENABLED = !!process.env['PERF_TESTS'];

describe.skipIf(!PERF_ENABLED)('Performance benchmarks', () => {
  let tmpDir: string;
  let tasksDir: string;
  let idx: SqliteIndex;
  let store: TaskStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-perf-test-'));
    tasksDir = path.join(tmpDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });

    const dbPath = path.join(tmpDir, 'tasks.db');
    idx = new SqliteIndex(dbPath);
    idx.init();

    const markdownStore = new MarkdownStore();
    const manifestWriter = new ManifestWriter();
    store = new TaskStore(markdownStore, idx, manifestWriter, tasksDir, 'PERF');
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates 500 tasks', async () => {
    const start = Date.now();
    for (let i = 0; i < 500; i++) {
      store.createTask({
        project: 'PERF',
        title: `Task ${i}`,
        type: 'feature',
        priority: 'medium',
        why: `Reason for task ${i}`,
      });
    }
    const elapsed = Date.now() - start;
    console.log(`[perf] 500 task creation: ${elapsed}ms`);
    // No hard limit on creation since it involves file I/O — just log
    expect(elapsed).toBeGreaterThan(0);
  });

  it('list 500 tasks < 10ms', () => {
    // Create 500 tasks first
    for (let i = 0; i < 500; i++) {
      store.createTask({
        project: 'PERF',
        title: `Task ${i}`,
        type: 'chore',
        priority: 'low',
        why: `Reason ${i}`,
      });
    }

    const start = Date.now();
    const tasks = idx.listTasks({ project: 'PERF', limit: 500 });
    const elapsed = Date.now() - start;

    console.log(`[perf] listTasks(500): ${elapsed}ms`);
    expect(tasks).toHaveLength(500);
    expect(elapsed).toBeLessThan(10);
  });

  it('FTS5 search on 500 tasks < 10ms', () => {
    for (let i = 0; i < 500; i++) {
      store.createTask({
        project: 'PERF',
        title: `Task ${i} performance testing`,
        type: 'spike',
        priority: 'high',
        why: `Performance reason ${i}`,
      });
    }

    const start = Date.now();
    const results = idx.searchTasks('performance');
    const elapsed = Date.now() - start;

    console.log(`[perf] searchTasks('performance', 500 tasks): ${elapsed}ms, ${results.length} results`);
    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10);
  });

  it('full rebuild of 500 tasks < 200ms', () => {
    for (let i = 0; i < 500; i++) {
      store.createTask({
        project: 'PERF',
        title: `Task ${i}`,
        type: 'feature',
        priority: 'medium',
        why: `Reason ${i}`,
      });
    }

    // Close and recreate fresh index
    idx.close();
    const dbPath = path.join(tmpDir, 'tasks.db');
    fs.rmSync(dbPath);

    const freshIdx = new SqliteIndex(dbPath);
    freshIdx.init();

    const reconciler = new Reconciler(freshIdx, tasksDir, 'PERF');
    const start = Date.now();
    const count = reconciler.reconcile();
    const elapsed = Date.now() - start;

    console.log(`[perf] reconcile(500 tasks): ${elapsed}ms`);
    expect(count).toBe(500);
    expect(elapsed).toBeLessThan(200);

    idx = freshIdx; // For cleanup
  });
});
