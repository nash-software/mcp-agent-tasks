import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';
import { Reconciler } from '../../../src/store/reconciler.js';
import type { Task } from '../../../src/types/task.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-reconciler-test-'));
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    id: 'PRUNE-001',
    title: 'Prune test task',
    type: 'feature',
    status: 'todo',
    priority: 'medium',
    project: 'PRUNE',
    tags: [],
    complexity: 3,
    complexity_manual: false,
    why: 'Testing prune.',
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
    file_path: '/nonexistent/PRUNE-001.md',
    ...overrides,
  };
}

function makeIndex(tmpDir: string): SqliteIndex {
  const dbPath = path.join(tmpDir, 'tasks.db');
  const idx = new SqliteIndex(dbPath);
  idx.init();
  return idx;
}

describe('Reconciler.pruneOrphans()', () => {
  let tmpDir: string;
  let idx: SqliteIndex;

  beforeEach(() => {
    tmpDir = makeTempDir();
    idx = makeIndex(tmpDir);
    // Ensure project row exists
    idx.nextId('PRUNE');
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes index entries whose markdown files do not exist on disk', () => {
    // Insert a task with a file_path pointing to a non-existent file
    const task = makeTask({ file_path: path.join(tmpDir, 'PRUNE-001.md') });
    idx.upsertTask(task);

    // Confirm the task is in the index
    expect(idx.getTask('PRUNE-001')).not.toBeNull();

    const reconciler = new Reconciler(idx, tmpDir, 'PRUNE');
    const pruned = reconciler.pruneOrphans();

    expect(pruned).toBe(1);
    expect(idx.getTask('PRUNE-001')).toBeNull();
  });

  it('keeps index entries whose markdown files still exist on disk', () => {
    const mdPath = path.join(tmpDir, 'PRUNE-001.md');
    fs.writeFileSync(mdPath, '# placeholder', 'utf-8');

    const task = makeTask({ file_path: mdPath });
    idx.upsertTask(task);

    const reconciler = new Reconciler(idx, tmpDir, 'PRUNE');
    const pruned = reconciler.pruneOrphans();

    expect(pruned).toBe(0);
    expect(idx.getTask('PRUNE-001')).not.toBeNull();
  });
});
