import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

describe('serve-ui HTML dashboard', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-serve-html-'));
    const dbPath = path.join(tempDir, 'tasks.db');
    originalEnv = process.env['MCP_TASKS_DB'];
    process.env['MCP_TASKS_DB'] = dbPath;

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    if (originalEnv === undefined) {
      delete process.env['MCP_TASKS_DB'];
    } else {
      process.env['MCP_TASKS_DB'] = originalEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET / returns HTML containing data-kanban', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const text = await res.text();
    expect(text).toContain('data-kanban');
  });

  it('GET / contains data-view="roadmap"', async () => {
    const res = await fetch(`${baseUrl}/`);
    const text = await res.text();
    expect(text).toContain('data-view="roadmap"');
  });

  it('GET / contains data-view="activity"', async () => {
    const res = await fetch(`${baseUrl}/`);
    const text = await res.text();
    expect(text).toContain('data-view="activity"');
  });
});
