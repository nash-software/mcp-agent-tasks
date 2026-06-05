import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Mock the build runner so /api/dev/update resolves quickly without spawning a real `npm run build`.
const runBuildMock = vi.fn();
vi.mock('../../src/dev/build-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/dev/build-runner.js')>();
  return {
    ...actual,
    runBuild: (...args: unknown[]): unknown => runBuildMock(...args),
  };
});

// Imported after the mock is registered.
const { startUiServer } = await import('../../src/server-ui.js');
type UiServerHandle = Awaited<ReturnType<typeof startUiServer>>;

/** Write a minimal config + temp tasks dir so loadConfig() succeeds, returning teardown state. */
function setupTempEnv(): { tempDir: string; savedDb: string | undefined; savedConfig: string | undefined } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-serve-ui-dev-'));
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

  const savedDb = process.env['MCP_TASKS_DB'];
  const savedConfig = process.env['MCP_TASKS_CONFIG'];
  process.env['MCP_TASKS_CONFIG'] = configPath;
  process.env['MCP_TASKS_DB'] = path.join(tempDir, 'tasks.db');
  return { tempDir, savedDb, savedConfig };
}

function teardownTempEnv(state: { tempDir: string; savedDb: string | undefined; savedConfig: string | undefined }): void {
  if (state.savedDb === undefined) delete process.env['MCP_TASKS_DB'];
  else process.env['MCP_TASKS_DB'] = state.savedDb;
  if (state.savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG'];
  else process.env['MCP_TASKS_CONFIG'] = state.savedConfig;
  fs.rmSync(state.tempDir, { recursive: true, force: true });
}

describe('serve-ui dev endpoints — MCPAT_DEV_TRAY=1 (AC-4)', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let env: ReturnType<typeof setupTempEnv>;
  let savedFlag: string | undefined;

  beforeAll(async () => {
    savedFlag = process.env['MCPAT_DEV_TRAY'];
    process.env['MCPAT_DEV_TRAY'] = '1';
    env = setupTempEnv();
    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    teardownTempEnv(env);
    if (savedFlag === undefined) delete process.env['MCPAT_DEV_TRAY'];
    else process.env['MCPAT_DEV_TRAY'] = savedFlag;
  });

  it('GET /api/version → 200 {buildId, devTray:true} and is not cached', async () => {
    const res = await fetch(`${baseUrl}/api/version`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const data = await res.json() as { buildId: string; devTray: boolean };
    expect(typeof data.buildId).toBe('string');
    expect(data.buildId.length).toBeGreaterThan(0);
    expect(data.devTray).toBe(true);
  });

  it('POST /api/dev/update is routed (not 404) when dev tray is enabled', async () => {
    runBuildMock.mockResolvedValueOnce({ ok: false, log: 'simulated build failure', buildId: '' });
    const res = await fetch(`${baseUrl}/api/dev/update`, { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; log: string };
    expect(data.ok).toBe(false);
    expect(data.log).toBe('simulated build failure');
  });
});

describe('serve-ui dev endpoints — MCPAT_DEV_TRAY unset (AC-5)', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let env: ReturnType<typeof setupTempEnv>;
  let savedFlag: string | undefined;

  beforeAll(async () => {
    savedFlag = process.env['MCPAT_DEV_TRAY'];
    delete process.env['MCPAT_DEV_TRAY'];
    env = setupTempEnv();
    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    teardownTempEnv(env);
    if (savedFlag === undefined) delete process.env['MCPAT_DEV_TRAY'];
    else process.env['MCPAT_DEV_TRAY'] = savedFlag;
  });

  it('POST /api/dev/update → 404 (shipped tool cannot trigger a build)', async () => {
    const res = await fetch(`${baseUrl}/api/dev/update`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('GET /api/version → 200 {buildId, devTray:false}', async () => {
    const res = await fetch(`${baseUrl}/api/version`);
    expect(res.status).toBe(200);
    const data = await res.json() as { buildId: string; devTray: boolean };
    expect(typeof data.buildId).toBe('string');
    expect(data.devTray).toBe(false);
  });
});

describe('serve-ui dev endpoints — deferred exit (AC-6)', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let env: ReturnType<typeof setupTempEnv>;
  let savedFlag: string | undefined;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    savedFlag = process.env['MCPAT_DEV_TRAY'];
    process.env['MCPAT_DEV_TRAY'] = '1';
    env = setupTempEnv();
    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    teardownTempEnv(env);
    if (savedFlag === undefined) delete process.env['MCPAT_DEV_TRAY'];
    else process.env['MCPAT_DEV_TRAY'] = savedFlag;
  });

  beforeEach(() => {
    // Prevent the deferred process.exit from killing the test runner; assert it is called later.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => undefined as never));
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('returns {ok:true} and flushes the response BEFORE the deferred exit fires', async () => {
    runBuildMock.mockResolvedValueOnce({ ok: true, log: 'built', buildId: 'abc123def456' });

    const res = await fetch(`${baseUrl}/api/dev/update`, { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; buildId: string };
    expect(data.ok).toBe(true);
    expect(data.buildId).toBe('abc123def456');

    // Response is fully received here. Exit is deferred by ~250ms, so it must NOT have fired yet.
    expect(exitSpy).not.toHaveBeenCalled();

    // Wait past the deferral window and confirm the exit was scheduled.
    await new Promise((r) => setTimeout(r, 400));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
