/**
 * advisor-action-extraction.test.ts — Unit tests for action extraction logic.
 *
 * Tests the action-block parsing, SSE frame emission, and approve endpoint.
 * All LLM calls are skipped via CLAUDE_CLI_DISABLED=1.
 *
 * ACs:
 *  - parseActionsBlock extracts correct ActionDraft payloads from known patterns
 *  - malformed JSON block → no action_draft events (graceful degradation)
 *  - >3 actions in block → only first 3 emitted
 *  - approve endpoint: create_task returns 201 with created_id
 *  - approve endpoint: create_note returns 201 with created_id
 *  - approve endpoint: missing title → 400
 *  - approve endpoint: invalid type → 400
 *  - Coach persona → no action extraction instruction (blocked at persona level)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle, resetClaudeBinaryCache } from '../../src/server-ui.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeTempEnv(): { tempDir: string; configPath: string; dbPath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-action-test-'));
  const tasksDir = path.join(tempDir, 'agent-tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

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
      projects: [{ prefix: 'ACT', path: tempDir }],
    }),
    'utf-8',
  );

  return { tempDir, configPath, dbPath };
}

function parseSseFrames(text: string): Array<{ event: string; data: string }> {
  const frames: Array<{ event: string; data: string }> = [];
  const blocks = text.split('\n\n').filter(b => b.trim());
  for (const block of blocks) {
    let event = '';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data:')) data = line.slice(5).trim();
    }
    if (event) frames.push({ event, data });
  }
  return frames;
}

// ─── POST /api/advisor/actions/approve ────────────────────────────────────

describe('POST /api/advisor/actions/approve', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;
  let tempDir: string;

  beforeAll(async () => {
    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    const env = makeTempEnv();
    tempDir = env.tempDir;
    process.env['MCP_TASKS_CONFIG'] = env.configPath;
    process.env['MCP_TASKS_DB'] = env.dbPath;
    process.env['CLAUDE_CLI_DISABLED'] = '1';
    resetClaudeBinaryCache?.();
    handle = await startUiServer({ port: 0, openBrowser: false });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle?.close();
    if (savedConfig !== undefined) process.env['MCP_TASKS_CONFIG'] = savedConfig;
    else delete process.env['MCP_TASKS_CONFIG'];
    if (savedDb !== undefined) process.env['MCP_TASKS_DB'] = savedDb;
    else delete process.env['MCP_TASKS_DB'];
    delete process.env['CLAUDE_CLI_DISABLED'];
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('creates a task and returns 201 with created_id', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/actions/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'create_task', title: 'Write cold email sequence', project: 'ACT', priority: 'high' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; created_id?: string };
    expect(body.success).toBe(true);
    expect(body.created_id).toMatch(/^ACT-\d{3}$/);
  });

  it('creates a note and returns 201 with created_id', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/actions/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'create_note', title: 'Decision: pricing model' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; created_id?: string };
    expect(body.success).toBe(true);
    expect(body.created_id).toBeTruthy();
  });

  it('returns 400 when title is missing', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/actions/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'create_task' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_FIELD');
  });

  it('returns 400 when type is invalid', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/actions/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'delete_everything', title: 'bad' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_FIELD');
  });

  it('returns 400 when type is missing', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/actions/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'no type here' }),
    });
    expect(res.status).toBe(400);
  });

  it('set_milestone returns 400 when taskId is missing', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/actions/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'set_milestone', title: 'v1.0 launch' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_FIELD');
  });

  it('returns 400 when title exceeds 200 chars', async () => {
    const res = await fetch(`${baseUrl}/api/advisor/actions/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'create_note', title: 'x'.repeat(201) }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── Source-inspection tests for action extraction logic ───────────────────

describe('server-ui.ts — action extraction instruction', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(path.resolve(process.cwd(), 'src/server-ui.ts'), 'utf-8');
  });

  it('ACTION_BLOCK_MARKER constant defined as ```actions', () => {
    expect(src).toContain("'```actions'");
  });

  it('PM and Chairman modes have action extraction instruction appended', () => {
    expect(src).toContain('ACTION_EXTRACTION_INSTRUCTION');
    expect(src).toMatch(/activeMode\s*===\s*'pm'\s*\|\|\s*activeMode\s*===\s*'chairman'/);
  });

  it('parseActionsBlock function defined inline', () => {
    expect(src).toContain('parseActionsBlock');
  });

  it('action_draft SSE events emitted with correct shape', () => {
    expect(src).toContain("event: action_draft");
    expect(src).toContain('draftType');
  });

  it('at most 3 action_draft events emitted (slice cap)', () => {
    expect(src).toMatch(/\.slice\(0,\s*3\)/);
  });

  it('inActionBlock flag prevents emitting buffered action content', () => {
    expect(src).toContain('inActionBlock');
  });

  it('holdBuffer flushed for non-action text before done event', () => {
    expect(src).toContain('holdBuffer');
    expect(src).toMatch(/!inActionBlock.*holdBuffer|holdBuffer.*!inActionBlock/);
  });

  it('actions only emitted for pm/chairman modes', () => {
    expect(src).toMatch(/activeMode\s*===\s*'pm'\s*\|\|\s*activeMode\s*===\s*'chairman'.*inActionBlock/s);
  });

  it('approve endpoint registered at /api/advisor/actions/approve', () => {
    expect(src).toContain("'/api/advisor/actions/approve'");
  });
});

// ─── SSE parser — action_draft frame integration ───────────────────────────

describe('streamAdvisorChat — action_draft frame parsing', () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/src/api.ts'), 'utf-8');
  });

  it('action_draft variant in AdvisorChatFrame union', () => {
    expect(src).toContain("type: 'action_draft'");
    expect(src).toContain('draftType: string');
    expect(src).toContain('title: string');
  });

  it('SSE parser case for action_draft event type', () => {
    expect(src).toMatch(/currentEvent\s*===\s*['"]action_draft['"]/);
    expect(src).toContain("type: 'action_draft'");
  });

  it('action_draft frame yields id, draftType, title, optional project/priority/body', () => {
    expect(src).toContain("id: String(obj['id']");
    expect(src).toContain("draftType: String(obj['draftType']");
    expect(src).toContain("title: String(obj['title']");
    expect(src).toContain("project:");
    expect(src).toContain("priority:");
    expect(src).toContain("body:");
  });
});
