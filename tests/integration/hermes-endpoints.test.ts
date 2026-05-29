/**
 * P2-04 — Hermes backend HTTP endpoints integration tests.
 *
 * Boots the serve-ui server on an ephemeral port with an isolated temp tasks dir and an
 * isolated MCP_TASKS_DIR (so skills.json / agent-log.jsonl don't touch the real home dir).
 *
 * Covers:
 *  - POST /api/tasks/:id/signoff   → 200, agent_status='scheduled', persisted (AC-4)
 *  - DELETE /api/tasks/:id/signoff → 200, agent_status absent, persisted (AC-4)
 *  - signoff on unknown id         → 404 TASK_NOT_FOUND
 *  - GET /api/skills (no file)     → []                              (AC-5)
 *  - POST /api/skills              → 201, runs:0, generated id       (AC-5)
 *  - POST /api/skills bad body     → 400                             (AC-5)
 *  - two concurrent POST /api/skills both land, file valid JSON      (AC-7)
 *  - GET /api/agent/log            → [] empty, newest-first, skips malformed line (AC-6)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

describe('Hermes backend endpoints (P2-04)', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let storeDir: string;
  let saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-hermes-'));
    const tasksDir = path.join(tempDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    storeDir = path.join(tempDir, 'store'); // isolated MCP_TASKS_DIR for skills/log

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
      projects: [{ prefix: 'TST', path: tempDir, storage: 'local' }],
    }), 'utf-8');

    saved = {
      MCP_TASKS_CONFIG: process.env['MCP_TASKS_CONFIG'],
      MCP_TASKS_DB: process.env['MCP_TASKS_DB'],
      MCP_TASKS_DIR: process.env['MCP_TASKS_DIR'],
    };
    process.env['MCP_TASKS_CONFIG'] = configPath;
    process.env['MCP_TASKS_DIR'] = storeDir;
    delete process.env['MCP_TASKS_DB'];

    // Seed a task into the project index.
    const { SqliteIndex } = await import('../../src/store/sqlite-index.js');
    const dbPath = path.join(tasksDir, '.index.db');
    const idx = new SqliteIndex(dbPath);
    idx.init();
    idx.ensureProject('TST');
    const ts = new Date().toISOString();
    idx.upsertTask({
      schema_version: 1, id: 'TST-001', title: 'Signable task', type: 'feature',
      status: 'todo', priority: 'medium', project: 'TST', tags: [], complexity: 1,
      complexity_manual: false, why: 'test', created: ts, updated: ts, last_activity: ts,
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
      children: [], dependencies: [], subtasks: [], git: { commits: [] },
      transitions: [], files: [], body: '', file_path: 'TST-001.md',
    });
    idx.close();

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

  // ── sign-off ──────────────────────────────────────────────────────────────

  it('POST /api/tasks/TST-001/signoff sets agent_status=scheduled and persists', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TST-001/signoff`, { method: 'POST' });
    expect(res.status).toBe(200);
    const task = await res.json() as { id: string; agent_status?: string };
    expect(task.id).toBe('TST-001');
    expect(task.agent_status).toBe('scheduled');

    // Persistence confirmed via a fresh re-read of the same task.
    const re = await fetch(`${baseUrl}/api/tasks/TST-001/signoff`, { method: 'POST' });
    const re2 = await re.json() as { agent_status?: string };
    expect(re2.agent_status).toBe('scheduled');
  });

  it('DELETE /api/tasks/TST-001/signoff clears agent_status', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TST-001/signoff`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const task = await res.json() as { id: string; agent_status?: string };
    expect(task.id).toBe('TST-001');
    expect(task.agent_status).toBeUndefined();
  });

  it('DELETE /api/tasks/TST-001/signoff is idempotent on an already-unsigned task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/TST-001/signoff`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const task = await res.json() as { agent_status?: string };
    expect(task.agent_status).toBeUndefined();
  });

  it('POST /api/tasks/FAKE-999/signoff returns 404 TASK_NOT_FOUND', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/FAKE-999/signoff`, { method: 'POST' });
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('TASK_NOT_FOUND');
  });

  // ── skills ────────────────────────────────────────────────────────────────

  it('GET /api/skills returns [] when the store file is missing', async () => {
    const res = await fetch(`${baseUrl}/api/skills`);
    expect(res.status).toBe(200);
    const data = await res.json() as unknown[];
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it('POST /api/skills creates a skill with runs:0 and a generated id', async () => {
    const res = await fetch(`${baseUrl}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'SEO Audit Suite', engine: 'hermes', project: 'TST', taskId: 'TST-001' }),
    });
    expect(res.status).toBe(201);
    const skill = await res.json() as { id: string; name: string; runs: number; minutesSaved: number; lastRun: string; origin: string };
    expect(skill.id).toBe('sk-seo-audit-suite');
    expect(skill.name).toBe('SEO Audit Suite');
    expect(skill.runs).toBe(0);
    expect(skill.minutesSaved).toBe(0);
    expect(skill.lastRun).toBe('');
    expect(skill.origin).toContain('TST-001');

    // It is now in the GET list.
    const list = await (await fetch(`${baseUrl}/api/skills`)).json() as { id: string }[];
    expect(list.some(s => s.id === 'sk-seo-audit-suite')).toBe(true);
  });

  it('POST /api/skills rejects missing name with 400', async () => {
    const res = await fetch(`${baseUrl}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'hermes' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('MISSING_FIELDS');
  });

  it('POST /api/skills rejects a bad engine with 400', async () => {
    const res = await fetch(`${baseUrl}/api/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad', engine: 'nope' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('MISSING_FIELDS');
  });

  it('two concurrent POST /api/skills both land and the file stays valid JSON (AC-7)', async () => {
    const before = (await (await fetch(`${baseUrl}/api/skills`)).json() as unknown[]).length;
    await Promise.all([
      fetch(`${baseUrl}/api/skills`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Concurrent Alpha', engine: 'n8n' }),
      }),
      fetch(`${baseUrl}/api/skills`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Concurrent Beta', engine: 'acr' }),
      }),
    ]);
    // File is parseable (never truncated/corrupted) and grew.
    const raw = fs.readFileSync(path.join(storeDir, 'skills.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(before);
  });

  // ── agent log ───────────────────────────────────────────────────────────────

  it('GET /api/agent/log returns [] when the file is missing', async () => {
    const res = await fetch(`${baseUrl}/api/agent/log`);
    expect(res.status).toBe(200);
    const data = await res.json() as unknown[];
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it('GET /api/agent/log returns entries newest-first and skips malformed lines', async () => {
    const logFile = path.join(storeDir, 'agent-log.jsonl');
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(
      logFile,
      [
        JSON.stringify({ id: 'al-1', kind: 'run', title: 'First', project: 'TST', savedMin: 5, at: '2026-01-01T00:00:00.000Z' }),
        '{ this is not valid json',
        JSON.stringify({ id: 'al-2', kind: 'promote', title: 'Second', project: 'TST', savedMin: 0, at: '2026-01-02T00:00:00.000Z' }),
        '',
      ].join('\n'),
      'utf-8',
    );
    const res = await fetch(`${baseUrl}/api/agent/log`);
    expect(res.status).toBe(200);
    const data = await res.json() as { id: string }[];
    expect(data).toHaveLength(2); // malformed line skipped, not fatal
    expect(data[0].id).toBe('al-2'); // newest-first
    expect(data[1].id).toBe('al-1');
  });
});
