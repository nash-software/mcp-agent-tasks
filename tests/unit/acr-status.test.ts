/**
 * Unit tests for GET /api/acr/status
 * - online path: mock ACR fetch returns jobs array
 * - offline path: ECONNREFUSED → returns { offline: true, jobs: [] }, HTTP 200
 * - cache: second call within 10s does not re-fetch from ACR
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startUiServer, resetAcrCache, type UiServerHandle } from '../../src/server-ui.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const ACR_URL = 'https://acr.nashsoftware.dev/mcp';

/** Wrap globalThis.fetch so ACR calls (acr.nashsoftware.dev) get the mock response
 *  while all other calls (to the test server) use the real fetch. */
function stubAcrFetch(
  realFetch: typeof fetch,
  acrImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): MockInstance {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === ACR_URL) {
        return acrImpl(input, init);
      }
      return realFetch(input, init);
    },
  );
}

function makeTempEnv(): { tempDir: string; configPath: string; dbPath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acr-status-test-'));
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

async function startServer(configPath: string, dbPath: string): Promise<{ handle: UiServerHandle; baseUrl: string }> {
  process.env['MCP_TASKS_CONFIG'] = configPath;
  process.env['MCP_TASKS_DB'] = dbPath;
  const handle = await startUiServer({ port: 0 });
  return { handle, baseUrl: handle.url };
}

// ─── GET /api/acr/status — online path ──────────────────────────────────────

describe('GET /api/acr/status — online path', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedDb: string | undefined;
  let savedConfig: string | undefined;
  const realFetch = globalThis.fetch.bind(globalThis);

  beforeAll(async () => {
    savedDb = process.env['MCP_TASKS_DB'];
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    const env = makeTempEnv();
    tempDir = env.tempDir;
    ({ handle, baseUrl } = await startServer(env.configPath, env.dbPath));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await handle.close();
    if (savedDb !== undefined) process.env['MCP_TASKS_DB'] = savedDb;
    else delete process.env['MCP_TASKS_DB'];
    if (savedConfig !== undefined) process.env['MCP_TASKS_CONFIG'] = savedConfig;
    else delete process.env['MCP_TASKS_CONFIG'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetAcrCache();
    vi.restoreAllMocks();
  });

  it('returns jobs array when ACR is reachable', async () => {
    const mockJobs = [
      { id: 'job-1', title: 'Fix login bug', status: 'running' },
      { id: 'job-2', title: 'Add dark mode', status: 'pending' },
    ];

    stubAcrFetch(realFetch, () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { jobs: mockJobs } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const res = await realFetch(`${baseUrl}/api/acr/status`);
    expect(res.status).toBe(200);
    const data = await res.json() as { offline: boolean; jobs: unknown[] };
    expect(data.offline).toBe(false);
    expect(data.jobs).toHaveLength(2);
    expect((data.jobs[0] as { title: string }).title).toBe('Fix login bug');
    expect((data.jobs[1] as { status: string }).status).toBe('pending');
  });
});

// ─── GET /api/acr/status — offline path ─────────────────────────────────────

describe('GET /api/acr/status — offline path', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedDb: string | undefined;
  let savedConfig: string | undefined;
  const realFetch = globalThis.fetch.bind(globalThis);

  beforeAll(async () => {
    savedDb = process.env['MCP_TASKS_DB'];
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    const env = makeTempEnv();
    tempDir = env.tempDir;
    ({ handle, baseUrl } = await startServer(env.configPath, env.dbPath));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await handle.close();
    if (savedDb !== undefined) process.env['MCP_TASKS_DB'] = savedDb;
    else delete process.env['MCP_TASKS_DB'];
    if (savedConfig !== undefined) process.env['MCP_TASKS_CONFIG'] = savedConfig;
    else delete process.env['MCP_TASKS_CONFIG'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetAcrCache();
    vi.restoreAllMocks();
  });

  it('returns { offline: true, jobs: [] } and HTTP 200 when ACR is unreachable', async () => {
    const connError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), { code: 'ECONNREFUSED' });

    stubAcrFetch(realFetch, () => Promise.reject(connError));

    const res = await realFetch(`${baseUrl}/api/acr/status`);
    expect(res.status).toBe(200);
    const data = await res.json() as { offline: boolean; jobs: unknown[] };
    expect(data.offline).toBe(true);
    expect(data.jobs).toEqual([]);
  });
});

// ─── GET /api/acr/status — cache ────────────────────────────────────────────

describe('GET /api/acr/status — cache', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedDb: string | undefined;
  let savedConfig: string | undefined;
  const realFetch = globalThis.fetch.bind(globalThis);

  beforeAll(async () => {
    savedDb = process.env['MCP_TASKS_DB'];
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    const env = makeTempEnv();
    tempDir = env.tempDir;
    ({ handle, baseUrl } = await startServer(env.configPath, env.dbPath));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await handle.close();
    if (savedDb !== undefined) process.env['MCP_TASKS_DB'] = savedDb;
    else delete process.env['MCP_TASKS_DB'];
    if (savedConfig !== undefined) process.env['MCP_TASKS_CONFIG'] = savedConfig;
    else delete process.env['MCP_TASKS_CONFIG'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetAcrCache();
    vi.restoreAllMocks();
  });

  it('does not call ACR fetch a second time within 10s (cache hit)', async () => {
    const mockJobs = [{ id: 'j1', title: 'Task one', status: 'done' }];
    let acrCallCount = 0;

    stubAcrFetch(realFetch, () => {
      acrCallCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { jobs: mockJobs } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });

    // First request — primes the cache
    const res1 = await realFetch(`${baseUrl}/api/acr/status`);
    expect(res1.status).toBe(200);

    // Wait briefly for the async cache-prime to complete
    await new Promise(r => setTimeout(r, 50));
    expect(acrCallCount).toBe(1);

    // Second request — should be served from cache, no new ACR call
    const res2 = await realFetch(`${baseUrl}/api/acr/status`);
    expect(res2.status).toBe(200);

    expect(acrCallCount).toBe(1); // Still 1 — no new call
  });
});
