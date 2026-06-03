/**
 * Unit tests for Phase 2 note capture endpoints:
 * - POST /api/capture/infer  — classifies text intent (fail-safe on LLM error)
 * - POST /api/capture/note   — creates a note record
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

function makeTempEnv(): { tempDir: string; configPath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-capture-test-'));
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
    projects: [{ prefix: 'GEN', path: tempDir, storage: 'local' }],
  }), 'utf-8');

  return { tempDir, configPath };
}

// ── /api/capture/infer ──────────────────────────────────────────────────────

describe('POST /api/capture/infer', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;
  let savedClaudeDisabled: string | undefined;

  beforeAll(async () => {
    const env = makeTempEnv();
    tempDir = env.tempDir;
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    savedClaudeDisabled = process.env['CLAUDE_CLI_DISABLED'];
    // Force the claude-unavailable path so the test is deterministic and fast whether or not
    // the claude CLI is installed on the host (otherwise infer actually spawns claude).
    process.env['CLAUDE_CLI_DISABLED'] = '1';
    process.env['MCP_TASKS_CONFIG'] = env.configPath;
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
    if (savedClaudeDisabled === undefined) delete process.env['CLAUDE_CLI_DISABLED'];
    else process.env['CLAUDE_CLI_DISABLED'] = savedClaudeDisabled;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 400 when text is empty', async () => {
    const res = await fetch(`${baseUrl}/api/capture/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('EMPTY_TEXT');
  });

  it('returns 400 when text exceeds 2000 characters', async () => {
    const res = await fetch(`${baseUrl}/api/capture/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(2001) }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('TEXT_TOO_LONG');
  });

  it('returns fail-safe { intent: task, confidence: 0 } when LLM is unavailable', async () => {
    // CLAUDE_CLI_DISABLED=1 (set in beforeAll) forces the unavailable path deterministically.
    const res = await fetch(`${baseUrl}/api/capture/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Classify this text for testing' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { intent: string; confidence: number };
    expect(data.intent).toBe('task');
    expect(data.confidence).toBe(0);
  });
});

// ── /api/capture/note ───────────────────────────────────────────────────────

describe('POST /api/capture/note', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;

  beforeAll(async () => {
    const env = makeTempEnv();
    tempDir = env.tempDir;
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    process.env['MCP_TASKS_CONFIG'] = env.configPath;
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
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 400 when text is empty', async () => {
    const res = await fetch(`${baseUrl}/api/capture/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('EMPTY_TEXT');
  });

  it('returns 400 when text exceeds 10 000 characters', async () => {
    const res = await fetch(`${baseUrl}/api/capture/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(10_001) }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('TEXT_TOO_LONG');
  });

  it('creates a note and returns { noteId, project }', async () => {
    const res = await fetch(`${baseUrl}/api/capture/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'This is a strategic thought about the project.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { noteId: string; project: string };
    expect(typeof data.noteId).toBe('string');
    expect(data.noteId).toMatch(/-N-\d{3}$/);
    expect(typeof data.project).toBe('string');
  });

  it('rejects unknown project prefix silently (falls back to default)', async () => {
    const res = await fetch(`${baseUrl}/api/capture/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Note with unknown project', project: 'NOTEXIST' }),
    });
    // Unknown prefix is sanitized server-side — falls back to default project
    expect(res.status).toBe(200);
    const data = await res.json() as { noteId: string; project: string };
    expect(typeof data.noteId).toBe('string');
  });
});
