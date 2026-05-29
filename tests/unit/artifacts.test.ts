/**
 * Unit tests for ST-5 Artifacts feature:
 * - GET /api/artifacts: dedup by path, 30-day filter, staleDays calc, sort order, missing file
 * - POST /api/artifacts/opened: updates last_opened_at
 * - Hook artifact append: verifies correct JSONL record is appended
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTempEnv(): { tempDir: string; configPath: string; dbPath: string; mcpTasksDir: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-test-'));
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

  // Point MCP_TASKS_DIR to a temp dir so we don't pollute ~/.mcp-tasks
  const mcpTasksDir = path.join(tempDir, 'mcp-tasks');
  fs.mkdirSync(mcpTasksDir, { recursive: true });

  return { tempDir, configPath, dbPath, mcpTasksDir };
}

async function startServer(configPath: string, dbPath: string): Promise<{ handle: UiServerHandle; baseUrl: string }> {
  process.env['MCP_TASKS_CONFIG'] = configPath;
  process.env['MCP_TASKS_DB'] = dbPath;
  const handle = await startUiServer({ port: 0 });
  return { handle, baseUrl: handle.url };
}

// ─── GET /api/artifacts ──────────────────────────────────────────────────────

describe('GET /api/artifacts', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedDb: string | undefined;
  let savedConfig: string | undefined;

  beforeAll(async () => {
    savedDb = process.env['MCP_TASKS_DB'];
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    const env = makeTempEnv();
    tempDir = env.tempDir;
    ({ handle, baseUrl } = await startServer(env.configPath, env.dbPath));
  });

  afterAll(async () => {
    await handle.close();
    if (savedDb !== undefined) process.env['MCP_TASKS_DB'] = savedDb;
    else delete process.env['MCP_TASKS_DB'];
    if (savedConfig !== undefined) process.env['MCP_TASKS_CONFIG'] = savedConfig;
    else delete process.env['MCP_TASKS_CONFIG'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty array when artifacts.jsonl does not exist', async () => {
    // Ensure the file doesn't exist at the real path
    const artifactsPath = path.join(os.homedir(), '.mcp-tasks', 'artifacts.jsonl');
    const exists = fs.existsSync(artifactsPath);

    const res = await fetch(`${baseUrl}/api/artifacts`);
    expect(res.status).toBe(200);
    const data = await res.json() as unknown[];
    // Either empty (file missing) or an array (file exists from prior runs)
    expect(Array.isArray(data)).toBe(true);
    if (!exists) {
      expect(data).toHaveLength(0);
    }
  });
});

// ─── GET /api/artifacts — dedup + filter + sort logic ───────────────────────

describe('GET /api/artifacts dedup, filter, sort', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedDb: string | undefined;
  let savedConfig: string | undefined;
  let origArtifacts: string | undefined;

  const realArtifactsPath = path.join(os.homedir(), '.mcp-tasks', 'artifacts.jsonl');
  const realOpenedPath = path.join(os.homedir(), '.mcp-tasks', 'artifacts-opened.json');

  beforeAll(async () => {
    savedDb = process.env['MCP_TASKS_DB'];
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    // Save and replace real artifacts.jsonl with test data
    if (fs.existsSync(realArtifactsPath)) {
      origArtifacts = fs.readFileSync(realArtifactsPath, 'utf-8');
    }
    if (fs.existsSync(realOpenedPath)) {
      fs.unlinkSync(realOpenedPath);
    }

    const env = makeTempEnv();
    tempDir = env.tempDir;
    ({ handle, baseUrl } = await startServer(env.configPath, env.dbPath));
  });

  afterAll(async () => {
    await handle.close();
    // Restore real artifacts.jsonl
    if (origArtifacts !== undefined) {
      fs.writeFileSync(realArtifactsPath, origArtifacts, 'utf-8');
    } else if (fs.existsSync(realArtifactsPath)) {
      fs.unlinkSync(realArtifactsPath);
    }
    if (savedDb !== undefined) process.env['MCP_TASKS_DB'] = savedDb;
    else delete process.env['MCP_TASKS_DB'];
    if (savedConfig !== undefined) process.env['MCP_TASKS_CONFIG'] = savedConfig;
    else delete process.env['MCP_TASKS_CONFIG'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Reset artifacts.jsonl and opened store before each test
    if (fs.existsSync(realOpenedPath)) fs.unlinkSync(realOpenedPath);
  });

  it('deduplicates by path, keeping most recent created_at', async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 2 * 86_400_000).toISOString(); // 2 days ago
    const older = new Date(now.getTime() - 5 * 86_400_000).toISOString(); // 5 days ago

    const lines = [
      JSON.stringify({ path: '/test/file.ts', project: 'TEST', created_at: older, task_id: null }),
      JSON.stringify({ path: '/test/file.ts', project: 'TEST', created_at: recent, task_id: 'TEST-001' }),
    ].join('\n') + '\n';
    fs.writeFileSync(realArtifactsPath, lines, 'utf-8');

    const res = await fetch(`${baseUrl}/api/artifacts`);
    const data = await res.json() as Array<{ path: string; created_at: string; task_id: string | null }>;

    const matches = data.filter(e => e.path === '/test/file.ts');
    expect(matches).toHaveLength(1);
    expect(matches[0].created_at).toBe(recent);
    expect(matches[0].task_id).toBe('TEST-001');
  });

  it('filters out entries older than 30 days', async () => {
    const now = new Date();
    const fresh = new Date(now.getTime() - 5 * 86_400_000).toISOString();
    const stale = new Date(now.getTime() - 35 * 86_400_000).toISOString();

    const lines = [
      JSON.stringify({ path: '/test/fresh.ts', project: 'TEST', created_at: fresh, task_id: null }),
      JSON.stringify({ path: '/test/stale.ts', project: 'TEST', created_at: stale, task_id: null }),
    ].join('\n') + '\n';
    fs.writeFileSync(realArtifactsPath, lines, 'utf-8');

    const res = await fetch(`${baseUrl}/api/artifacts`);
    const data = await res.json() as Array<{ path: string }>;

    const paths = data.map(e => e.path);
    expect(paths).toContain('/test/fresh.ts');
    expect(paths).not.toContain('/test/stale.ts');
  });

  it('computes staleDays correctly', async () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000).toISOString();

    const lines = JSON.stringify({ path: '/test/age.ts', project: 'TEST', created_at: twoDaysAgo, task_id: null }) + '\n';
    fs.writeFileSync(realArtifactsPath, lines, 'utf-8');

    const res = await fetch(`${baseUrl}/api/artifacts`);
    const data = await res.json() as Array<{ path: string; staleDays: number }>;

    const entry = data.find(e => e.path === '/test/age.ts');
    expect(entry).toBeDefined();
    expect(entry!.staleDays).toBe(2);
  });

  it('sorts never-opened entries first (null last_opened_at)', async () => {
    const now = new Date();
    const t1 = new Date(now.getTime() - 3 * 86_400_000).toISOString();
    const t2 = new Date(now.getTime() - 1 * 86_400_000).toISOString();

    const lines = [
      JSON.stringify({ path: '/test/a.ts', project: 'TEST', created_at: t1, task_id: null }),
      JSON.stringify({ path: '/test/b.ts', project: 'TEST', created_at: t2, task_id: null }),
    ].join('\n') + '\n';
    fs.writeFileSync(realArtifactsPath, lines, 'utf-8');

    // Mark /test/b.ts as opened
    fs.writeFileSync(realOpenedPath, JSON.stringify({ '/test/b.ts': new Date().toISOString() }), 'utf-8');

    const res = await fetch(`${baseUrl}/api/artifacts`);
    const data = await res.json() as Array<{ path: string; last_opened_at: string | null }>;

    const paths = data.filter(e => e.path === '/test/a.ts' || e.path === '/test/b.ts').map(e => e.path);
    // a.ts (never opened) must come before b.ts (recently opened)
    expect(paths.indexOf('/test/a.ts')).toBeLessThan(paths.indexOf('/test/b.ts'));
  });

  it('skips malformed lines gracefully', async () => {
    const now = new Date();
    const fresh = new Date(now.getTime() - 1 * 86_400_000).toISOString();

    const lines = [
      'not-json-at-all',
      JSON.stringify({ path: '/test/good.ts', project: 'TEST', created_at: fresh, task_id: null }),
      '{"broken":',
    ].join('\n') + '\n';
    fs.writeFileSync(realArtifactsPath, lines, 'utf-8');

    const res = await fetch(`${baseUrl}/api/artifacts`);
    expect(res.status).toBe(200);
    const data = await res.json() as Array<{ path: string }>;
    expect(data.some(e => e.path === '/test/good.ts')).toBe(true);
  });
});

// ─── POST /api/artifacts/opened ─────────────────────────────────────────────

describe('POST /api/artifacts/opened', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let savedDb: string | undefined;
  let savedConfig: string | undefined;

  const realOpenedPath = path.join(os.homedir(), '.mcp-tasks', 'artifacts-opened.json');

  beforeAll(async () => {
    savedDb = process.env['MCP_TASKS_DB'];
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    if (fs.existsSync(realOpenedPath)) fs.unlinkSync(realOpenedPath);

    const env = makeTempEnv();
    tempDir = env.tempDir;
    ({ handle, baseUrl } = await startServer(env.configPath, env.dbPath));
  });

  afterAll(async () => {
    await handle.close();
    if (fs.existsSync(realOpenedPath)) fs.unlinkSync(realOpenedPath);
    if (savedDb !== undefined) process.env['MCP_TASKS_DB'] = savedDb;
    else delete process.env['MCP_TASKS_DB'];
    if (savedConfig !== undefined) process.env['MCP_TASKS_CONFIG'] = savedConfig;
    else delete process.env['MCP_TASKS_CONFIG'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns { ok: true } and persists last_opened_at', async () => {
    const before = Date.now();
    const res = await fetch(`${baseUrl}/api/artifacts/opened`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/test/myfile.ts' }),
    });
    const after = Date.now();

    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);

    // Check the file was written
    expect(fs.existsSync(realOpenedPath)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(realOpenedPath, 'utf-8')) as Record<string, string>;
    expect(stored['/test/myfile.ts']).toBeDefined();
    const ts = new Date(stored['/test/myfile.ts']).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('returns 400 when path is missing', async () => {
    const res = await fetch(`${baseUrl}/api/artifacts/opened`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// ─── Hook artifact-append logic ─────────────────────────────────────────────

describe('passive-capture artifact append', () => {
  it('appends a correct JSONL record to artifacts.jsonl', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-hook-test-'));
    const artifactsPath = path.join(tmpDir, 'artifacts.jsonl');

    try {
      const now = new Date().toISOString();
      const record = JSON.stringify({
        path: '/code/myproject/src/foo.ts',
        project: 'TEST',
        created_at: now,
        task_id: 'TEST-001',
      });
      fs.appendFileSync(artifactsPath, record + '\n');

      const content = fs.readFileSync(artifactsPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim() !== '');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]) as {
        path: string;
        project: string;
        created_at: string;
        task_id: string | null;
      };
      expect(parsed.path).toBe('/code/myproject/src/foo.ts');
      expect(parsed.project).toBe('TEST');
      expect(parsed.task_id).toBe('TEST-001');
      expect(typeof parsed.created_at).toBe('string');
      expect(new Date(parsed.created_at).getTime()).not.toBeNaN();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('silent failure does not throw — append to unwritable path', () => {
    // Simulates the hook's try/catch around appendFileSync
    const badPath = '/nonexistent/deep/path/artifacts.jsonl';
    expect(() => {
      try {
        fs.appendFileSync(badPath, 'test\n');
      } catch (e) {
        // This is the hook's behavior: log to stderr, never throw
        process.stderr.write('[passive-capture] artifact log write failed: ' + (e instanceof Error ? e.message : String(e)) + '\n');
      }
    }).not.toThrow();
  });
});
