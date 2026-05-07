import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

describe('serve-ui HTTP server', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedDb: string | undefined;
  let savedConfig: string | undefined;

  beforeAll(async () => {
    // Set up a temp tasks dir and config so the server has something to work with
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-serve-ui-'));
    const tasksDir = path.join(tempDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

    // Write a minimal config so loadConfig() returns a valid project list
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      storageDir: tasksDir,
      defaultStorage: 'local',
      enforcement: 'off',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      tasksDirName: 'agent-tasks',
      projects: [],
    }), 'utf-8');

    savedDb = process.env['MCP_TASKS_DB'];
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    process.env['MCP_TASKS_CONFIG'] = configPath;
    process.env['MCP_TASKS_DB'] = path.join(tempDir, 'tasks.db');

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    if (savedDb === undefined) delete process.env['MCP_TASKS_DB'];
    else process.env['MCP_TASKS_DB'] = savedDb;
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG'];
    else process.env['MCP_TASKS_CONFIG'] = savedConfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET /api/tasks returns JSON array', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/milestones returns JSON array', async () => {
    const res = await fetch(`${baseUrl}/api/milestones`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/activity returns JSON array with <=50 items', async () => {
    const res = await fetch(`${baseUrl}/api/activity`);
    expect(res.status).toBe(200);
    const data = await res.json() as unknown[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(50);
  });

  it('GET /api/stats returns JSON array', async () => {
    const res = await fetch(`${baseUrl}/api/stats`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('GET /api/tasks?auto_captured=true filters to captured tasks only', async () => {
    const res = await fetch(`${baseUrl}/api/tasks?auto_captured=true`);
    expect(res.status).toBe(200);
    const data = await res.json() as { auto_captured?: boolean }[];
    expect(Array.isArray(data)).toBe(true);
    for (const task of data) {
      expect(task.auto_captured).toBe(true);
    }
  });

  it('POST /api/tasks/:id/promote returns 404 with TASK_NOT_FOUND for missing task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/FAKE-999/promote`, { method: 'POST' });
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('TASK_NOT_FOUND');
  });

  it('GET unknown route returns 404 JSON error', async () => {
    const res = await fetch(`${baseUrl}/api/unknown-endpoint`);
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(typeof data.error).toBe('string');
  });

  it('POST /api/milestones creates a milestone', async () => {
    const res = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'M-test-1', title: 'Test Milestone', project: 'default' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as { id: string; title: string };
    expect(data.id).toBe('M-test-1');
    expect(data.title).toBe('Test Milestone');
  });

  it('close() resolves without hanging', async () => {
    // Already covered by afterAll, but test close explicitly on a separate server
    const h = await startUiServer({ port: 0 });
    await expect(h.close()).resolves.toBeUndefined();
  });
});

describe('serve-ui promote endpoint', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-promote-'));
    const tasksDir = path.join(tempDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      storageDir: tasksDir,
      defaultStorage: 'local',
      enforcement: 'off',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      tasksDirName: 'agent-tasks',
      projects: [{ prefix: 'TST', path: tempDir, storage: 'local' }],
    }), 'utf-8');

    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    process.env['MCP_TASKS_CONFIG'] = configPath;
    delete process.env['MCP_TASKS_DB'];

    // Seed a draft task via SqliteIndex
    const { SqliteIndex } = await import('../../src/store/sqlite-index.js');
    const dbPath = path.join(tasksDir, '.index.db');
    const idx = new SqliteIndex(dbPath);
    idx.init();
    idx.ensureProject('TST');
    idx.upsertTask({
      schema_version: 1, id: 'TST-001', title: 'Draft task', type: 'plan',
      status: 'draft', priority: 'medium', project: 'TST', tags: [], complexity: 1,
      complexity_manual: false, why: 'test', created: new Date().toISOString(),
      updated: new Date().toISOString(), last_activity: new Date().toISOString(),
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
      children: [], dependencies: [], subtasks: [], git: { commits: [] },
      transitions: [], files: [], body: '', file_path: 'TST-001.md',
      auto_captured: true,
    });
    idx.close();

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG'];
    else process.env['MCP_TASKS_CONFIG'] = savedConfig;
    if (savedDb === undefined) delete process.env['MCP_TASKS_DB'];
    else process.env['MCP_TASKS_DB'] = savedDb;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('POST /api/tasks/TST-001/promote transitions draft to todo', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TST-001/promote`, { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json() as { id: string; status: string };
    expect(data.id).toBe('TST-001');
    expect(data.status).toBe('todo');
  });
});
