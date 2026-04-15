import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';
import { MilestoneRepository } from '../../../src/store/milestone-repository.js';
import type { Milestone } from '../../../src/types/task.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-milestone-test-'));
}

function makeIndex(tmpDir: string): SqliteIndex {
  const dbPath = path.join(tmpDir, 'tasks.db');
  const idx = new SqliteIndex(dbPath);
  idx.init();
  return idx;
}

function makeMilestone(overrides: Partial<Milestone & { project: string }> = {}): Milestone & { project: string } {
  return {
    id: 'v2.0',
    project: 'TEST',
    title: 'v2.0 Release',
    status: 'open',
    created: new Date().toISOString(),
    ...overrides,
  };
}

describe('MilestoneRepository', () => {
  let tmpDir: string;
  let idx: SqliteIndex;
  let repo: MilestoneRepository;

  beforeEach(() => {
    tmpDir = makeTempDir();
    idx = makeIndex(tmpDir);
    repo = new MilestoneRepository(idx.getRawDb());
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a milestone and lists it', () => {
    repo.createMilestone(makeMilestone());
    const list = repo.listMilestones('TEST');
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('v2.0');
    expect(list[0]!.title).toBe('v2.0 Release');
  });

  it('gets a specific milestone by id+project', () => {
    repo.createMilestone(makeMilestone({ id: 'v1.0', title: 'v1.0 Release' }));
    repo.createMilestone(makeMilestone({ id: 'v2.0', title: 'v2.0 Release' }));

    const m = repo.getMilestone('v1.0', 'TEST');
    expect(m).not.toBeNull();
    expect(m!.title).toBe('v1.0 Release');

    expect(repo.getMilestone('nonexistent', 'TEST')).toBeNull();
  });

  it('updates a milestone title and due_date', () => {
    repo.createMilestone(makeMilestone());
    repo.updateMilestone('v2.0', 'TEST', { title: 'v2.0 Final', due_date: '2026-06-01' });

    const m = repo.getMilestone('v2.0', 'TEST');
    expect(m!.title).toBe('v2.0 Final');
    expect(m!.due_date).toBe('2026-06-01');
  });

  it('closes a milestone — sets status=closed', () => {
    repo.createMilestone(makeMilestone());
    repo.closeMilestone('v2.0', 'TEST');

    const m = repo.getMilestone('v2.0', 'TEST');
    expect(m!.status).toBe('closed');
  });

  it('deletes a milestone', () => {
    repo.createMilestone(makeMilestone());
    repo.deleteMilestone('v2.0', 'TEST');

    const list = repo.listMilestones('TEST');
    expect(list).toHaveLength(0);
  });

  it('detects orphaned milestones — tasks referencing nonexistent milestone', () => {
    // Insert a project row and a task with milestone='ghost'
    idx.ensureProject('TEST');
    const now = new Date().toISOString();
    idx.getRawDb().prepare(`
      INSERT INTO tasks (id, title, type, status, priority, project, created, updated, last_activity, file_path, schema_version, milestone)
      VALUES ('TEST-001', 'test', 'feature', 'todo', 'medium', 'TEST', ?, ?, ?, '/tmp/t.md', 1, 'ghost')
    `).run(now, now, now);

    const orphaned = repo.getOrphanedMilestoneIds('TEST');
    expect(orphaned).toContain('ghost');
  });
});
