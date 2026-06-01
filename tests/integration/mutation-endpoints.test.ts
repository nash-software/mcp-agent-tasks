/**
 * P4-01 — Task mutation layer HTTP endpoints integration tests.
 *
 * Boots the serve-ui server on an ephemeral port with an isolated temp tasks dir.
 *
 * Covers:
 *  - POST /api/tasks/:id/transition  →  200 in_progress, new transitions[] entry  (AC-1)
 *  - POST /api/tasks/:id/transition  →  409 Done-on-Done                           (AC-2)
 *  - POST /api/tasks/:id/transition  →  400 invalid to value                       (AC-2)
 *  - POST /api/tasks/:id/transition  →  404 unknown id                              (AC-2)
 *  - PATCH /api/tasks/:id            →  200 updated priority/title/estimate         (AC-3)
 *  - PATCH /api/tasks/:id            →  400 status field rejected                   (AC-4)
 *  - PATCH /api/tasks/:id            →  400 invalid priority value                  (AC-4)
 *  - PATCH /api/tasks/:id            →  400 title too long                          (AC-4)
 *  - PATCH /api/tasks/:id            →  404 unknown id                              (AC-4)
 *  - Persistence confirmed via re-read of tasks list after transition/patch
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

interface TaskShape {
  id: string;
  status: string;
  priority: string;
  title: string;
  estimate_hours?: number;
  block_reason?: string;
  claimed_by?: string | null;
  claimed_at?: string | null;
  updated?: string;
  transitions?: Array<{ from: string; to: string; at: string; reason?: string }>;
}

describe('P4-01 — task mutation endpoints (PATCH + /transition)', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-mutation-'));
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
      projects: [{ prefix: 'MUT', path: tempDir, storage: 'local' }],
    }), 'utf-8');

    saved = {
      MCP_TASKS_CONFIG: process.env['MCP_TASKS_CONFIG'],
      MCP_TASKS_DB: process.env['MCP_TASKS_DB'],
      MCP_TASKS_DIR: process.env['MCP_TASKS_DIR'],
    };
    process.env['MCP_TASKS_CONFIG'] = configPath;
    delete process.env['MCP_TASKS_DB'];

    // Seed tasks into the project index.
    const { SqliteIndex } = await import('../../src/store/sqlite-index.js');
    const dbPath = path.join(tasksDir, '.index.db');
    const idx = new SqliteIndex(dbPath);
    idx.init();
    idx.ensureProject('MUT');
    const ts = new Date().toISOString();

    // MUT-001: todo (for transition tests)
    idx.upsertTask({
      schema_version: 1, id: 'MUT-001', title: 'Todo task', type: 'feature',
      status: 'todo', priority: 'medium', project: 'MUT', tags: [], complexity: 1,
      complexity_manual: false, why: 'transition test', created: ts, updated: ts, last_activity: ts,
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
      children: [], dependencies: [], subtasks: [], git: { commits: [] },
      transitions: [], files: [], body: '', file_path: 'MUT-001.md',
    });

    // MUT-002: done (for Done-on-Done guard test)
    idx.upsertTask({
      schema_version: 1, id: 'MUT-002', title: 'Already done task', type: 'chore',
      status: 'done', priority: 'low', project: 'MUT', tags: [], complexity: 1,
      complexity_manual: false, why: '', created: ts, updated: ts, last_activity: ts,
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
      children: [], dependencies: [], subtasks: [], git: { commits: [] },
      transitions: [{ from: 'todo', to: 'done', at: ts }], files: [], body: '', file_path: 'MUT-002.md',
    });

    // MUT-003: todo (for PATCH tests)
    idx.upsertTask({
      schema_version: 1, id: 'MUT-003', title: 'Patchable task', type: 'feature',
      status: 'todo', priority: 'medium', project: 'MUT', tags: [], complexity: 1,
      complexity_manual: false, why: 'original why', created: ts, updated: ts, last_activity: ts,
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
      children: [], dependencies: [], subtasks: [], git: { commits: [] },
      transitions: [], files: [], body: '', file_path: 'MUT-003.md',
    });

    // MUT-004: closed (for P5-05 reopen tests)
    idx.upsertTask({
      schema_version: 1, id: 'MUT-004', title: 'Closed task', type: 'feature',
      status: 'closed', priority: 'medium', project: 'MUT', tags: [], complexity: 1,
      complexity_manual: false, why: '', created: ts, updated: ts, last_activity: ts,
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
      children: [], dependencies: [], subtasks: [], git: { commits: [] },
      transitions: [{ from: 'done', to: 'closed', at: ts }], files: [], body: '', file_path: 'MUT-004.md',
    });

    // MUT-005: draft (MCPAT-061 — Promote draft→approved)
    idx.upsertTask({
      schema_version: 1, id: 'MUT-005', title: 'Draft task', type: 'feature',
      status: 'draft', priority: 'medium', project: 'MUT', tags: [], complexity: 1,
      complexity_manual: false, why: '', created: ts, updated: ts, last_activity: ts,
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
      children: [], dependencies: [], subtasks: [], git: { commits: [] },
      transitions: [], files: [], body: '', file_path: 'MUT-005.md',
    });

    // MUT-006: todo (MCPAT-064 — Claim)
    idx.upsertTask({
      schema_version: 1, id: 'MUT-006', title: 'Claimable task', type: 'feature',
      status: 'todo', priority: 'medium', project: 'MUT', tags: [], complexity: 1,
      complexity_manual: false, why: '', created: ts, updated: ts, last_activity: ts,
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
      children: [], dependencies: [], subtasks: [], git: { commits: [] },
      transitions: [], files: [], body: '', file_path: 'MUT-006.md',
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

  // ── POST /api/tasks/:id/transition ───────────────────────────────────────

  it('AC-1: POST /transition todo→in_progress returns 200 with new status and transitions entry', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-001/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'in_progress' }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as TaskShape;
    expect(task.id).toBe('MUT-001');
    expect(task.status).toBe('in_progress');
    expect(task.transitions).toBeDefined();
    expect(task.transitions!.length).toBeGreaterThan(0);
    const last = task.transitions![task.transitions!.length - 1];
    expect(last.from).toBe('todo');
    expect(last.to).toBe('in_progress');
  });

  it('AC-1: Persistence confirmed — re-read via GET /api/tasks shows in_progress', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    const tasks = await res.json() as TaskShape[];
    const t = tasks.find(t => t.id === 'MUT-001');
    expect(t).toBeDefined();
    expect(t!.status).toBe('in_progress');
  });

  it('AC-2: Done-on-Done returns 409 INVALID_TRANSITION', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-002/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'done' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_TRANSITION');
  });

  it('AC-2: Invalid to value returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-001/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'bogus' }),
    });
    expect(res.status).toBe(400);
  });

  it('AC-2: Missing to field returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-001/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('AC-2: Unknown task id returns 404 TASK_NOT_FOUND', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-999/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'in_progress' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('TASK_NOT_FOUND');
  });

  it('AC-2: No path returns 200 on a rejected transition — guard is server-enforced', async () => {
    // Done-on-Done must be 409, confirming server enforces the guard
    const res1 = await fetch(`${baseUrl}/api/tasks/MUT-002/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'done' }),
    });
    expect(res1.status).not.toBe(200);

    // archived is a terminal state — no transitions allowed
    const res2 = await fetch(`${baseUrl}/api/tasks/MUT-002/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'todo' }),  // done→todo is invalid
    });
    expect(res2.status).not.toBe(200);
  });

  it('P5-05: closed→done → 409 INVALID_TRANSITION, state preserved as closed', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-004/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'done' }),
    });
    expect(res.status).toBe(409);
    // MUT-004 must still be closed after the rejected transition
    const tasks = await (await fetch(`${baseUrl}/api/tasks`)).json() as TaskShape[];
    expect(tasks.find(t => t.id === 'MUT-004')?.status).toBe('closed');
  });

  it('P5-05: reopen a closed task → 200 in_progress, persisted', async () => {
    const reopen = await fetch(`${baseUrl}/api/tasks/MUT-004/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'in_progress' }),
    });
    expect(reopen.status).toBe(200);
    const task = await reopen.json() as TaskShape;
    expect(task.status).toBe('in_progress');
    // AC2: a new transition entry is appended (from closed → in_progress)
    expect(task.transitions?.some(t => t.from === 'closed' && t.to === 'in_progress')).toBe(true);
    const tasks = await (await fetch(`${baseUrl}/api/tasks`)).json() as TaskShape[];
    expect(tasks.find(t => t.id === 'MUT-004')?.status).toBe('in_progress');
  });

  it('AC-1: Transition includes optional reason in transitions entry', async () => {
    // MUT-001 is now in_progress; transition to blocked with a reason
    const res = await fetch(`${baseUrl}/api/tasks/MUT-001/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'blocked', reason: 'waiting for dependency' }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as TaskShape;
    expect(task.status).toBe('blocked');
    const last = task.transitions![task.transitions!.length - 1];
    expect(last.reason).toBe('waiting for dependency');
  });

  // ── MCPAT-061: Block persists reason→block_reason; Promote; clear-on-leave ──

  it('MCPAT-061: blocking with a reason persists it to block_reason (200 body + re-read)', async () => {
    // MUT-001 was blocked with 'waiting for dependency' in the test above.
    const res = await fetch(`${baseUrl}/api/tasks/MUT-001/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'in_progress' }), // make a clean round: resume first
    });
    expect(res.status).toBe(200);
    // now block again with a fresh reason and assert block_reason
    const blocked = await fetch(`${baseUrl}/api/tasks/MUT-001/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'blocked', reason: 'blocked on review' }),
    });
    expect(blocked.status).toBe(200);
    expect((await blocked.json() as TaskShape).block_reason).toBe('blocked on review');
    const tasks = await (await fetch(`${baseUrl}/api/tasks`)).json() as TaskShape[];
    expect(tasks.find(t => t.id === 'MUT-001')?.block_reason).toBe('blocked on review');
  });

  it('MCPAT-061: leaving blocked clears block_reason (200 body + re-read)', async () => {
    // MUT-001 is blocked with 'blocked on review' from the previous test.
    const res = await fetch(`${baseUrl}/api/tasks/MUT-001/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'in_progress' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as TaskShape).block_reason).toBeUndefined();
    const tasks = await (await fetch(`${baseUrl}/api/tasks`)).json() as TaskShape[];
    expect(tasks.find(t => t.id === 'MUT-001')?.block_reason).toBeUndefined();
  });

  it('MCPAT-061: Promote draft→approved is accepted (200, not 400)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-005/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'approved' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as TaskShape).status).toBe('approved');
  });

  it('MCPAT-061: Complete done→closed is accepted (200, not 400) — codex F1', async () => {
    // MUT-002 is done. The panel offers "Complete" (done→closed) as the primary; the route must accept it.
    const res = await fetch(`${baseUrl}/api/tasks/MUT-002/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'closed' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as TaskShape).status).toBe('closed');
  });

  it('MCPAT-061: an over-long block reason (>1000 chars) is rejected 400 — security cap', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-001/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'blocked', reason: 'x'.repeat(1001) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });

  // ── MCPAT-064: POST /api/tasks/:id/claim ─────────────────────────────────

  it('MCPAT-064: claiming a todo task sets claimed_by and moves it to in_progress', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-006/claim`, { method: 'POST' });
    expect(res.status).toBe(200);
    const task = await res.json() as TaskShape;
    expect(task.status).toBe('in_progress');
    expect(typeof task.claimed_by).toBe('string');
    expect(task.claimed_by).toBeTruthy();
    // re-read confirms persistence
    const tasks = await (await fetch(`${baseUrl}/api/tasks`)).json() as TaskShape[];
    const back = tasks.find(t => t.id === 'MUT-006');
    expect(back?.status).toBe('in_progress');
    expect(back?.claimed_by).toBeTruthy();
  });

  it('MCPAT-064: re-claiming an already-claimed in_progress task is a true no-op (timestamps + transitions unchanged)', async () => {
    const first = await (await fetch(`${baseUrl}/api/tasks/MUT-006/claim`, { method: 'POST' })).json() as TaskShape;
    const txCount = first.transitions?.length ?? 0;
    const res = await fetch(`${baseUrl}/api/tasks/MUT-006/claim`, { method: 'POST' });
    expect(res.status).toBe(200);
    const second = await res.json() as TaskShape;
    expect(second.status).toBe('in_progress');
    // codex F2/F5: no churn on a same-user re-claim.
    expect(second.claimed_at).toBe(first.claimed_at);
    expect(second.updated).toBe(first.updated);
    expect(second.transitions?.length ?? 0).toBe(txCount);
  });

  it('MCPAT-064: claiming an unknown task → 404', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-999/claim`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('MCPAT-064: claiming a non-claimable status → 409 NOT_CLAIMABLE', async () => {
    // MUT-005 was promoted to 'approved' earlier — not a claimable (todo/in_progress) status.
    const res = await fetch(`${baseUrl}/api/tasks/MUT-005/claim`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('NOT_CLAIMABLE');
  });

  // ── PATCH /api/tasks/:id ─────────────────────────────────────────────────

  it('AC-3: PATCH {priority:"high"} returns 200 with updated priority', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-003`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'high' }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as TaskShape;
    expect(task.id).toBe('MUT-003');
    expect(task.priority).toBe('high');
  });

  it('AC-3: PATCH {title:"Updated title"} returns 200 with updated title', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-003`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated title' }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as TaskShape;
    expect(task.title).toBe('Updated title');
  });

  it('AC-3: PATCH {estimate_hours:2} returns 200 with estimate set', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-003`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estimate_hours: 2 }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as TaskShape;
    expect(task.estimate_hours).toBe(2);
  });

  it('AC-3: Persistence confirmed — re-read via GET /api/tasks shows updated fields', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    const tasks = await res.json() as TaskShape[];
    const t = tasks.find(t => t.id === 'MUT-003');
    expect(t).toBeDefined();
    expect(t!.priority).toBe('high');
    expect(t!.title).toBe('Updated title');
    expect(t!.estimate_hours).toBe(2);
  });

  it('AC-4: PATCH {status:"done"} returns 400 — status must use /transition', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-003`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });

  it('AC-4: PATCH {priority:"urgent"} returns 400 INVALID_FIELD', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-003`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'urgent' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });

  it('AC-4: PATCH {title: 201-char string} returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-003`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(201) }),
    });
    expect(res.status).toBe(400);
  });

  it('AC-4: PATCH unknown id returns 404 TASK_NOT_FOUND', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MUT-999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'high' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('TASK_NOT_FOUND');
  });
});

// ── P4-07: PATCH milestone field ──────────────────────────────────────────────────────────────────

describe('P4-07 — PATCH /api/tasks/:id milestone field (assign / clear / invalid)', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-milestone-'));
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
      projects: [{ prefix: 'MS', path: tempDir, storage: 'local' }],
    }), 'utf-8');

    saved = {
      MCP_TASKS_CONFIG: process.env['MCP_TASKS_CONFIG'],
      MCP_TASKS_DB: process.env['MCP_TASKS_DB'],
    };
    process.env['MCP_TASKS_CONFIG'] = configPath;
    delete process.env['MCP_TASKS_DB'];

    const { SqliteIndex } = await import('../../src/store/sqlite-index.js');
    const dbPath = path.join(tasksDir, '.index.db');
    const idx = new SqliteIndex(dbPath);
    idx.init();
    idx.ensureProject('MS');
    const ts = new Date().toISOString();

    // MS-001: task for milestone assignment tests
    idx.upsertTask({
      schema_version: 1, id: 'MS-001', title: 'Milestone task', type: 'feature',
      status: 'todo', priority: 'medium', project: 'MS', tags: [], complexity: 1,
      complexity_manual: false, why: 'milestone test', created: ts, updated: ts, last_activity: ts,
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
      children: [], dependencies: [], subtasks: [], git: { commits: [] },
      transitions: [], files: [], body: '', file_path: 'MS-001.md',
    });

    // MS-002: task for milestone clear test
    idx.upsertTask({
      schema_version: 1, id: 'MS-002', title: 'Pre-linked task', type: 'chore',
      status: 'todo', priority: 'low', project: 'MS', tags: [], complexity: 1,
      complexity_manual: false, why: '', created: ts, updated: ts, last_activity: ts,
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
      children: [], dependencies: [], subtasks: [], git: { commits: [] },
      transitions: [], files: [], body: '', file_path: 'MS-002.md',
      milestone: 'MS-ms-existing',
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

  it('AC-1: PATCH {milestone:"MS-ms-1"} sets the milestone field and returns 200', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MS-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestone: 'MS-ms-1' }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as { id: string; milestone?: string };
    expect(task.id).toBe('MS-001');
    expect(task.milestone).toBe('MS-ms-1');
  });

  it('AC-1: Persistence confirmed — re-read via GET /api/tasks shows milestone set', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    const tasks = await res.json() as Array<{ id: string; milestone?: string }>;
    const t = tasks.find(t => t.id === 'MS-001');
    expect(t).toBeDefined();
    expect(t!.milestone).toBe('MS-ms-1');
  });

  it('AC-1: PATCH {milestone:null} clears the milestone field', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MS-002`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestone: null }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as { id: string; milestone?: string };
    expect(task.id).toBe('MS-002');
    // milestone should be absent or null/undefined after clear
    expect(task.milestone ?? null).toBeNull();
  });

  it('AC-1: Persistence confirmed — re-read shows milestone cleared on MS-002', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    const tasks = await res.json() as Array<{ id: string; milestone?: string | null }>;
    const t = tasks.find(t => t.id === 'MS-002');
    expect(t).toBeDefined();
    expect(t!.milestone ?? null).toBeNull();
  });

  it('AC-2: PATCH {milestone:42} returns 400 INVALID_FIELD (non-string, non-null)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MS-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestone: 42 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });

  it('AC-2: PATCH unknown task id returns 404 TASK_NOT_FOUND', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/MS-999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestone: 'MS-ms-1' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('TASK_NOT_FOUND');
  });
});

interface ClosedTaskShape { id: string; status: string; close_batch?: string; estimate_hours?: number }
interface BatchResp { batch: string; closed: number; tasks: ClosedTaskShape[]; totalEstimateHours: number }

describe('P4-02 — batch close (Complete all → Completed)', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-closebatch-'));
    const tasksDir = path.join(tempDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1, storageDir: tasksDir, defaultStorage: 'local', enforcement: 'off',
      autoCommit: false, claimTtlHours: 4, trackManifest: false, tasksDirName: 'agent-tasks',
      projects: [{ prefix: 'CB', path: tempDir, storage: 'local' }],
    }), 'utf-8');
    saved = { MCP_TASKS_CONFIG: process.env['MCP_TASKS_CONFIG'], MCP_TASKS_DB: process.env['MCP_TASKS_DB'] };
    process.env['MCP_TASKS_CONFIG'] = configPath;
    delete process.env['MCP_TASKS_DB'];

    const { SqliteIndex } = await import('../../src/store/sqlite-index.js');
    const idx = new SqliteIndex(path.join(tasksDir, '.index.db'));
    idx.init();
    idx.ensureProject('CB');
    const ts = new Date().toISOString();
    const base = {
      schema_version: 1 as const, type: 'feature' as const, priority: 'medium' as const,
      project: 'CB', tags: [], complexity: 1, complexity_manual: false, why: '',
      created: ts, updated: ts, last_activity: ts, claimed_by: null, claimed_at: null,
      claim_ttl_hours: 4, parent: null, children: [], dependencies: [], subtasks: [],
      git: { commits: [] }, transitions: [], files: [], body: '',
    };
    idx.upsertTask({ ...base, id: 'CB-001', title: 'done a', status: 'done', estimate_hours: 2, file_path: 'CB-001.md' });
    idx.upsertTask({ ...base, id: 'CB-002', title: 'done b', status: 'done', estimate_hours: 3, file_path: 'CB-002.md' });
    idx.upsertTask({ ...base, id: 'CB-003', title: 'still todo', status: 'todo', file_path: 'CB-003.md' });
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

  it('closes every done task into one batch and leaves non-done untouched', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/close-batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    const body = await res.json() as BatchResp;
    expect(body.closed).toBe(2);
    expect(body.batch).not.toBe('');
    expect(body.totalEstimateHours).toBe(5);
    // both done tasks share the same close_batch id
    expect(new Set(body.tasks.map(t => t.close_batch)).size).toBe(1);
    expect(body.tasks.every(t => t.status === 'closed')).toBe(true);
  });

  it('persists: done→closed, todo untouched', async () => {
    const tasks = await (await fetch(`${baseUrl}/api/tasks`)).json() as ClosedTaskShape[];
    expect(tasks.find(t => t.id === 'CB-001')?.status).toBe('closed');
    expect(tasks.find(t => t.id === 'CB-002')?.status).toBe('closed');
    expect(tasks.find(t => t.id === 'CB-003')?.status).toBe('todo');
  });

  it('is idempotent — a second close-batch with no done tasks is a 0-count no-op', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/close-batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    const body = await res.json() as BatchResp;
    expect(body.closed).toBe(0);
  });
});

// ── P5-03: PATCH area / tags / type fields ────────────────────────────────────

interface P503TaskShape {
  id: string;
  area?: string;
  tags?: string[];
  type?: string;
  project?: string;
  status?: string;
}

describe('P5-03 — PATCH area/tags/type fields', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-p503-'));
    const tasksDir = path.join(tempDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

    const configPath = path.join(tempDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1, storageDir: tasksDir, defaultStorage: 'local', enforcement: 'off',
      autoCommit: false, claimTtlHours: 4, trackManifest: false, tasksDirName: 'agent-tasks',
      projects: [{ prefix: 'P5', path: tempDir, storage: 'local' }],
    }), 'utf-8');

    saved = {
      MCP_TASKS_CONFIG: process.env['MCP_TASKS_CONFIG'],
      MCP_TASKS_DB: process.env['MCP_TASKS_DB'],
    };
    process.env['MCP_TASKS_CONFIG'] = configPath;
    delete process.env['MCP_TASKS_DB'];

    const { SqliteIndex } = await import('../../src/store/sqlite-index.js');
    const dbPath = path.join(tasksDir, '.index.db');
    const idx = new SqliteIndex(dbPath);
    idx.init();
    idx.ensureProject('P5');
    const ts = new Date().toISOString();

    // P5-001: task for area/tags/type tests
    idx.upsertTask({
      schema_version: 1, id: 'P5-001', title: 'Field editing task', type: 'feature',
      status: 'todo', priority: 'medium', project: 'P5', tags: [], complexity: 1,
      complexity_manual: false, why: 'p5-03 test', created: ts, updated: ts, last_activity: ts,
      claimed_by: null, claimed_at: null, claim_ttl_hours: 4, parent: null,
      children: [], dependencies: [], subtasks: [], git: { commits: [] },
      transitions: [], files: [], body: '', file_path: 'P5-001.md',
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

  // ── area ─────────────────────────────────────────────────────────────────

  it('AC-1: PATCH {area:"client"} returns 200 with updated area', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/P5-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'client' }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as P503TaskShape;
    expect(task.id).toBe('P5-001');
    expect(task.area).toBe('client');
  });

  it('AC-1: Persistence confirmed — GET /api/tasks shows area=client', async () => {
    const tasks = await (await fetch(`${baseUrl}/api/tasks`)).json() as P503TaskShape[];
    const t = tasks.find(t => t.id === 'P5-001');
    expect(t?.area).toBe('client');
  });

  it('AC-1: PATCH {area:"banana"} returns 400 INVALID_FIELD', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/P5-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'banana' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });

  // ── tags ─────────────────────────────────────────────────────────────────

  it('AC-2: PATCH {tags:["x","y"]} returns 200 and persists tags', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/P5-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['x', 'y'] }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as P503TaskShape;
    expect(task.tags).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('AC-2: Persistence confirmed — GET /api/tasks shows tags set', async () => {
    const tasks = await (await fetch(`${baseUrl}/api/tasks`)).json() as P503TaskShape[];
    const t = tasks.find(t => t.id === 'P5-001');
    expect(t?.tags).toEqual(expect.arrayContaining(['x', 'y']));
  });

  it('AC-2: PATCH {tags:[...21 items]} returns 400 over-cap', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/P5-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: Array.from({ length: 21 }, (_, i) => `tag${i}`) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });

  it('AC-2: PATCH {tags:[""]} returns 400 (blank/empty tag)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/P5-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: [''] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });

  it('AC-2: PATCH a tag containing a control character (NUL) returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/P5-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['ok', `bad${String.fromCharCode(0)}tag`] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });

  // ── milestone length cap ───────────────────────────────────────────────────

  it('AC-8: PATCH an over-long milestone id (>200 chars) returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/P5-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestone: 'x'.repeat(201) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });

  // ── type ──────────────────────────────────────────────────────────────────

  it('AC-3: PATCH {type:"bug"} returns 200 with updated type', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/P5-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'bug' }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as P503TaskShape;
    expect(task.type).toBe('bug');
  });

  it('AC-3: PATCH {type:"invalid"} returns 400 INVALID_FIELD', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/P5-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invalid' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });

  it('AC-3: Persistence confirmed — GET /api/tasks shows type=bug', async () => {
    const tasks = await (await fetch(`${baseUrl}/api/tasks`)).json() as P503TaskShape[];
    const t = tasks.find(t => t.id === 'P5-001');
    expect(t?.type).toBe('bug');
  });

  // ── reject project/status ────────────────────────────────────────────────

  it('AC-4: PATCH {project:"MCPAT"} returns 400 INVALID_FIELD', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/P5-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'MCPAT' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });

  it('AC-4: PATCH {status:"done"} returns 400 INVALID_FIELD', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/P5-001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/INVALID_FIELD/);
  });
});
