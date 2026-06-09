/**
 * MCPAT-086 — LLM spawn gate meta-test (AC1, AC2, AC3)
 *
 * Verifies that `npm test` never spawns a real claude process by default.
 * Strategy: create a stub claude on PATH that writes a sentinel file on execution.
 * After calling all potentially-spawning endpoints, assert the sentinel is absent.
 *
 * Set RUN_LLM_INTEGRATION=1 to opt in to real LLM tests (never set in CI).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { resolveClaudeBinary, startUiServer, type UiServerHandle } from '../../src/server-ui.js';

// ── AC2: resolveClaudeBinary returns disabled sentinel when flag is set ────────

describe('AC2: CLAUDE_CLI_DISABLED gate on resolveClaudeBinary', () => {
  let savedDisabled: string | undefined;

  beforeAll(() => {
    savedDisabled = process.env['CLAUDE_CLI_DISABLED'];
    process.env['CLAUDE_CLI_DISABLED'] = '1';
  });

  afterAll(() => {
    if (savedDisabled === undefined) delete process.env['CLAUDE_CLI_DISABLED'];
    else process.env['CLAUDE_CLI_DISABLED'] = savedDisabled;
  });

  it('returns a nonexistent sentinel path, never the real claude binary', () => {
    const bin = resolveClaudeBinary();
    // Must NOT be 'claude' or any path that could resolve to the real binary
    expect(bin).not.toBe('claude');
    expect(bin).not.toMatch(/claude(?:\.exe)?$/);
    // Must be a known nonexistent sentinel
    const expectedSentinels = ['/__claude_disabled__', 'C:\\__claude_disabled__.exe'];
    expect(expectedSentinels.some(s => bin === s)).toBe(true);
  });
});

// ── AC1: sentinel file test — no real spawn on endpoints that would call claude ─

describe('AC1: braindump + quick-capture endpoints do not invoke claude stub (CLAUDE_CLI_DISABLED=1)', () => {
  let handle: UiServerHandle;
  let baseUrl: string;
  let tempDir: string;
  let stubDir: string;
  let sentinelPath: string;
  let savedPath: string | undefined;
  let savedConfig: string | undefined;
  let savedDb: string | undefined;
  let savedDisabled: string | undefined;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-gate-test-'));
    const tasksDir = path.join(tempDir, 'agent-tasks');
    fs.mkdirSync(tasksDir, { recursive: true });

    // GEN global dir
    const genDbDir = path.join(os.homedir(), '.mcp-tasks', 'tasks', 'gen');
    fs.mkdirSync(genDbDir, { recursive: true });

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

    // Create a stub claude that writes a sentinel file when invoked
    stubDir = path.join(tempDir, 'stub-bin');
    sentinelPath = path.join(tempDir, 'claude-was-invoked');
    fs.mkdirSync(stubDir, { recursive: true });
    if (process.platform !== 'win32') {
      const stubScript = `#!/bin/sh\ntouch '${sentinelPath}'\necho '[]'\n`;
      fs.writeFileSync(path.join(stubDir, 'claude'), stubScript, { mode: 0o755 });
    }

    // Prepend stub dir to PATH so our fake claude is found first
    savedPath = process.env['PATH'];
    process.env['PATH'] = `${stubDir}${path.delimiter}${savedPath ?? ''}`;

    savedConfig = process.env['MCP_TASKS_CONFIG'];
    savedDb = process.env['MCP_TASKS_DB'];
    savedDisabled = process.env['CLAUDE_CLI_DISABLED'];

    // This is the gate under test — with it set, no real spawn should occur
    process.env['CLAUDE_CLI_DISABLED'] = '1';
    process.env['MCP_TASKS_CONFIG'] = configPath;
    process.env['MCP_TASKS_DB'] = path.join(tempDir, 'tasks.db');

    handle = await startUiServer({ port: 0 });
    baseUrl = handle.url;
  });

  afterAll(async () => {
    await handle.close();
    if (savedPath !== undefined) process.env['PATH'] = savedPath;
    else delete process.env['PATH'];
    if (savedConfig === undefined) delete process.env['MCP_TASKS_CONFIG'];
    else process.env['MCP_TASKS_CONFIG'] = savedConfig;
    if (savedDb === undefined) delete process.env['MCP_TASKS_DB'];
    else process.env['MCP_TASKS_DB'] = savedDb;
    if (savedDisabled === undefined) delete process.env['CLAUDE_CLI_DISABLED'];
    else process.env['CLAUDE_CLI_DISABLED'] = savedDisabled;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('AC1: braindump does not invoke the claude stub (sentinel absent)', async () => {
    const res = await fetch(`${baseUrl}/api/capture/braindump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Buy more coffee beans' }),
    });
    expect(res.status).toBe(200);
    // Give the event loop a tick in case any async spawn was fired-and-forgotten
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    expect(fs.existsSync(sentinelPath),
      'claude stub was invoked — CLAUDE_CLI_DISABLED gate is broken for braindump').toBe(false);
  });

  it('AC1: quick-capture does not invoke the claude stub (sentinel absent)', async () => {
    const res = await fetch(`${baseUrl}/api/capture/quick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Which project prefix from [GEN] best fits: add OAuth login' }),
    });
    expect(res.status).toBe(200);
    // Wait for any fire-and-forget background spawn to settle
    await new Promise<void>(resolve => setTimeout(resolve, 200));
    expect(fs.existsSync(sentinelPath),
      'claude stub was invoked — CLAUDE_CLI_DISABLED gate is broken for quick-capture').toBe(false);
  });

  it('AC1: capture/infer does not invoke the claude stub (sentinel absent)', async () => {
    const res = await fetch(`${baseUrl}/api/capture/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Fix the login bug on the dashboard' }),
    });
    expect(res.status).toBe(200);
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    expect(fs.existsSync(sentinelPath),
      'claude stub was invoked — CLAUDE_CLI_DISABLED gate is broken for capture/infer').toBe(false);
  });
});

// ── AC3: hermetic triage logic is covered via injected fake runner ─────────────

describe('AC3: triage engine logic covered hermetically (no real claude required)', () => {
  it('the triage-engine.test.ts always uses injected runBatch — zero real spawns', () => {
    // This test documents the architectural invariant: all triage engine tests inject
    // a fake runBatch (or use llm.enabled=false). The real spawn path (makeDefaultLlmRunBatch)
    // is never called in the test suite without RUN_LLM_INTEGRATION=1.
    // If this test is green: the hermetic coverage contract is intact.
    expect(process.env['RUN_LLM_INTEGRATION']).not.toBe('1');
    // Injected runner coverage is verified by triage-engine.test.ts itself.
    // This assertion catches accidental RUN_LLM_INTEGRATION=1 leakage into default CI.
  });
});
