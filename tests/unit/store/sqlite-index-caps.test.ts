import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';
import { MAX_TRANSITIONS, MAX_COMMITS, MAX_TAGS } from '../../../src/store/limits.js';
import type { Task, StatusTransition } from '../../../src/types/task.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-caps-test-'));
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    id: 'TEST-001',
    title: 'Test task',
    type: 'feature',
    status: 'todo',
    priority: 'medium',
    project: 'TEST',
    tags: [],
    complexity: 3,
    complexity_manual: false,
    why: 'Because testing.',
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
    file_path: '/tmp/TEST-001.md',
    ...overrides,
  };
}

function makeIndex(tmpDir: string): { idx: SqliteIndex; dbPath: string } {
  const dbPath = path.join(tmpDir, 'tasks.db');
  const idx = new SqliteIndex(dbPath);
  idx.init();
  void idx.nextId('TEST'); // create project row
  return { idx, dbPath };
}

describe('SqliteIndex — child-array caps (bloat prevention)', () => {
  let tmpDir: string;
  let idx: SqliteIndex;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ({ idx, dbPath } = makeIndex(tmpDir));
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('caps transitions at MAX_TRANSITIONS even when handed a longer array', () => {
    const now = new Date().toISOString();
    const transitions: StatusTransition[] = Array.from({ length: MAX_TRANSITIONS + 50 }, (_, i) => ({
      from: 'todo',
      to: 'in_progress',
      at: now,
      reason: `transition ${i}`,
    }));
    idx.upsertTask(makeTask({ transitions }));

    const retrieved = idx.getTask('TEST-001');
    expect(retrieved!.transitions.length).toBe(MAX_TRANSITIONS);

    // Raw row count in SQLite must also be capped (the actual bloat vector).
    const ro = new Database(dbPath, { readonly: true });
    const { c } = ro.prepare('SELECT count(*) c FROM transitions WHERE task_id=?').get('TEST-001') as { c: number };
    ro.close();
    expect(c).toBe(MAX_TRANSITIONS);
  });

  it('keeps the LAST transitions (slice from the tail)', () => {
    const now = new Date().toISOString();
    const transitions: StatusTransition[] = Array.from({ length: MAX_TRANSITIONS + 5 }, (_, i) => ({
      from: 'todo',
      to: 'in_progress',
      at: now,
      reason: `r${i}`,
    }));
    idx.upsertTask(makeTask({ transitions }));
    const retrieved = idx.getTask('TEST-001');
    // last one preserved, earliest dropped
    expect(retrieved!.transitions.at(-1)!.reason).toBe(`r${MAX_TRANSITIONS + 4}`);
    expect(retrieved!.transitions.some(t => t.reason === 'r0')).toBe(false);
  });

  it('caps commits at MAX_COMMITS', () => {
    const now = new Date().toISOString();
    const commits = Array.from({ length: MAX_COMMITS + 30 }, (_, i) => ({
      sha: `sha${i.toString().padStart(40, '0')}`,
      message: `commit ${i}`,
      authored_at: now,
    }));
    idx.upsertTask(makeTask({ git: { commits } }));

    const retrieved = idx.getTask('TEST-001');
    expect(retrieved!.git.commits.length).toBe(MAX_COMMITS);

    const ro = new Database(dbPath, { readonly: true });
    const { c } = ro.prepare('SELECT count(*) c FROM commits WHERE task_id=?').get('TEST-001') as { c: number };
    ro.close();
    expect(c).toBe(MAX_COMMITS);
  });

  it('caps + dedups tags at MAX_TAGS', () => {
    const tags = [
      ...Array.from({ length: MAX_TAGS + 20 }, (_, i) => `tag${i}`),
      'tag0', 'tag1', 'tag0', // duplicates
    ];
    idx.upsertTask(makeTask({ tags }));
    const retrieved = idx.getTask('TEST-001');
    expect(retrieved!.tags.length).toBeLessThanOrEqual(MAX_TAGS);
    // dedup: no repeated tag
    expect(new Set(retrieved!.tags).size).toBe(retrieved!.tags.length);
  });

  it('does NOT accumulate transition rows across repeated upserts of the same task', () => {
    const now = new Date().toISOString();
    const transitions: StatusTransition[] = Array.from({ length: 10 }, (_, i) => ({
      from: 'todo',
      to: 'in_progress',
      at: now,
      reason: `r${i}`,
    }));
    const task = makeTask({ transitions });
    for (let n = 0; n < 5; n++) idx.upsertTask(task); // re-index 5×

    const ro = new Database(dbPath, { readonly: true });
    const { c } = ro.prepare('SELECT count(*) c FROM transitions WHERE task_id=?').get('TEST-001') as { c: number };
    ro.close();
    expect(c).toBe(10); // delete-before-insert keeps it exact, never 50
  });
});

describe('SqliteIndex — WAL / pragma hardening', () => {
  let tmpDir: string;
  let idx: SqliteIndex;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ({ idx, dbPath } = makeIndex(tmpDir));
  });
  afterEach(() => {
    try { idx.close(); } catch { /* may already be closed */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('opens the database in WAL journal mode (persisted in header)', () => {
    const ro = new Database(dbPath, { readonly: true });
    const mode = ro.pragma('journal_mode', { simple: true }) as string;
    ro.close();
    expect(mode).toBe('wal');
  });

  it('checkpoint() runs without throwing', () => {
    idx.upsertTask(makeTask());
    expect(() => idx.checkpoint()).not.toThrow();
  });

  it('close() checkpoints the WAL (no oversized -wal left behind)', () => {
    for (let i = 0; i < 20; i++) idx.upsertTask(makeTask({ id: `TEST-${i}`, file_path: `/tmp/TEST-${i}.md` }));
    idx.close();
    const wal = `${dbPath}-wal`;
    if (fs.existsSync(wal)) {
      // After a TRUNCATE checkpoint the WAL is emptied, not multi-MB.
      expect(fs.statSync(wal).size).toBeLessThan(1024 * 1024);
    }
  });
});

describe('SqliteIndex — FTS5 shadow reset (rebuildFts)', () => {
  let tmpDir: string;
  let idx: SqliteIndex;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ({ idx, dbPath } = makeIndex(tmpDir));
  });
  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rebuildFts() leaves exactly one FTS docsize row per task (no leak)', () => {
    for (let i = 0; i < 12; i++) {
      idx.upsertTask(makeTask({ id: `TEST-${i}`, title: `task ${i}`, file_path: `/tmp/TEST-${i}.md` }));
    }
    // Churn: re-upsert to simulate repeated reconciles (the leak vector).
    for (let r = 0; r < 5; r++) {
      for (let i = 0; i < 12; i++) {
        idx.upsertTask(makeTask({ id: `TEST-${i}`, title: `task ${i} v${r}`, file_path: `/tmp/TEST-${i}.md` }));
      }
    }
    idx.rebuildFts();

    const ro = new Database(dbPath, { readonly: true });
    const tasks = (ro.prepare('SELECT count(*) c FROM tasks').get() as { c: number }).c;
    const docsize = (ro.prepare('SELECT count(*) c FROM tasks_fts_docsize').get() as { c: number }).c;
    ro.close();
    expect(tasks).toBe(12);
    expect(docsize).toBe(tasks); // shadow table reset to match content, no orphans
  });
});
