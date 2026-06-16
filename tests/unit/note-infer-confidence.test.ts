/**
 * Unit tests for /api/capture/infer confidence classification paths.
 *
 * These run in their own file so the module-level cachedClaudeBin in server-ui
 * starts fresh (each Vitest worker process = fresh module instances).
 *
 * A tiny mock binary (Node script) reads MOCK_LLM_RESPONSE from the environment
 * and writes it to stdout, letting each test control the simulated LLM output.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { startUiServer, type UiServerHandle } from '../../src/server-ui.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTempEnv(): { tempDir: string; configPath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-infer-conf-'));
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
    projects: [{ prefix: 'GEN', path: tempDir, storage: 'local' }],
  }), 'utf-8');
  return { tempDir, configPath };
}

/** Write a Node.js mock binary that echoes MOCK_LLM_RESPONSE and make it executable. */
function writeMockBinary(dir: string): string {
  const binPath = path.join(dir, 'mock-claude.js');
  fs.writeFileSync(
    binPath,
    '#!/usr/bin/env node\nprocess.stdout.write(process.env.MOCK_LLM_RESPONSE || \'{"intent":"task","confidence":0.0}\')\n',
    { mode: 0o755 },
  );
  return binPath;
}

// ── Confidence path tests ────────────────────────────────────────────────────

describe('POST /api/capture/infer — confidence classification', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let mockBinPath: string;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;
  let savedCliPath: string | undefined;
  let savedCliDisabled: string | undefined;

  beforeAll(async () => {
    const env = makeTempEnv();
    tempDir = env.tempDir;
    mockBinPath = writeMockBinary(tempDir);

    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    savedCliPath = process.env['CLAUDE_CLI_PATH'];
    savedCliDisabled = process.env['CLAUDE_CLI_DISABLED'];

    // Point resolveClaudeBinary() at our mock — must be set BEFORE startUiServer()
    // so the module-level cache picks it up on the first resolution.
    process.env['MCP_TASKS_CONFIG'] = env.configPath;
    process.env['MCP_TASKS_DB'] = path.join(tempDir, 'tasks.db');
    delete process.env['CLAUDE_CLI_DISABLED'];       // ensure mock path wins, not the disabled guard
    process.env['CLAUDE_CLI_PATH'] = mockBinPath;

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG'];
    else process.env['MCP_TASKS_CONFIG'] = savedConfig;
    if (savedDb === undefined) delete process.env['MCP_TASKS_DB'];
    else process.env['MCP_TASKS_DB'] = savedDb;
    if (savedCliPath === undefined) delete process.env['CLAUDE_CLI_PATH'];
    else process.env['CLAUDE_CLI_PATH'] = savedCliPath;
    if (savedCliDisabled === undefined) delete process.env['CLAUDE_CLI_DISABLED'];
    else process.env['CLAUDE_CLI_DISABLED'] = savedCliDisabled;
    delete process.env['MOCK_LLM_RESPONSE'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('confidence ≥ 0.70 — passes intent and confidence through silently (no nudge needed)', async () => {
    process.env['MOCK_LLM_RESPONSE'] = '{"intent":"note","confidence":0.85}';
    const res = await fetch(`${baseUrl}/api/capture/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Strategic context about the new feature direction.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { intent: string; confidence: number };
    expect(data.intent).toBe('note');
    expect(data.confidence).toBeGreaterThanOrEqual(0.70);
    expect(data.confidence).toBeCloseTo(0.85, 2);
  });

  it('confidence < 0.70 — returns low confidence so caller can show nudge banner', async () => {
    process.env['MOCK_LLM_RESPONSE'] = '{"intent":"task","confidence":0.45}';
    const res = await fetch(`${baseUrl}/api/capture/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Maybe this needs doing or maybe it is just a thought.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { intent: string; confidence: number };
    expect(data.intent).toBe('task');
    expect(data.confidence).toBeLessThan(0.70);
    expect(data.confidence).toBeCloseTo(0.45, 2);
  });

  it('clamps confidence to [0, 1] even if LLM returns out-of-range values', async () => {
    process.env['MOCK_LLM_RESPONSE'] = '{"intent":"note","confidence":1.5}';
    const res = await fetch(`${baseUrl}/api/capture/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Definitely a note about strategic priorities.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { intent: string; confidence: number };
    expect(data.confidence).toBe(1);
  });

  it('falls back to { intent: task, confidence: 0 } when LLM returns malformed JSON', async () => {
    process.env['MOCK_LLM_RESPONSE'] = 'not json at all';
    const res = await fetch(`${baseUrl}/api/capture/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Some text to classify.' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { intent: string; confidence: number };
    expect(data.intent).toBe('task');
    expect(data.confidence).toBe(0);
  });
});
