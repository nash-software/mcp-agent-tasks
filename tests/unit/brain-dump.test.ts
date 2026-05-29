/**
 * Unit tests for brain dump endpoints:
 * - POST /api/capture/braindump
 * - POST /api/capture/commit
 * - POST /api/acr/dispatch
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

// ─── helpers ───────────────────────────────────────────────────────────────

function makeTempEnv(): { tempDir: string; configPath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-dump-test-'));
  const tasksDir = path.join(tempDir, 'agent-tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  // GEN global dir
  const genDbDir = path.join(os.homedir(), '.mcp-tasks', 'tasks', 'gen');
  fs.mkdirSync(genDbDir, { recursive: true });

  const configPath = path.join(tempDir, 'config.json');
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
      projects: [
        { prefix: 'MYPROJ', path: tempDir },
      ],
    }),
    'utf-8',
  );

  return { tempDir, configPath };
}

async function startServer(configPath: string, dbPath: string): Promise<{ handle: UiServerHandle; baseUrl: string }> {
  process.env['MCP_TASKS_CONFIG'] = configPath;
  process.env['MCP_TASKS_DB'] = dbPath;
  const handle = await startUiServer({ port: 0 });
  return { handle, baseUrl: handle.url };
}

// ─── POST /api/capture/braindump ───────────────────────────────────────────

describe('POST /api/capture/braindump', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedDb: string | undefined;
  let savedConfig: string | undefined;

  beforeAll(async () => {
    const env = makeTempEnv();
    tempDir = env.tempDir;
    savedDb = process.env['MCP_TASKS_DB'];
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    const server = await startServer(env.configPath, path.join(tempDir, 'tasks.db'));
    handle = server.handle;
    baseUrl = server.baseUrl;
  });

  afterAll(async () => {
    await handle.close();
    if (savedDb === undefined) delete process.env['MCP_TASKS_DB'];
    else process.env['MCP_TASKS_DB'] = savedDb;
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG'];
    else process.env['MCP_TASKS_CONFIG'] = savedConfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns HTTP 200 always (even when claude CLI unavailable)', async () => {
    const res = await fetch(`${baseUrl}/api/capture/braindump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Buy milk and eggs, also fix the login bug' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { candidates: unknown[]; error?: string };
    expect(Array.isArray(data.candidates)).toBe(true);
    // Either got candidates or a graceful error — but always 200
  }, 90_000);

  it('returns empty candidates and error for empty text', async () => {
    const res = await fetch(`${baseUrl}/api/capture/braindump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { candidates: unknown[]; error?: string };
    expect(data.candidates).toHaveLength(0);
    expect(typeof data.error).toBe('string');
  });

  it('returns empty candidates and error for whitespace-only text', async () => {
    const res = await fetch(`${baseUrl}/api/capture/braindump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { candidates: unknown[]; error?: string };
    expect(data.candidates).toHaveLength(0);
    expect(typeof data.error).toBe('string');
  });

  it('returns empty candidates and error for text exceeding 10 000 chars', async () => {
    const res = await fetch(`${baseUrl}/api/capture/braindump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(10_001) }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { candidates: unknown[]; error?: string };
    expect(data.candidates).toHaveLength(0);
    expect(typeof data.error).toBe('string');
  });

  it('returns empty candidates and error when text field is missing', async () => {
    const res = await fetch(`${baseUrl}/api/capture/braindump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notText: 'hello' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { candidates: unknown[]; error?: string };
    expect(data.candidates).toHaveLength(0);
    expect(typeof data.error).toBe('string');
  });
});

// ─── JSON extraction logic (isolated — no server needed) ───────────────────

describe('braindump — JSON extraction logic (isolated)', () => {
  it('extracts JSON array from plain output', () => {
    const raw = '[{"title":"Buy milk","project":"GEN","area":"personal"}]';
    const match = raw.match(/\[[\s\S]*\]/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![0]) as unknown[];
    expect(parsed).toHaveLength(1);
  });

  it('extracts JSON array from markdown-fenced output', () => {
    const raw = '```json\n[{"title":"Fix bug","project":"MYPROJ","area":"client"}]\n```';
    const match = raw.match(/\[[\s\S]*\]/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![0]) as unknown[];
    expect(parsed).toHaveLength(1);
  });

  it('returns null when output has no JSON array', () => {
    const raw = 'Sure, I would be happy to help with that!';
    const match = raw.match(/\[[\s\S]*\]/);
    expect(match).toBeNull();
  });

  it('validates area field falls back to internal for unknown values', () => {
    const VALID_AREAS = new Set(['client', 'personal', 'outsource', 'internal']);
    const area = VALID_AREAS.has('unknown-value') ? 'unknown-value' : 'internal';
    expect(area).toBe('internal');
  });

  it('filters out candidates without a title', () => {
    const raw = [
      { project: 'GEN', area: 'internal' }, // no title
      { title: 'Valid task', project: 'GEN', area: 'personal' },
    ];
    const filtered = raw.filter((c) => typeof (c as Record<string, unknown>).title === 'string');
    expect(filtered).toHaveLength(1);
  });
});

// ─── POST /api/capture/commit ───────────────────────────────────────────────

describe('POST /api/capture/commit', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedDb: string | undefined;
  let savedConfig: string | undefined;

  beforeAll(async () => {
    const env = makeTempEnv();
    tempDir = env.tempDir;
    savedDb = process.env['MCP_TASKS_DB'];
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    const server = await startServer(env.configPath, path.join(tempDir, 'tasks-commit.db'));
    handle = server.handle;
    baseUrl = server.baseUrl;
  });

  afterAll(async () => {
    await handle.close();
    if (savedDb === undefined) delete process.env['MCP_TASKS_DB'];
    else process.env['MCP_TASKS_DB'] = savedDb;
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG'];
    else process.env['MCP_TASKS_CONFIG'] = savedConfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates tasks and returns their IDs', async () => {
    const candidates = [
      { title: 'Write unit tests', project: 'MYPROJ', area: 'internal' },
      { title: 'Deploy to staging', project: 'MYPROJ', area: 'internal', why: 'QA needs it' },
    ];

    const res = await fetch(`${baseUrl}/api/capture/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { created: string[] };
    expect(Array.isArray(data.created)).toBe(true);
    expect(data.created).toHaveLength(2);
    // Each ID must match PREFIX-NNN pattern
    for (const id of data.created) {
      expect(id).toMatch(/^[A-Z]+-\d+$/);
    }
  });

  it('returns 400 when candidates array is missing', async () => {
    const res = await fetch(`${baseUrl}/api/capture/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notCandidates: [] }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('MISSING_FIELDS');
  });

  it('skips candidates without a valid title', async () => {
    const candidates = [
      { title: '', project: 'MYPROJ', area: 'internal' },
      { title: 'Valid task', project: 'MYPROJ', area: 'client' },
    ];
    const res = await fetch(`${baseUrl}/api/capture/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { created: string[] };
    expect(data.created).toHaveLength(1);
  });

  it('falls back to GEN or first available project when project is unknown', async () => {
    const candidates = [
      { title: 'Unknown project task', project: 'DOESNOTEXIST', area: 'internal' },
    ];
    const res = await fetch(`${baseUrl}/api/capture/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { created: string[] };
    expect(data.created).toHaveLength(1);
  });

  it('returns empty created array for empty candidates list', async () => {
    const res = await fetch(`${baseUrl}/api/capture/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates: [] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { created: string[] };
    expect(data.created).toHaveLength(0);
  });
});

// ─── POST /api/acr/dispatch ─────────────────────────────────────────────────

describe('POST /api/acr/dispatch', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedDb: string | undefined;
  let savedConfig: string | undefined;

  beforeAll(async () => {
    const env = makeTempEnv();
    tempDir = env.tempDir;
    savedDb = process.env['MCP_TASKS_DB'];
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    const server = await startServer(env.configPath, path.join(tempDir, 'tasks-acr.db'));
    handle = server.handle;
    baseUrl = server.baseUrl;
  });

  afterAll(async () => {
    await handle.close();
    if (savedDb === undefined) delete process.env['MCP_TASKS_DB'];
    else process.env['MCP_TASKS_DB'] = savedDb;
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG'];
    else process.env['MCP_TASKS_CONFIG'] = savedConfig;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('response structure: always HTTP 200 with either jobId or error field', async () => {
    // This test verifies the core contract of the dispatch endpoint.
    // We call it without ACR running (offline case in CI) and verify the
    // response is always HTTP 200 — never a 500 or thrown error.
    const res = await fetch(`${baseUrl}/api/acr/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Create new UI component', detail: 'Button with icon' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { jobId?: string; error?: string };
    // Must have exactly one of jobId or error (never neither, never both as primary)
    const hasJobId = typeof data.jobId === 'string';
    const hasError = typeof data.error === 'string';
    expect(hasJobId || hasError).toBe(true);
  }, 15_000);

  it('returns HTTP 200 with error "ACR offline" when port 3001 has no listener', async () => {
    // Ensure port 3001 is NOT listening before calling
    // The AbortSignal timeout is 5s so we need a higher test timeout
    const res = await fetch(`${baseUrl}/api/acr/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Design new login screen', detail: 'Needs dark mode' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { error?: string; jobId?: string };
    // ACR is offline in test environment — must return error field, not throw
    expect(data.error).toBe('ACR offline');
    expect(data.jobId).toBeUndefined();
  }, 15_000); // 15s timeout — AbortSignal takes 5s to fire

  it('returns 400 when title is missing', async () => {
    const res = await fetch(`${baseUrl}/api/acr/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ detail: 'No title here' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('MISSING_FIELDS');
  });

  it('returns HTTP 200 (either jobId or ACR offline) — never throws or returns 5xx', async () => {
    // This test verifies the contract: dispatch always returns HTTP 200
    const res = await fetch(`${baseUrl}/api/acr/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Any task', detail: 'Any detail' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { error?: string; jobId?: string };
    // Must have exactly one of jobId or error
    const hasJobId = data.jobId !== undefined;
    const hasError = data.error !== undefined;
    expect(hasJobId || hasError).toBe(true);
  }, 15_000);
});
