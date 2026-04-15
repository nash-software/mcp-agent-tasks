/**
 * Tests for milestone burndown in task_stats output
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';
import { MilestoneRepository } from '../../../src/store/milestone-repository.js';
import { MarkdownStore } from '../../../src/store/markdown-store.js';
import { ManifestWriter } from '../../../src/store/manifest-writer.js';
import { TaskStore } from '../../../src/store/task-store.js';
import type { TaskStatsOutput } from '../../../src/types/tools.js';

describe('task_stats milestone burndown', () => {
  let tmpDir: string;
  let tasksDir: string;
  let idx: SqliteIndex;
  let store: TaskStore;
  let milestoneRepo: MilestoneRepository;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stats-milestone-'));
    tasksDir = path.join(tmpDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

    const dbPath = path.join(tmpDir, 'tasks.db');
    idx = new SqliteIndex(dbPath);
    idx.init();

    const markdownStore = new MarkdownStore();
    const manifestWriter = new ManifestWriter();
    store = new TaskStore(markdownStore, idx, manifestWriter, tasksDir, 'TEST');
    milestoneRepo = new MilestoneRepository(idx.getRawDb());

    // Create a real milestone v2.0
    milestoneRepo.createMilestone({
      id: 'v2.0',
      project: 'TEST',
      title: 'Version 2.0',
      status: 'open',
      created: new Date().toISOString(),
    });

    // 3 tasks in milestone v2.0: 2 done, 1 in_progress
    const t1 = store.createTask({ project: 'TEST', title: 'T1', type: 'feature', priority: 'medium', why: 'x', milestone: 'v2.0' });
    store.transitionTask(t1.id, 'in_progress');
    store.transitionTask(t1.id, 'done');

    const t2 = store.createTask({ project: 'TEST', title: 'T2', type: 'feature', priority: 'medium', why: 'x', milestone: 'v2.0' });
    store.transitionTask(t2.id, 'in_progress');
    store.transitionTask(t2.id, 'done');

    store.createTask({ project: 'TEST', title: 'T3', type: 'feature', priority: 'medium', why: 'x', milestone: 'v2.0' });

    // 1 task in milestone 'ghost' which has no milestones row
    store.createTask({ project: 'TEST', title: 'T4', type: 'feature', priority: 'medium', why: 'x', milestone: 'ghost' });
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('milestones[0].done === 2 for v2.0', () => {
    const stats = idx.getStats('TEST') as TaskStatsOutput;
    expect(stats.milestones).toBeDefined();
    const v2 = stats.milestones!.find(m => m.id === 'v2.0');
    expect(v2).toBeDefined();
    expect(v2!.done).toBe(2);
    expect(v2!.total).toBe(3);
  });

  it('orphaned_milestones includes ghost', () => {
    const stats = idx.getStats('TEST') as TaskStatsOutput;
    expect(stats.orphaned_milestones).toBeDefined();
    expect(stats.orphaned_milestones).toContain('ghost');
  });
});
