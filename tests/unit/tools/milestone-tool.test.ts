/**
 * Unit tests for task_milestone MCP tool
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../../../src/store/sqlite-index.js';
import { MilestoneRepository } from '../../../src/store/milestone-repository.js';
import type { ToolContext } from '../../../src/tools/context.js';

function makeCtx(idx: SqliteIndex): ToolContext {
  return {
    store: {} as ToolContext['store'],
    index: idx,
    sessionId: 'test-session',
    config: {
      version: 1,
      storageDir: '/tmp/mcp-tasks',
      defaultStorage: 'global',
      enforcement: 'warn',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: true,
      tasksDirName: 'agent-tasks',
      projects: [],
    },
    milestones: new MilestoneRepository(idx.getRawDb()),
  };
}

describe('task_milestone tool', async () => {
  const mod = await import('../../../src/tools/task-milestone.js');

  let tmpDir: string;
  let idx: SqliteIndex;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-milestone-tool-'));
    const dbPath = path.join(tmpDir, 'tasks.db');
    idx = new SqliteIndex(dbPath);
    idx.init();
    ctx = makeCtx(idx);
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('create → list (1 row)', async () => {
    const createInput = {
      action: 'create' as const,
      project: 'TEST',
      id: 'v1.0',
      title: 'Version 1.0',
      description: 'First release',
    };
    mod.validate(createInput);
    const result = await mod.execute(createInput, ctx);
    const created = JSON.parse(result.content[0].text) as { id: string; title: string; status: string };
    expect(created.id).toBe('v1.0');
    expect(created.title).toBe('Version 1.0');
    expect(created.status).toBe('open');

    // list returns 1 row
    const listInput = { action: 'list' as const, project: 'TEST' };
    mod.validate(listInput);
    const listResult = await mod.execute(listInput, ctx);
    const listed = JSON.parse(listResult.content[0].text) as unknown[];
    expect(listed).toHaveLength(1);
  });

  it('close sets status=closed', async () => {
    // create first
    await mod.execute({ action: 'create', project: 'TEST', id: 'v2.0', title: 'Version 2.0' }, ctx);

    const closeInput = { action: 'close' as const, project: 'TEST', id: 'v2.0' };
    mod.validate(closeInput);
    const result = await mod.execute(closeInput, ctx);
    const closed = JSON.parse(result.content[0].text) as { status: string };
    expect(closed.status).toBe('closed');
  });

  it('get returns closed milestone after close', async () => {
    await mod.execute({ action: 'create', project: 'TEST', id: 'v3.0', title: 'Version 3.0' }, ctx);
    await mod.execute({ action: 'close', project: 'TEST', id: 'v3.0' }, ctx);

    const getInput = { action: 'get' as const, project: 'TEST', id: 'v3.0' };
    mod.validate(getInput);
    const result = await mod.execute(getInput, ctx);
    const fetched = JSON.parse(result.content[0].text) as { status: string; id: string };
    expect(fetched.status).toBe('closed');
    expect(fetched.id).toBe('v3.0');
  });

  it('delete removes milestone', async () => {
    await mod.execute({ action: 'create', project: 'TEST', id: 'v4.0', title: 'Version 4.0' }, ctx);
    const delResult = await mod.execute({ action: 'delete', project: 'TEST', id: 'v4.0' }, ctx);
    const deleted = JSON.parse(delResult.content[0].text) as { deleted: boolean };
    expect(deleted.deleted).toBe(true);

    // confirm gone
    const listResult = await mod.execute({ action: 'list', project: 'TEST' }, ctx);
    const listed = JSON.parse(listResult.content[0].text) as unknown[];
    expect(listed).toHaveLength(0);
  });
});
