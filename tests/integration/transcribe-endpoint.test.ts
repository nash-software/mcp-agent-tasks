import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

describe('POST /api/transcribe', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;
  let savedGroq: string | undefined;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-transcribe-'));
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
      projects: [],
    }), 'utf-8');

    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    savedGroq = process.env['GROQ_API_KEY'];
    process.env['MCP_TASKS_CONFIG'] = configPath;
    process.env['MCP_TASKS_DB'] = path.join(tempDir, 'tasks.db');

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG'];
    else process.env['MCP_TASKS_CONFIG'] = savedConfig;
    if (savedDb === undefined) delete process.env['MCP_TASKS_DB'];
    else process.env['MCP_TASKS_DB'] = savedDb;
    if (savedGroq === undefined) delete process.env['GROQ_API_KEY'];
    else process.env['GROQ_API_KEY'] = savedGroq;
  });

  it('returns 400 when no audio file is provided', async () => {
    const res = await fetch(`${baseUrl}/api/transcribe`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('NO_AUDIO');
  });

  it('returns 500 when GROQ_API_KEY is not set', async () => {
    delete process.env['GROQ_API_KEY'];
    const form = new FormData();
    form.append('file', new Blob(['fake audio'], { type: 'audio/wav' }), 'test.wav');
    const res = await fetch(`${baseUrl}/api/transcribe`, {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(500);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('GROQ_NOT_CONFIGURED');
  });
});
