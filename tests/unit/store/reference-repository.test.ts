import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';
import { ReferenceRepository } from '../../../src/store/reference-repository.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-ref-test-'));
}

function makeIndex(tmpDir: string): SqliteIndex {
  const dbPath = path.join(tmpDir, 'tasks.db');
  const idx = new SqliteIndex(dbPath);
  idx.init();
  return idx;
}

function insertTask(idx: SqliteIndex, id: string, project = 'TEST'): void {
  idx.ensureProject(project);
  const now = new Date().toISOString();
  idx.getRawDb().prepare(`
    INSERT OR IGNORE INTO tasks (id, title, type, status, priority, project, created, updated, last_activity, file_path, schema_version)
    VALUES (?, 'test', 'feature', 'todo', 'medium', ?, ?, ?, ?, '/tmp/t.md', 1)
  `).run(id, project, now, now, now);
}

describe('ReferenceRepository', () => {
  let tmpDir: string;
  let idx: SqliteIndex;
  let repo: ReferenceRepository;

  beforeEach(() => {
    tmpDir = makeTempDir();
    idx = makeIndex(tmpDir);
    repo = new ReferenceRepository(idx.getRawDb());
    insertTask(idx, 'TEST-001');
    insertTask(idx, 'TEST-002');
    insertTask(idx, 'TEST-003');
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a reference and retrieves it from the source task', () => {
    repo.addReference('TEST-001', 'TEST-002', 'closes');
    const refs = repo.getReferencesFrom('TEST-001');
    expect(refs).toHaveLength(1);
    expect(refs[0]!.type).toBe('closes');
    expect(refs[0]!.id).toBe('TEST-002');
  });

  it('retrieves references pointing TO a task', () => {
    repo.addReference('TEST-001', 'TEST-002', 'blocks');
    const incoming = repo.getReferencesTo('TEST-002');
    expect(incoming).toHaveLength(1);
    expect(incoming[0]!.from_id).toBe('TEST-001');
    expect(incoming[0]!.ref_type).toBe('blocks');
  });

  it('removes all references from a task', () => {
    repo.addReference('TEST-001', 'TEST-002', 'related');
    repo.addReference('TEST-001', 'TEST-003', 'related');
    repo.removeReferencesFor('TEST-001');
    expect(repo.getReferencesFrom('TEST-001')).toHaveLength(0);
  });

  it('rejects self-reference', () => {
    expect(() => repo.addReference('TEST-001', 'TEST-001', 'related')).toThrow('cannot reference itself');
  });

  it('detects direct circular reference A→B→A', () => {
    repo.addReference('TEST-001', 'TEST-002', 'blocks');
    // detectCircular(TEST-002, TEST-001) should return true since TEST-001→TEST-002 exists
    expect(repo.detectCircular('TEST-002', 'TEST-001')).toBe(true);
    // Adding TEST-002→TEST-001 should throw
    expect(() => repo.addReference('TEST-002', 'TEST-001', 'blocks')).toThrow('cycle');
  });
});
