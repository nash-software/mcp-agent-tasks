/**
 * MCPAT-065 — the Reconciler must skip a single poison markdown file (e.g. an invalid `priority` that
 * trips the SQLite CHECK constraint) and index the rest, rather than rethrowing and aborting the whole
 * project's reconcile (which previously crashed `rebuild-index` and would crash reconcile-on-boot).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';
import { Reconciler } from '../../../src/store/reconciler.js';
import { TaskStore } from '../../../src/store/task-store.js';
import { MarkdownStore } from '../../../src/store/markdown-store.js';
import { ManifestWriter } from '../../../src/store/manifest-writer.js';

describe('Reconciler — poison-file resilience (MCPAT-065)', () => {
  let tmpDir: string;
  let tasksDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-reconciler-resilience-'));
    tasksDir = path.join(tmpDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips a file with an invalid priority and indexes the rest (does not throw)', () => {
    // Seed three valid tasks (writes markdown + index) via a first index/store.
    const seedDb = path.join(tmpDir, 'seed.db');
    const seedIdx = new SqliteIndex(seedDb);
    seedIdx.init();
    const store = new TaskStore(new MarkdownStore(), seedIdx, new ManifestWriter(), tasksDir, 'RES');
    const t1 = store.createTask({ project: 'RES', title: 'Valid one', type: 'chore', priority: 'low', why: 'x' });
    const t2 = store.createTask({ project: 'RES', title: 'Valid two', type: 'chore', priority: 'medium', why: 'x' });
    const t3 = store.createTask({ project: 'RES', title: 'Poison', type: 'chore', priority: 'low', why: 'x' });
    seedIdx.close();

    // Poison t3's markdown: an invalid priority value that trips the index CHECK constraint on upsert.
    const poisoned = fs.readFileSync(t3.file_path, 'utf-8').replace(/^priority:.*$/m, 'priority: normal');
    fs.writeFileSync(t3.file_path, poisoned, 'utf-8');

    // Reconcile into a FRESH index — this is the dashboard-boot path. It must NOT throw.
    const freshDb = path.join(tmpDir, 'fresh.db');
    const idx = new SqliteIndex(freshDb);
    idx.init();
    const reconciler = new Reconciler(idx, tasksDir, 'RES');

    let count = 0;
    expect(() => { count = reconciler.reconcile(); }).not.toThrow();

    // The two valid tasks are indexed; the poison one is skipped.
    expect(count).toBe(2);
    expect(idx.getTask(t1.id)).not.toBeNull();
    expect(idx.getTask(t2.id)).not.toBeNull();
    expect(idx.getTask(t3.id)).toBeNull();
    idx.close();
  });
});
