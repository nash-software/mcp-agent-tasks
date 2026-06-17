/**
 * Unit tests for POST /api/advisor/session/close
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle, resetClaudeBinaryCache } from '../../src/server-ui.js';

function makeTempEnv(): { tempDir: string; configPath: string; dbPath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-session-test-'));
  const tasksDir = path.join(tempDir, 'agent-tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  const genDbDir = path.join(os.homedir(), '.mcp-tasks', 'tasks', 'gen');
  fs.mkdirSync(genDbDir, { recursive: true });

  const configPath = path.join(tempDir, 'config.json');
  const dbPath = path.join(tempDir, 'test.db');

  fs.writeFileSync(
    configPath,
    JSON.stringify({
      version: 1,
      storageDir: tasksDir,
      defaultStorage: 'local',
      enforcement: 'off',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      tasksDirName: 'agent-tasks',
      projects: [{ prefix: 'TEST', path: tempDir }],
    }),
    'utf-8',
  );

  return { tempDir, configPath, dbPath };
}

describe('POST /api/advisor/session/close', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;
  let savedDisabled: string | undefined;
  let tempDir: string;

  beforeAll(async () => {
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    savedDisabled = process.env['CLAUDE_CLI_DISABLED'];

    // Disable LLM calls so reflection doesn't spawn a real claude process
    process.env['CLAUDE_CLI_DISABLED'] = '1';
    resetClaudeBinaryCache();

    const env = makeTempEnv();
    tempDir = env.tempDir;
    process.env['MCP_TASKS_CONFIG'] = env.configPath;
    process.env['MCP_TASKS_DB'] = env.dbPath;

    const result = await startUiServer({ port: 0 });
    handle = result;
    baseUrl = result.url;
  });

  afterAll(async () => {
    await handle.close();
    if (savedConfig !== undefined) process.env['MCP_TASKS_CONFIG'] = savedConfig;
    else delete process.env['MCP_TASKS_CONFIG'];
    if (savedDb !== undefined) process.env['MCP_TASKS_DB'] = savedDb;
    else delete process.env['MCP_TASKS_DB'];
    if (savedDisabled !== undefined) process.env['CLAUDE_CLI_DISABLED'] = savedDisabled;
    else delete process.env['CLAUDE_CLI_DISABLED'];
    resetClaudeBinaryCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists session to JSONL and returns 200 {ok:true}', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/session/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: 'test-session-001',
        mode: 'pm',
        started_at: new Date().toISOString(),
        messages: [
          { role: 'user', content: 'Hello advisor' },
          { role: 'assistant', content: 'Hello! How can I help?' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; skipped?: boolean };
    expect(data.ok).toBe(true);
    expect(data.skipped).toBeUndefined();
  });

  it('returns 400 when session_id is missing', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/session/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'pm',
        messages: [],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when mode is invalid', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/session/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: 'test-session-002',
        mode: 'invalid-mode',
        messages: [],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns {ok:true, skipped:true} for duplicate session_id', async () => {
    const sessionId = 'test-session-idempotent';
    const payload = {
      session_id: sessionId,
      mode: 'coach',
      started_at: new Date().toISOString(),
      messages: [{ role: 'user', content: 'Hello' }],
    };

    // First call
    const res1 = await fetch(`${baseUrl}/api/advisor/session/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(200);
    const data1 = await res1.json() as { ok: boolean; skipped?: boolean };
    expect(data1.ok).toBe(true);
    expect(data1.skipped).toBeUndefined();

    // Second call — same session_id
    const res2 = await fetch(`${baseUrl}/api/advisor/session/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res2.status).toBe(200);
    const data2 = await res2.json() as { ok: boolean; skipped?: boolean };
    expect(data2.ok).toBe(true);
    expect(data2.skipped).toBe(true);
  });
});
