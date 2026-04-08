/**
 * Full end-to-end lifecycle test using real FS, SqliteIndex, MarkdownStore, and TaskStore.
 * Tests the complete flow: create → claim → link-commit → link-pr (merged) → get (done) → archive
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskStore } from '../../src/store/task-store.js';
import { MarkdownStore } from '../../src/store/markdown-store.js';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { ManifestWriter } from '../../src/store/manifest-writer.js';
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
    projects: [],
  };
}

describe('Task lifecycle: create → claim → link-commit → link-pr (merged) → done → archive', () => {
  let tmpDir: string;
  let tasksDir: string;
  let idx: SqliteIndex;
  let store: TaskStore;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lifecycle-test-'));
    tasksDir = path.join(tmpDir, 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });

    const dbPath = path.join(tmpDir, 'tasks.db');
    idx = new SqliteIndex(dbPath);
    idx.init();

    const markdownStore = new MarkdownStore();
    const manifestWriter = new ManifestWriter();
    store = new TaskStore(markdownStore, idx, manifestWriter, tasksDir, 'TEST');

    ctx = {
      store,
      index: idx,
      sessionId: 'session-A',
      config: makeConfig(tmpDir),
    };
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a task with status=todo', async () => {
    const { execute: createExecute, validate: createValidate } = await import('../../src/tools/task-create.js');

    const input = { project: 'TEST', title: 'My feature', type: 'feature' as const, priority: 'high' as const, why: 'Because reasons' };
    createValidate(input);
    const result = await createExecute(input, ctx);
    const task = JSON.parse(result.content[0].text) as Task;

    expect(task.id).toBe('TEST-001');
    expect(task.status).toBe('todo');
    // Verify it's actually in the index
    expect(idx.getTask('TEST-001')).not.toBeNull();
  });

  it('full lifecycle: create → claim → link-commit → link-pr[merged] → verify done → archive', async () => {
    const { execute: createExecute } = await import('../../src/tools/task-create.js');
    const { execute: claimExecute } = await import('../../src/tools/task-claim.js');
    const { execute: linkCommitExecute } = await import('../../src/tools/task-link-commit.js');
    const { execute: linkPrExecute } = await import('../../src/tools/task-link-pr.js');
    const { execute: getExecute } = await import('../../src/tools/task-get.js');
    const { execute: deleteExecute } = await import('../../src/tools/task-delete.js');

    // Step 1: Create
    const createResult = await createExecute(
      { project: 'TEST', title: 'Feature', type: 'feature', priority: 'medium', why: 'Testing' },
      ctx,
    );
    const created = JSON.parse(createResult.content[0].text) as Task;
    expect(created.status).toBe('todo');

    // Step 2: Claim
    // Need to transition to in_progress first before claim makes logical sense
    // Actually claim works on any status — let's just claim it
    const claimResult = await claimExecute({ id: created.id }, ctx);
    const claimData = JSON.parse(claimResult.content[0].text) as { claimed: boolean; task: Task };
    expect(claimData.claimed).toBe(true);
    expect(claimData.task.claimed_by).toBe('session-A');

    // Step 3: Link a commit
    const commitResult = await linkCommitExecute(
      { id: created.id, sha: 'deadbeef', message: 'feat: implement feature' },
      ctx,
    );
    const afterCommit = JSON.parse(commitResult.content[0].text) as Task;
    expect(afterCommit.git.commits).toHaveLength(1);
    expect(afterCommit.git.commits[0].sha).toBe('deadbeef');

    // Step 4: Link a merged PR — should auto-transition to done
    // First we need to transition to in_progress (to allow todo → in_progress → done)
    store.transitionTask(created.id, 'in_progress');

    const prResult = await linkPrExecute(
      { id: created.id, pr_number: 42, pr_url: 'https://github.com/org/repo/pull/42', pr_state: 'merged' },
      ctx,
    );
    const afterPr = JSON.parse(prResult.content[0].text) as Task;
    expect(afterPr.status).toBe('done');
    expect(afterPr.git.pr?.number).toBe(42);

    // Step 5: Verify via task-get
    const getResult = await getExecute({ id: created.id }, ctx);
    const fetched = JSON.parse(getResult.content[0].text) as Task;
    expect(fetched.status).toBe('done');

    // Step 6: Archive (soft-delete)
    const deleteResult = await deleteExecute({ id: created.id }, ctx);
    const archived = JSON.parse(deleteResult.content[0].text) as { archived: boolean; id: string };
    expect(archived.archived).toBe(true);

    // Step 7: Verify archived in index
    const inIndex = idx.getTask(created.id);
    expect(inIndex?.status).toBe('archived');
  });
});
