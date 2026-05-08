import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

describe('Action button endpoints', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-action-'));
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
      projects: [
        { prefix: 'ACT', path: tempDir, storage: 'local' },
        { prefix: 'SEC', path: '/tmp/second-project', storage: 'local' },
      ],
    }), 'utf-8');

    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    process.env['MCP_TASKS_CONFIG'] = configPath;
    delete process.env['MCP_TASKS_DB'];

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

  it('GET /api/projects returns project list with paths', async () => {
    const res = await fetch(`${baseUrl}/api/projects`);
    expect(res.status).toBe(200);
    const data = await res.json() as { prefix: string; path: string }[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    expect(data[0].prefix).toBe('ACT');
    expect(data[0].path).toBe(tempDir);
    expect(data[1].prefix).toBe('SEC');
  });

  it('GET /api/config returns conductor URLs from env', async () => {
    process.env['CONDUCTOR_LOCAL_URL'] = 'http://localhost:5050';
    process.env['CONDUCTOR_VPS_URL'] = 'https://conductor.example.com';
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const data = await res.json() as { conductorLocalUrl?: string; conductorVpsUrl?: string };
    expect(data.conductorLocalUrl).toBe('http://localhost:5050');
    expect(data.conductorVpsUrl).toBe('https://conductor.example.com');
    delete process.env['CONDUCTOR_LOCAL_URL'];
    delete process.env['CONDUCTOR_VPS_URL'];
  });

  it('GET /api/config hides conductor URLs when not set', async () => {
    delete process.env['CONDUCTOR_LOCAL_URL'];
    delete process.env['CONDUCTOR_VPS_URL'];
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.conductorLocalUrl).toBeUndefined();
    expect(data.conductorVpsUrl).toBeUndefined();
  });
});
