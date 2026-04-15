import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

describe('serve-ui HTTP server', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let originalEnv: string | undefined;

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

    // Override DB path to use a temp db
    const dbPath = path.join(tempDir, 'tasks.db');
    originalEnv = process.env['MCP_TASKS_DB'];
    process.env['MCP_TASKS_DB'] = dbPath;

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    // Restore env
    if (originalEnv === undefined) {
      delete process.env['MCP_TASKS_DB'];
    } else {
      process.env['MCP_TASKS_DB'] = originalEnv;
    }
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

  it('GET unknown route returns 404 JSON error', async () => {
    const res = await fetch(`${baseUrl}/api/unknown-endpoint`);
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(typeof data.error).toBe('string');
  });

  it('close() resolves without hanging', async () => {
    // Already covered by afterAll, but test close explicitly on a separate server
    const h = await startUiServer({ port: 0 });
    await expect(h.close()).resolves.toBeUndefined();
  });
});
