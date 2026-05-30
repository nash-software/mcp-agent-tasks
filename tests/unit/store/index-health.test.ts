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

  it('removes reverse-direction children + task_references rows (F2)', () => {
    idx.upsertTask(makeTask('TEST-A'));
    idx.upsertTask(makeTask('TEST-B'));
    const raw = idx.getRawDb();
    // TEST-A appears only as child_id / to_id (the reverse direction)
    raw.prepare('INSERT INTO children (parent_id, child_id) VALUES (?,?)').run('TEST-B', 'TEST-A');
    raw.prepare("INSERT INTO task_references (from_id, to_id, ref_type) VALUES (?,?,?)").run('TEST-B', 'TEST-A', 'related');

    idx.deleteTask('TEST-A');

    const ro = new Database(dbPath, { readonly: true });
    const kids = (ro.prepare('SELECT count(*) c FROM children WHERE child_id=?').get('TEST-A') as { c: number }).c;
    const refs = (ro.prepare('SELECT count(*) c FROM task_references WHERE to_id=?').get('TEST-A') as { c: number }).c;
    ro.close();
    expect(kids, 'reverse children row should be gone').toBe(0);
    expect(refs, 'reverse task_reference row should be gone').toBe(0);
  });
});

describe('SqliteIndex — body_hash column migration (existing DBs)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = path.join(tmpDir, 'tasks.db');
  });
  afterEach(() => {
    rmDirSafe(tmpDir);
  });

  it('re-adds body_hash on init() for a DB that lacks the column', () => {
    // Build a DB, then simulate a legacy DB by dropping body_hash.
    let idx = new SqliteIndex(dbPath);
    idx.init();
    idx.getRawDb().exec('ALTER TABLE tasks DROP COLUMN body_hash');
    // Sanity: column is gone.
    const cols0 = (idx.getRawDb().prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map(c => c.name);
    expect(cols0).not.toContain('body_hash');
    idx.close();

    // Re-open + init() must restore the column via addColumnIfNotExists.
    idx = new SqliteIndex(dbPath);
    idx.init();
    void idx.nextId('TEST');
    const cols1 = (idx.getRawDb().prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map(c => c.name);
    expect(cols1, 'body_hash must be migrated back').toContain('body_hash');
    // And upsert (which writes @body_hash) must not throw.
    expect(() => idx.upsertTask(makeTask('TEST-1'))).not.toThrow();
    idx.close();
  });

  it('setBodyHash overwrites the stored hash', () => {
    const idx = new SqliteIndex(dbPath);
    idx.init();
    void idx.nextId('TEST');
    idx.upsertTask(makeTask('TEST-1', { body: 'body' }));
    idx.setBodyHash('TEST-1', 'deadbeef');
    expect(idx.getBodyHash('TEST-1')).toBe('deadbeef');
    idx.close();
  });
});
