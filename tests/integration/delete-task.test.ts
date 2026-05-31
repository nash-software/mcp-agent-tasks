/**
 * P5-04 — DELETE /api/tasks/:id (markdown-first) + full-field POST /api/tasks.
 * Boots serve-ui on an ephemeral port with an isolated temp tasks dir.
 *
 * Covers:
 *  - POST /api/tasks full-field create → durable markdown file written (AC1)
 *  - POST /api/tasks over-length title → 400 (AC2)
 *  - DELETE → 200, markdown archived + index row gone, reconcile does NOT resurrect (AC3)
 *  - DELETE unknown id → 404 (AC4)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

describe('P5-04 — DELETE /api/tasks/:id + full-field create', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let tasksDir: string;
  let saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-delete-'));
    tasksDir = path.join(tempDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1, storageDir: tasksDir, defaultStorage: 'local', enforcement: 'off',
      autoCommit: false, claimTtlHours: 4, trackManifest: false, tasksDirName: 'agent-tasks',
      projects: [{ prefix: 'DEL', path: tempDir, storage: 'local' }],
    }), 'utf-8');

    saved = { MCP_TASKS_CONFIG: process.env['MCP_TASKS_CONFIG'], MCP_TASKS_DB: process.env['MCP_TASKS_DB'] };
    process.env['MCP_TASKS_CONFIG'] = configPath;
    delete process.env['MCP_TASKS_DB'];

    const { SqliteIndex } = await import('../../src/store/sqlite-index.js');
    const idx = new SqliteIndex(path.join(tasksDir, '.index.db'));
    idx.init();
    idx.ensureProject('DEL');
    idx.close();

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function createTask(fields: Record<string, unknown>): Promise<{ id: string }> {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    expect(res.status).toBe(201);
    return res.json() as Promise<{ id: string }>;
  }

  it('AC1: full-field POST creates a durable task with a markdown file on disk', async () => {
    const { id } = await createTask({ title: 'Full field task', project: 'DEL', priority: 'high', area: 'client', estimate_hours: 2, why: 'because' });
    expect(fs.existsSync(path.join(tasksDir, `${id}.md`))).toBe(true);
    const list = await (await fetch(`${baseUrl}/api/tasks`)).json() as Array<{ id: string; priority: string; area?: string }>;
    const created = list.find(t => t.id === id);
    expect(created?.priority).toBe('high');
    expect(created?.area).toBe('client');
  });

  it('AC2: over-length title → 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(201), project: 'DEL' }),
    });
    expect(res.status).toBe(400);
  });

  it('AC2: invalid priority → 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'bad pri', project: 'DEL', priority: 'banana' }),
    });
    expect(res.status).toBe(400);
  });

  it('AC3: DELETE removes markdown + index, and reconcile does not resurrect', async () => {
    const { id } = await createTask({ title: 'To delete', project: 'DEL' });
    const mdPath = path.join(tasksDir, `${id}.md`);
    expect(fs.existsSync(mdPath)).toBe(true);

    const del = await fetch(`${baseUrl}/api/tasks/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const body = await del.json() as { deleted: boolean; id: string };
    expect(body.deleted).toBe(true);

    // markdown archived (no longer at the live path) and index row gone
    expect(fs.existsSync(mdPath)).toBe(false);
    const list = await (await fetch(`${baseUrl}/api/tasks`)).json() as Array<{ id: string }>;
    expect(list.some(t => t.id === id)).toBe(false);

    // reconcile must NOT resurrect it (markdown-first delete; archive/ is not scanned)
    const { SqliteIndex } = await import('../../src/store/sqlite-index.js');
    const { Reconciler } = await import('../../src/store/reconciler.js');
    const idx2 = new SqliteIndex(path.join(tasksDir, '.index.db'));
    idx2.init();
    new Reconciler(idx2, tasksDir, 'DEL').reconcile();
    expect(idx2.getTask(id)).toBeNull();
    idx2.close();
  });

  it('AC4: DELETE unknown id → 404', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/DEL-999`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
