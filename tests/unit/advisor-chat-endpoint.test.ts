/**
 * Unit tests for POST /api/advisor/chat and src/lib/claude-stream.ts
 *
 * Test strategy:
 *  1. Set CLAUDE_CLI_DISABLED=1 (so resolveClaudeBinary returns a nonexistent path)
 *     → spawn fails with ENOENT → endpoint returns SSE error frame
 *  2. Happy-path: inject a fake claudeBin via CLAUDE_CLI_PATH that points to a
 *     tiny shell script emitting stream-json lines, so we can verify SSE output.
 *  3. 400 on missing/invalid messages array.
 *
 * All tests gate the real spawn behind the existing CLAUDE_CLI_DISABLED env hook
 * so no live claude.exe is required.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle, resetClaudeBinaryCache } from '../../src/server-ui.js';

// ─── helpers ──────────────────────────────────────────────────────────────

function makeTempEnv(): { tempDir: string; configPath: string; dbPath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-chat-test-'));
  const tasksDir = path.join(tempDir, 'agent-tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  // Ensure GEN global dir exists
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

/** Parse SSE stream text into { event, data } frames. */
function parseSseFrames(text: string): Array<{ event: string; data: string }> {
  const frames: Array<{ event: string; data: string }> = [];
  const blocks = text.split('\n\n').filter(b => b.trim());
  for (const block of blocks) {
    let event = '';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data:')) data = line.slice(5).trim();
    }
    if (event) frames.push({ event, data });
  }
  return frames;
}

// ─── ENOENT path (CLAUDE_CLI_DISABLED=1) ──────────────────────────────────

describe('POST /api/advisor/chat — ENOENT path (CLAUDE_CLI_DISABLED=1)', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;
  let savedDisabled: string | undefined;

  beforeAll(async () => {
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    savedDisabled = process.env['CLAUDE_CLI_DISABLED'];

    process.env['CLAUDE_CLI_DISABLED'] = '1';
    resetClaudeBinaryCache();

    const env = makeTempEnv();
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
  });

  it('returns Content-Type: text/event-stream', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await res.text(); // consume body
  });

  it('emits an error SSE frame on ENOENT', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'what should I do' }] }),
    });
    const text = await res.text();
    const frames = parseSseFrames(text);
    const errFrame = frames.find(f => f.event === 'error');
    expect(errFrame).toBeDefined();
  });

  it('400 on missing messages field', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'abc' }),
    });
    expect(res.status).toBe(400);
  });

  it('400 on messages not being an array', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: 'not-an-array' }),
    });
    expect(res.status).toBe(400);
  });

  it('400 on message item missing role', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ content: 'hello' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('400 on message item missing content', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('400 on a sessionId that could inject a CLI flag', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        sessionId: '--output-format',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('400 on more than 50 messages', async () => {
    const many = Array.from({ length: 51 }, () => ({ role: 'user', content: 'x' }));
    const res = await fetch(`${baseUrl}/api/advisor/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: many }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── Happy-path: fake binary emitting stream-json ─────────────────────────

describe('POST /api/advisor/chat — happy path (fake claude binary)', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;
  let savedCliPath: string | undefined;
  let savedDisabled: string | undefined;
  let tempDir: string;

  beforeAll(async () => {
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    savedCliPath = process.env['CLAUDE_CLI_PATH'];
    savedDisabled = process.env['CLAUDE_CLI_DISABLED'];

    // Clear disable flag so our fake binary gets used
    delete process.env['CLAUDE_CLI_DISABLED'];

    const env = makeTempEnv();
    tempDir = env.tempDir;

    // Write a fake claude binary that emits valid stream-json lines
    // The server reads these via spawnClaudeStream; we emit:
    //   content_block_delta → delta frame
    //   result with session_id → session frame
    // Real CLI shape (MCPAT-074): text deltas arrive inside a stream_event envelope,
    // and the session id is on the top-level result event. The old fixture used a
    // bare top-level content_block_delta — a shape the CLI never emits — which is
    // why this happy-path test passed while the live endpoint streamed nothing.
    const fakeOutput = [
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hello world' } } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'hello world', session_id: 'sess-abc-123' }),
    ].join('\n') + '\n';

    const fakeBinPath = process.platform === 'win32'
      ? path.join(tempDir, 'fake-claude.cmd')
      : path.join(tempDir, 'fake-claude');

    if (process.platform === 'win32') {
      // On Windows write a .cmd that prints the output — but the server uses shell:false
      // so .cmd won't be spawned directly. Instead write a .exe.
      // Since we can't easily create a native .exe, we write a node script and point
      // CLAUDE_CLI_PATH at a JS script. We create a tiny wrapper .js and then a fake .exe
      // shim. Actually the simplest approach: write a .js file and set CLAUDE_CLI_PATH
      // to 'node' — but spawnClaudeStream spawns the bin with args ['-p', ...].
      // Cleanest: write a tiny .exe shim using node. Use a .cmd as a side-channel won't work.
      // Use PowerShell to generate a small exe from a node launcher is not feasible.
      // Best: create a fake-claude.js and set CLAUDE_CLI_PATH to the node interpreter
      // path — but then the spawn args would be ['-p', ...] which node ignores.
      //
      // Simplest viable approach on Windows: write a .cmd whose first line is @echo off
      // so even if shell:false can't run it, we skip this happy-path test on Windows
      // and mark it as pending. The ENOENT tests above cover the error path.
      // Mark test as skip on Windows via an env var the test body checks.
      process.env['SKIP_FAKE_BIN_TEST'] = '1';
    } else {
      const script = `#!/bin/sh\necho '${fakeOutput.replace(/'/g, "'\\''")}'\n`;
      fs.writeFileSync(fakeBinPath, script, { mode: 0o755 });
      process.env['CLAUDE_CLI_PATH'] = fakeBinPath;
      delete process.env['SKIP_FAKE_BIN_TEST'];
    }

    resetClaudeBinaryCache();

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
    if (savedCliPath !== undefined) process.env['CLAUDE_CLI_PATH'] = savedCliPath;
    else delete process.env['CLAUDE_CLI_PATH'];
    if (savedDisabled !== undefined) process.env['CLAUDE_CLI_DISABLED'] = savedDisabled;
    else delete process.env['CLAUDE_CLI_DISABLED'];
    delete process.env['SKIP_FAKE_BIN_TEST'];
    resetClaudeBinaryCache();
  });

  it('returns SSE with delta + session + done frames (non-Windows only)', async () => {
    if (process.env['SKIP_FAKE_BIN_TEST'] === '1') {
      // Windows: skip fake-binary happy path; covered by ENOENT tests above
      return;
    }
    const res = await fetch(`${baseUrl}/api/advisor/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    const frames = parseSseFrames(text);
    const deltaFrame = frames.find(f => f.event === 'delta');
    const sessionFrame = frames.find(f => f.event === 'session');
    const doneFrame = frames.find(f => f.event === 'done');
    expect(deltaFrame).toBeDefined();
    expect(sessionFrame).toBeDefined();
    expect(doneFrame).toBeDefined();
    if (deltaFrame) {
      const data = JSON.parse(deltaFrame.data) as { text: string };
      expect(data.text).toBe('hello world');
    }
    if (sessionFrame) {
      const data = JSON.parse(sessionFrame.data) as { sessionId: string };
      expect(data.sessionId).toBe('sess-abc-123');
    }
  });
});
