/**
 * MCPAT-063 Bundle C — projects CRUD + sandboxed directory browser.
 * Live-server integration (mirrors mutation-endpoints.test.ts): POST/PATCH /api/projects, GET /api/fs/list.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface ProjectShape { prefix: string; name?: string; path: string }

describe('MCPAT-063 — projects CRUD', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let existDir: string;
  let newProjDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-projcrud-'));
    existDir = path.join(tempDir, 'existing-project');
    newProjDir = path.join(tempDir, 'new-project');
    fs.mkdirSync(path.join(existDir, 'agent-tasks'), { recursive: true });
    fs.mkdirSync(newProjDir, { recursive: true });

    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      storageDir: path.join(tempDir, 'global-store'),
      defaultStorage: 'local',
      enforcement: 'off',
      autoCommit: false,
      claimTtlHours: 4,
      trackManifest: false,
      tasksDirName: 'agent-tasks',
      projects: [{ prefix: 'EXIST', name: 'Existing', path: existDir, storage: 'local' }],
    }), 'utf-8');

    saved.MCP_TASKS_CONFIG = process.env['MCP_TASKS_CONFIG'];
    saved.MCP_TASKS_DB = process.env['MCP_TASKS_DB'];
    process.env['MCP_TASKS_CONFIG'] = configPath;
    delete process.env['MCP_TASKS_DB'];

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('POST /api/projects creates + inits a project (dir + index + config) and returns it', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'NEW', name: 'New Project', path: newProjDir, storage: 'local' }),
    });
    expect(res.status).toBe(201);
    const proj = await res.json() as ProjectShape;
    expect(proj).toMatchObject({ prefix: 'NEW', name: 'New Project', path: newProjDir });
    // agent-tasks dir was created
    expect(fs.existsSync(path.join(newProjDir, 'agent-tasks'))).toBe(true);
    // config was persisted with the new project
    const cfg = JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf-8')) as { projects: ProjectShape[] };
    expect(cfg.projects.some(p => p.prefix === 'NEW' && p.name === 'New Project')).toBe(true);
  });

  it('the new project appears in GET /api/projects WITHOUT a server restart (live push)', async () => {
    const list = await (await fetch(`${baseUrl}/api/projects`)).json() as ProjectShape[];
    const found = list.find(p => p.prefix === 'NEW');
    expect(found).toBeDefined();
    expect(found?.name).toBe('New Project');
  });

  it('duplicate prefix → 409 PROJECT_EXISTS', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'EXIST', path: newProjDir }),
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('PROJECT_EXISTS');
  });

  it('non-existent path → 400', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'GHOST', path: path.join(tempDir, 'does-not-exist') }),
    });
    expect(res.status).toBe(400);
  });

  it('bad prefix format (lowercase) → 400', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'lower', path: newProjDir }),
    });
    expect(res.status).toBe(400);
  });

  it('over-long name (>80) → 400', async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'LONGN', path: newProjDir, name: 'x'.repeat(81) }),
    });
    expect(res.status).toBe(400);
  });

  // ── PATCH /api/projects/:prefix (name only) ──────────────────────────────

  it('PATCH updates the name and persists it atomically (re-read)', async () => {
    const res = await fetch(`${baseUrl}/api/projects/EXIST`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Existing — Renamed' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as ProjectShape).name).toBe('Existing — Renamed');
    const cfg = JSON.parse(fs.readFileSync(path.join(tempDir, 'config.json'), 'utf-8')) as { projects: ProjectShape[] };
    expect(cfg.projects.find(p => p.prefix === 'EXIST')?.name).toBe('Existing — Renamed');
  });

  it('PATCH with an empty name clears it (falls back to prefix)', async () => {
    const res = await fetch(`${baseUrl}/api/projects/EXIST`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as ProjectShape).name).toBeUndefined();
  });

  it('PATCH attempting to change the prefix → 400 (immutable)', async () => {
    const res = await fetch(`${baseUrl}/api/projects/EXIST`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'RENAMED' }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH unknown project → 404', async () => {
    const res = await fetch(`${baseUrl}/api/projects/NOPE`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
  });
});
