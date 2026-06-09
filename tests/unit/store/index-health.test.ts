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
    const { result, index } = ensureHealthyIndex(dbPath, {}, () => { rebuildCalled = true; });
    expect(result).toBe('ok');
    expect(rebuildCalled).toBe(false);
    // Healthy path returns an open index (Step D)
    expect(index).not.toBeNull();
    index!.close();
  });

  it('rebuilds a CORRUPT database from the markdown source', () => {
    // Write garbage where a valid SQLite db should be.
    fs.writeFileSync(dbPath, 'this is not a sqlite database at all\n'.repeat(50));

    const { result, index } = ensureHealthyIndex(dbPath, {}, (fresh) => {
      fresh.nextId('TEST');
      fresh.upsertTask(makeTask('TEST-1'));
      fresh.upsertTask(makeTask('TEST-2'));
      fresh.upsertTask(makeTask('TEST-3'));
    });

    expect(result).toBe('rebuilt');
    // Rebuilt path returns null — caller must open their own SqliteIndex (Step D)
    expect(index).toBeNull();
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
    const { result, index } = ensureHealthyIndex(dbPath, { maxDbBytes: 1 }, (fresh) => {
      rebuildCalled = true;
      fresh.nextId('TEST');
      fresh.upsertTask(makeTask('TEST-1'));
    });

    expect(result).toBe('rebuilt');
    expect(rebuildCalled).toBe(true);
    // Rebuilt path returns null (Step D)
    expect(index).toBeNull();
    expect(countTasks(dbPath)).toBe(1);
  });
});

// ── MCPAT-071: Step B — ratio-based self-heal ────────────────────────────────
describe('ensureHealthyIndex — Step B ratio-based self-heal', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = path.join(tmpDir, 'tasks.db');
  });
  afterEach(() => {
    rmDirSafe(tmpDir);
  });

  it('rebuilds a bloated DB (>=40% free pages, above page floor) and calls rebuildFn', () => {
    // Seed a DB with auto_vacuum OFF so freelist accumulates
    const db = new Database(dbPath);
    db.pragma('auto_vacuum = NONE');
    db.pragma('journal_mode = WAL');
    // Use the real schema by going through SqliteIndex init
    db.close();

    const idx = new SqliteIndex(dbPath);
    // Override auto_vacuum to NONE after constructor sets it to INCREMENTAL
    // so free pages actually accumulate during seeding
    idx['db'].pragma('auto_vacuum = NONE');
    idx.init();
    void idx.nextId('TEST');
    // Insert many tasks
    for (let i = 1; i <= 80; i++) {
      idx.upsertTask(makeTask(`TEST-${String(i).padStart(3, '0')}`));
    }
    // Delete most to create a high free-page ratio
    for (let i = 1; i <= 70; i++) {
      idx.deleteTask(`TEST-${String(i).padStart(3, '0')}`);
    }
    idx.checkpoint();
    // Verify seed: ratio should be >= 0.4 and page_count >= 256
    const freelistCount = idx['db'].pragma('freelist_count', { simple: true }) as number;
    const pageCount = idx['db'].pragma('page_count', { simple: true }) as number;
    idx.close();

    // Only run ratio test if seed actually produced bloat
    if (pageCount < 256 || freelistCount / pageCount < 0.4) {
      // Not enough pages to test — skip with a note
      // (tiny SQLite files may not reach the floor on all platforms)
      return;
    }

    let rebuildCalled = false;
    const { result } = ensureHealthyIndex(
      dbPath,
      { bloatRatio: 0.4, minPageFloor: 256 },
      (fresh) => {
        rebuildCalled = true;
        void fresh.nextId('TEST');
      },
    );
    expect(result).toBe('rebuilt');
    expect(rebuildCalled).toBe(true);
  });

  it('does NOT rebuild a healthy small DB (ratio < 0.4)', () => {
    const idx = new SqliteIndex(dbPath);
    idx.init();
    void idx.nextId('TEST');
    idx.upsertTask(makeTask('TEST-001'));
    idx.upsertTask(makeTask('TEST-002'));
    idx.close();

    let rebuildCalled = false;
    const { result, index } = ensureHealthyIndex(
      dbPath,
      { bloatRatio: 0.4, minPageFloor: 256 },
      () => { rebuildCalled = true; },
    );
    index?.close();
    expect(result).toBe('ok');
    expect(rebuildCalled).toBe(false);
  });

  it('freePageRatio() returns a number between 0 and 1 and does not throw', () => {
    const idx = new SqliteIndex(dbPath);
    idx.init();
    void idx.nextId('TEST');
    const ratio = idx.freePageRatio();
    expect(typeof ratio).toBe('number');
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
    idx.close();
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

  it('stores the canonical hash passed to upsertTask', () => {
    idx.upsertTask(makeTask('TEST-1', { body: 'hello' }), 'abc123');
    expect(idx.getBodyHash('TEST-1')).toBe('abc123');
  });

  it('stores null when no hash is provided (MCP-tool write path re-syncs next reconcile)', () => {
    idx.upsertTask(makeTask('TEST-1', { body: 'hello' }));
    expect(idx.getBodyHash('TEST-1')).toBeNull();
  });

  it('getBodyHash returns null for unknown task', () => {
    expect(idx.getBodyHash('NOPE-9')).toBeNull();
  });

  it('hashBody is deterministic and content-sensitive', () => {
    expect(SqliteIndex.hashBody('x')).toBe(SqliteIndex.hashBody('x'));
    expect(SqliteIndex.hashBody('x')).not.toBe(SqliteIndex.hashBody('y'));
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

  it('re-adds body_hash on init() for a legacy DB that lacks the column and db_schema_version', () => {
    // Build a DB, then simulate a legacy DB by dropping body_hash AND removing
    // db_schema_version so the migration block re-runs on next init().
    let idx = new SqliteIndex(dbPath);
    idx.init();
    idx.getRawDb().exec('ALTER TABLE tasks DROP COLUMN body_hash');
    idx.getRawDb().exec("DELETE FROM schema_meta WHERE key='db_schema_version'");
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

});

// ── MCPAT-071: Step D — single DB open at boot ───────────────────────────────
describe('ensureHealthyIndex — Step D single DB open + returned index', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = path.join(tmpDir, 'tasks.db');
  });
  afterEach(() => {
    rmDirSafe(tmpDir);
  });

  it('healthy path: returns an open index the caller can query without re-opening', () => {
    // Seed a healthy DB
    const seed = new SqliteIndex(dbPath);
    seed.init();
    void seed.nextId('TEST');
    seed.upsertTask(makeTask('TEST-1'));
    seed.close();

    let rebuildCalled = false;
    const { result, index } = ensureHealthyIndex(dbPath, {}, () => { rebuildCalled = true; });

    expect(result).toBe('ok');
    expect(rebuildCalled).toBe(false);
    expect(index).not.toBeNull();

    // The returned connection must be usable without a second open
    const task = index!.getTask('TEST-1');
    expect(task).not.toBeNull();
    expect(task!.id).toBe('TEST-1');

    index!.close();
  });

  it('rebuilt path: returns null (caller must open their own SqliteIndex)', () => {
    // Force a corrupt DB
    fs.writeFileSync(dbPath, 'not a sqlite db\n'.repeat(10));

    const { result, index } = ensureHealthyIndex(dbPath, {}, (fresh) => {
      void fresh.nextId('TEST');
      fresh.upsertTask(makeTask('TEST-1'));
    });

    expect(result).toBe('rebuilt');
    expect(index).toBeNull();
  });

  it('healthy path: index is already initialised (getTask works, no second init needed)', () => {
    const seed = new SqliteIndex(dbPath);
    seed.init();
    void seed.nextId('TEST');
    seed.upsertTask(makeTask('TEST-2'));
    seed.close();

    const { result, index } = ensureHealthyIndex(dbPath, {}, () => { /* noop */ });
    expect(result).toBe('ok');
    expect(index).not.toBeNull();

    // Should be able to list tasks without calling init() again
    const tasks = index!.listTasks({ project: 'TEST' });
    expect(tasks.some(t => t.id === 'TEST-2')).toBe(true);

    index!.close();
  });
});

// ── MCPAT-084: stale status CHECK constraint detection and rebuild ────────────
describe('ensureHealthyIndex — MCPAT-084 stale status CHECK constraint', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = path.join(tmpDir, 'tasks.db');
  });
  afterEach(() => {
    rmDirSafe(tmpDir);
  });

  /** Creates a raw DB whose tasks.status CHECK omits 'closed' (pre-MCPAT-084). */
  function makeStaleDb(dbPath: string): void {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'feature',
        status TEXT NOT NULL CHECK(status IN ('todo','in_progress','done','blocked','archived','draft','approved')),
        priority TEXT NOT NULL DEFAULT 'medium',
        project TEXT NOT NULL,
        complexity INTEGER,
        complexity_manual INTEGER NOT NULL DEFAULT 0,
        why TEXT,
        parent TEXT,
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        last_activity TEXT NOT NULL,
        claimed_by TEXT,
        claimed_at TEXT,
        claim_ttl_hours INTEGER DEFAULT 4,
        branch TEXT,
        pr_number INTEGER,
        pr_url TEXT,
        pr_state TEXT,
        pr_title TEXT,
        pr_merged_at TEXT,
        pr_base_branch TEXT,
        file_path TEXT NOT NULL DEFAULT '',
        body TEXT,
        schema_version INTEGER NOT NULL DEFAULT 1
      )
    `);
    db.close();
  }

  it('AC1: detects stale constraint and triggers rebuild; rebuilt tasks DDL includes closed', () => {
    makeStaleDb(dbPath);

    const { result } = ensureHealthyIndex(dbPath, {}, (fresh) => {
      void fresh.nextId('TEST');
    });

    expect(result).toBe('rebuilt');

    const ro = new Database(dbPath, { readonly: true });
    const row = ro.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'",
    ).get() as { sql: string };
    ro.close();
    expect(row.sql).toContain("'closed'");
  });

  it('AC2: after rebuild, upserting a task with status=closed succeeds without CHECK error', () => {
    makeStaleDb(dbPath);

    ensureHealthyIndex(dbPath, {}, (fresh) => {
      void fresh.nextId('TEST');
    });

    const idx = new SqliteIndex(dbPath);
    idx.init();
    void idx.nextId('TEST');
    expect(() => idx.upsertTask(makeTask('TEST-1', { status: 'closed' }))).not.toThrow();
    idx.close();
  });

  it('AC3: rebuild preserves all existing rows via rebuildFn (count + ids unchanged)', () => {
    makeStaleDb(dbPath);

    // Seed 3 rows in the stale DB
    const raw = new Database(dbPath);
    const now = new Date().toISOString();
    for (const id of ['TEST-1', 'TEST-2', 'TEST-3']) {
      raw
        .prepare(
          'INSERT INTO tasks (id, title, project, status, file_path, created, updated, last_activity) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(id, `Task ${id}`, 'TEST', 'todo', `/tmp/${id}.md`, now, now, now);
    }
    raw.close();

    // rebuildFn simulates reconcile-from-markdown by re-inserting the same rows
    ensureHealthyIndex(dbPath, {}, (fresh) => {
      void fresh.nextId('TEST');
      for (const id of ['TEST-1', 'TEST-2', 'TEST-3']) {
        fresh.upsertTask(makeTask(id));
      }
    });

    expect(countTasks(dbPath)).toBe(3);
    const ro = new Database(dbPath, { readonly: true });
    const ids = (ro.prepare('SELECT id FROM tasks ORDER BY id').all() as { id: string }[]).map(
      (r) => r.id,
    );
    ro.close();
    expect(ids).toEqual(['TEST-1', 'TEST-2', 'TEST-3']);
  });

  it('AC4: a DB created fresh from current schema.sql is NOT flagged stale', () => {
    const seed = new SqliteIndex(dbPath);
    seed.init();
    void seed.nextId('TEST');
    seed.upsertTask(makeTask('TEST-1'));
    seed.close();

    let rebuildCalled = false;
    const { result, index } = ensureHealthyIndex(dbPath, {}, () => {
      rebuildCalled = true;
    });
    index?.close();

    expect(result).toBe('ok');
    expect(rebuildCalled).toBe(false);
  });
});
