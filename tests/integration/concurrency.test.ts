/**
 * Concurrency tests: claim conflicts between sessions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskStore } from '../../src/store/task-store.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { ManifestWriter } from '../../src/store/manifest-writer.js';
import { MilestoneRepository } from '../../src/store/milestone-repository.js';
import type { ToolContext } from '../../src/tools/context.js';
import type { McpTasksConfig } from '../../src/config/loader.js';
import type { Task } from '../../src/types/task.js';

function makeConfig(storageDir: string): McpTasksConfig {
  return {
    version: 1,
    storageDir,
    defaultStorage: 'global',
    enforcement: 'warn',
    autoCommit: false,
    claimTtlHours: 4,
    trackManifest: true,
    tasksDirName: 'agent-tasks',
    projects: [],
  };
}

function makeCtx(store: TaskStore, idx: SqliteIndex, sessionId: string, tmpDir: string): ToolContext {
  return {
    store,
    index: idx,
    sessionId,
    config: makeConfig(tmpDir),
    milestones: new MilestoneRepository(idx.getRawDb()),
  };
}

describe('Concurrency: claim conflicts', () => {
  let tmpDir: string;
  let tasksDir: string;
  let idx: SqliteIndex;
  let store: TaskStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-concurrency-test-'));
    tasksDir = path.join(tmpDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });

    const dbPath = path.join(tmpDir, 'tasks.db');
    idx = new SqliteIndex(dbPath);
    idx.init();

    const markdownStore = new MarkdownStore();
    const manifestWriter = new ManifestWriter();
    store = new TaskStore(markdownStore, idx, manifestWriter, tasksDir, 'TEST');
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('second session cannot claim a task already held by first session', async () => {
    const { execute: claimExecute } = await import('../../src/tools/task-claim.js');

    // Create a task
    const task = store.createTask({ project: 'TEST', title: 'Test', type: 'feature', priority: 'medium', why: 'y' });

    // Session A claims it
    const ctxA = makeCtx(store, idx, 'session-A', tmpDir);
    const claimA = await claimExecute({ id: task.id }, ctxA);
    const claimAData = JSON.parse(claimA.content[0].text) as { claimed: boolean; task: Task };
    expect(claimAData.claimed).toBe(true);
    expect(claimAData.task.claimed_by).toBe('session-A');

    // Session B tries to claim the same task
    const ctxB = makeCtx(store, idx, 'session-B', tmpDir);
    const claimB = await claimExecute({ id: task.id }, ctxB);
    const claimBData = JSON.parse(claimB.content[0].text) as { claimed: boolean; task: Task };
    expect(claimBData.claimed).toBe(false);

    // Verify claimed_by is still session-A
    const inIndex = idx.getTask(task.id);
    expect(inIndex?.claimed_by).toBe('session-A');
  });

  it('after session A releases, session B can claim', async () => {
    const { execute: claimExecute } = await import('../../src/tools/task-claim.js');
    const { execute: releaseExecute } = await import('../../src/tools/task-release.js');

    const task = store.createTask({ project: 'TEST', title: 'Test', type: 'feature', priority: 'medium', why: 'y' });

    const ctxA = makeCtx(store, idx, 'session-A', tmpDir);
    const ctxB = makeCtx(store, idx, 'session-B', tmpDir);

    // A claims
    await claimExecute({ id: task.id }, ctxA);

    // A releases
    const releaseResult = await releaseExecute({ id: task.id }, ctxA);
    const releaseData = JSON.parse(releaseResult.content[0].text) as { released: boolean };
    expect(releaseData.released).toBe(true);

    // B now claims successfully
    const claimB = await claimExecute({ id: task.id }, ctxB);
    const claimBData = JSON.parse(claimB.content[0].text) as { claimed: boolean; task: Task };
    expect(claimBData.claimed).toBe(true);
    expect(claimBData.task.claimed_by).toBe('session-B');
  });
});
