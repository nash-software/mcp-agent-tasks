import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

describe('Voice capture endpoints', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-voice-'));
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
      projects: [{ prefix: 'VCT', path: tempDir, storage: 'local' }],
    }), 'utf-8');

    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    process.env['MCP_TASKS_CONFIG'] = configPath;
    delete process.env['MCP_TASKS_DB'];

    const { SqliteIndex } = await import('../../src/store/sqlite-index.js');
    const dbPath = path.join(tasksDir, '.index.db');
    const idx = new SqliteIndex(dbPath);
    idx.init();
    idx.ensureProject('VCT');
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

  it('POST /api/tasks creates a draft task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Voice captured task', project: 'VCT' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as { id: string; title: string; status: string };
    expect(data.id).toMatch(/^VCT-\d+$/);
    expect(data.title).toBe('Voice captured task');
    expect(data.status).toBe('draft');
  });

  it('POST /api/tasks with body field stores body text', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Task with body', project: 'VCT', body: 'Transcribed voice note' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as { id: string };
    expect(data.id).toMatch(/^VCT-\d+$/);
  });

  it('POST /api/tasks with missing title returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'VCT' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('MISSING_FIELDS');
  });

  it('POST /api/tasks with unknown project returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test', project: 'NOPE' }),
    });
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('PROJECT_NOT_FOUND');
  });
});
