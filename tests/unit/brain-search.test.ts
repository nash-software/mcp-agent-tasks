/**
 * Unit tests for GET /api/brain/search and GET /api/brain/status
 * - online path: mock brain MCP fetch returns results
 * - offline path: ECONNREFUSED → returns { offline: true, results: [] }, HTTP 200
 * - validation: empty q → 400
 * - brain/status: offline path returns { online: false } (never throws)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const BRAIN_MCP_PATTERN = 'nash-vps.tail5c5009.ts.net:8093';

// The real brain MCP server uses Streamable HTTP transport: requests need
// Accept: application/json, text/event-stream; the initialize response carries an
// mcp-session-id header; responses are SSE ("event: message\ndata: {json}").
function sseResponse(payload: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...extraHeaders },
  });
}

/** Build a brain mock that completes the initialize → tools/call handshake. */
function brainHandshake(toolResult: unknown): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return (_input, init) => {
    const body = init?.body ? JSON.parse(init.body as string) as { method?: string } : {};
    if (body.method === 'initialize') {
      return Promise.resolve(sseResponse(
        { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'brain', version: '1' } } },
        { 'mcp-session-id': 'test-session-123' },
      ));
    }
    // tools/call
    return Promise.resolve(sseResponse({ jsonrpc: '2.0', id: 2, result: toolResult }));
  };
}

/** Wrap globalThis.fetch: brain MCP calls (nash-vps Tailscale) get the mock;
 *  all other calls (to the test server) use the real fetch. */
function stubBrainFetch(
  realFetch: typeof fetch,
  brainImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): MockInstance {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes(BRAIN_MCP_PATTERN)) {
        return brainImpl(input, init);
      }
      return realFetch(input, init);
    },
  );
}

function makeTempEnv(): { tempDir: string; configPath: string; dbPath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-search-test-'));
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

// ─── GET /api/brain/search — online path ────────────────────────────────────

describe('GET /api/brain/search — online path', () => {
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
    vi.restoreAllMocks();
  });

  it('returns results array when brain MCP responds (online path)', async () => {
    // brain_search tools/call result shape: { structuredContent: { result: [...] }, content, isError }
    const toolResult = {
      content: [{ type: 'text', text: '{}' }],
      structuredContent: {
        result: [
          { rank: 1, source: 'web', path: 'notes/typescript-tips.md', snippet: 'Use strict mode for safer code.' },
        ],
      },
      isError: false,
    };

    stubBrainFetch(realFetch, brainHandshake(toolResult));

    const res = await realFetch(`${baseUrl}/api/brain/search?q=typescript`);
    expect(res.status).toBe(200);
    const body = await res.json() as { results: Array<{ title: string; snippet: string; source?: string }>; query: string; offline?: boolean };
    expect(body.offline).toBeUndefined();
    expect(body.query).toBe('typescript');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(1);
    // title derived from path basename (no extension) when no explicit title field
    expect(body.results[0].title).toBe('typescript-tips');
    expect(body.results[0].snippet).toBe('Use strict mode for safer code.');
    expect(body.results[0].source).toBe('web');
  });
});

// ─── GET /api/brain/search — offline path ───────────────────────────────────

describe('GET /api/brain/search — offline path', () => {
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
    vi.restoreAllMocks();
  });

  it('returns { offline: true, results: [] } and HTTP 200 when brain is unreachable', async () => {
    const connError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8093'), { code: 'ECONNREFUSED' });

    stubBrainFetch(realFetch, () => Promise.reject(connError));

    const res = await realFetch(`${baseUrl}/api/brain/search?q=typescript`);
    expect(res.status).toBe(200);
    const body = await res.json() as { results: unknown[]; query: string; offline?: boolean };
    expect(body.offline).toBe(true);
    expect(body.results).toEqual([]);
    expect(body.query).toBe('typescript');
  });
});

// ─── GET /api/brain/search — validation ─────────────────────────────────────

describe('GET /api/brain/search — validation', () => {
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

  it('returns 400 when q param is missing', async () => {
    const res = await realFetch(`${baseUrl}/api/brain/search`);
    expect(res.status).toBe(400);
  });

  it('returns 400 when q param is empty', async () => {
    const res = await realFetch(`${baseUrl}/api/brain/search?q=`);
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/brain/status — offline path ────────────────────────────────────

describe('GET /api/brain/status — offline path', () => {
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
    vi.restoreAllMocks();
  });

  it('returns { online: false } with HTTP 200 when Brain is unreachable — never throws', async () => {
    // Simulate network error (Brain unreachable in CI)
    const connError = Object.assign(
      new Error('connect ECONNREFUSED 127.0.0.1:8093'),
      { code: 'ECONNREFUSED' },
    );
    stubBrainFetch(realFetch, () => Promise.reject(connError));

    const res = await realFetch(`${baseUrl}/api/brain/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as { online: boolean; reason?: string };
    expect(body.online).toBe(false);
    // Must never throw — reason is optional but must be a known string when present
    if (body.reason !== undefined) {
      expect(['tls', 'timeout', 'shape', 'error']).toContain(body.reason);
    }
  });

  it('does not invoke brain_search for the liveness check', async () => {
    // Verify the probe uses initialize/ping, not brain_search
    let calledMethod: string | undefined;
    stubBrainFetch(realFetch, (input, init) => {
      const body = init?.body ? JSON.parse(init.body as string) as { method?: string } : {};
      calledMethod = body.method;
      return Promise.reject(new Error('offline'));
    });

    await realFetch(`${baseUrl}/api/brain/status`);
    expect(calledMethod).toBe('initialize');
  });

  it('returns { online: true, latencyMs } when Brain responds to initialize', async () => {
    // Real brain replies with an SSE body, not plain JSON.
    stubBrainFetch(realFetch, () =>
      Promise.resolve(sseResponse(
        {
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'brain', version: '1' } },
        },
        { 'mcp-session-id': 'test-session-123' },
      )),
    );

    const res = await realFetch(`${baseUrl}/api/brain/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as { online: boolean; latencyMs?: number };
    expect(body.online).toBe(true);
    expect(typeof body.latencyMs).toBe('number');
  });
});
