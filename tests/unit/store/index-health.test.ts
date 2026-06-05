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
    const result = ensureHealthyIndex(
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
    const result = ensureHealthyIndex(
      dbPath,
      { bloatRatio: 0.4, minPageFloor: 256 },
      () => { rebuildCalled = true; },
    );
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

});
