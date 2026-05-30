import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';
import { ensureHealthyIndex } from '../../../src/store/index-health.js';
import type { Task } from '../../../src/types/task.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-health-test-'));
}

// Windows can briefly hold a SQLite file handle after close(); retry teardown.
function rmDirSafe(dir: string): void {
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { /* retry */ }
  }
}

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    id,
    title: `Task ${id}`,
    type: 'feature',
    status: 'todo',
    priority: 'medium',
    project: 'TEST',
    tags: [],
    complexity: 3,
    complexity_manual: false,
    why: 'testing',
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
    body: `body of ${id}`,
    file_path: `/tmp/${id}.md`,
    ...overrides,
  };
}

function countTasks(dbPath: string): number {
  const ro = new Database(dbPath, { readonly: true });
  const c = (ro.prepare('SELECT count(*) c FROM tasks').get() as { c: number }).c;
  ro.close();
  return c;
}

describe('ensureHealthyIndex — self-heal', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = path.join(tmpDir, 'tasks.db');
  });
  afterEach(() => {
    rmDirSafe(tmpDir);
  });

  it('returns "ok" for a healthy index and does NOT call rebuildFn', () => {
    const idx = new SqliteIndex(dbPath);
    idx.init();
    void idx.nextId('TEST');
    idx.upsertTask(makeTask('TEST-1'));
    idx.close();

    let rebuildCalled = false;
    const result = ensureHealthyIndex(dbPath, {}, () => { rebuildCalled = true; });
    expect(result).toBe('ok');
    expect(rebuildCalled).toBe(false);
  });

  it('rebuilds a CORRUPT database from the markdown source', () => {
    // Write garbage where a valid SQLite db should be.
    fs.writeFileSync(dbPath, 'this is not a sqlite database at all\n'.repeat(50));

    const result = ensureHealthyIndex(dbPath, {}, (fresh) => {
      fresh.nextId('TEST');
      fresh.upsertTask(makeTask('TEST-1'));
      fresh.upsertTask(makeTask('TEST-2'));
      fresh.upsertTask(makeTask('TEST-3'));
    });

    expect(result).toBe('rebuilt');
    expect(countTasks(dbPath)).toBe(3);
  });

  it('rebuilds when the database exceeds the size threshold', () => {
    const idx = new SqliteIndex(dbPath);
    idx.init();
    void idx.nextId('TEST');
    idx.upsertTask(makeTask('TEST-1'));
    idx.close();

    // threshold of 1 byte forces the oversized path even on a tiny valid db.
    let rebuildCalled = false;
    const result = ensureHealthyIndex(dbPath, { maxDbBytes: 1 }, (fresh) => {
      rebuildCalled = true;
      fresh.nextId('TEST');
      fresh.upsertTask(makeTask('TEST-1'));
    });

    expect(result).toBe('rebuilt');
    expect(rebuildCalled).toBe(true);
    expect(countTasks(dbPath)).toBe(1);
  });
});

describe('SqliteIndex — body_hash (incremental reconcile mechanism)', () => {
  let tmpDir: string;
  let idx: SqliteIndex;

  beforeEach(() => {
    tmpDir = makeTempDir();
    idx = new SqliteIndex(path.join(tmpDir, 'tasks.db'));
    idx.init();
    void idx.nextId('TEST');
  });
  afterEach(() => {
    idx.close();
    rmDirSafe(tmpDir);
  });

  it('stores body_hash on upsert; getBodyHash matches hashBody(body)', () => {
    const task = makeTask('TEST-1', { body: 'hello world' });
    idx.upsertTask(task);
    expect(idx.getBodyHash('TEST-1')).toBe(SqliteIndex.hashBody('hello world'));
  });

  it('hash changes when body changes (so reconcile will re-index)', () => {
    idx.upsertTask(makeTask('TEST-1', { body: 'v1' }));
    const h1 = idx.getBodyHash('TEST-1');
    idx.upsertTask(makeTask('TEST-1', { body: 'v2' }));
    const h2 = idx.getBodyHash('TEST-1');
    expect(h1).not.toBe(h2);
  });

  it('getBodyHash returns null for unknown task', () => {
    expect(idx.getBodyHash('NOPE-9')).toBeNull();
  });
});

describe('SqliteIndex — deleteTask leaves no orphan child rows', () => {
  let tmpDir: string;
  let idx: SqliteIndex;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = path.join(tmpDir, 'tasks.db');
    idx = new SqliteIndex(dbPath);
    idx.init();
    void idx.nextId('TEST');
  });
  afterEach(() => {
    idx.close();
    rmDirSafe(tmpDir);
  });

  it('removes all child rows on delete', () => {
    const now = new Date().toISOString();
    idx.upsertTask(makeTask('TEST-1', {
      tags: ['a', 'b'],
      transitions: [{ from: 'todo', to: 'in_progress', at: now, reason: 'r' }],
      git: { commits: [{ sha: 'a'.repeat(40), message: 'm', authored_at: now }] },
    }));
    idx.deleteTask('TEST-1');

    const ro = new Database(dbPath, { readonly: true });
    // all three child tables key on task_id and were populated above
    for (const tbl of ['tags', 'transitions', 'commits']) {
      const c = (ro.prepare(`SELECT count(*) c FROM ${tbl} WHERE task_id=?`).get('TEST-1') as { c: number }).c;
      expect(c, `${tbl} should have no orphan rows`).toBe(0);
    }
    const tasksLeft = (ro.prepare('SELECT count(*) c FROM tasks WHERE id=?').get('TEST-1') as { c: number }).c;
    ro.close();
    expect(tasksLeft).toBe(0);
  });
});
