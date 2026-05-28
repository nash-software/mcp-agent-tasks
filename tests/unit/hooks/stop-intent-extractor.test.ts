/**
 * Tests for hooks/stop-intent-extractor.js
 * Spawns the hook as a child process with env overrides for isolation.
 *
 * Pattern mirrors tests/unit/hooks/passive-capture.test.ts
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const HOOK_PATH = path.resolve('hooks/stop-intent-extractor.js');

/**
 * A tiny sentinel binary script that, when invoked, writes to stderr to signal
 * it was called. Used to verify no LLM is invoked in noise-filter scenarios.
 */
const SENTINEL_BINARY_PATH = path.join(os.tmpdir(), `sentinel-binary-${Date.now()}.js`);

// Write the sentinel script once before tests run
fs.writeFileSync(
  SENTINEL_BINARY_PATH,
  `#!/usr/bin/env node
process.stderr.write('SENTINEL_INVOKED\\n');
process.exit(0);
`,
  { encoding: 'utf-8' },
);

/** Temp JSONL files created during tests — cleaned up in afterEach */
const tempFiles: string[] = [];

afterEach(() => {
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  tempFiles.length = 0;
});

/**
 * Write a JSONL transcript fixture to a temp file.
 * Returns the file path.
 */
function writeTempJsonl(entries: Array<{ role: string; content: string }>): string {
  const filePath = path.join(os.tmpdir(), `stop-intent-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
  tempFiles.push(filePath);
  return filePath;
}

function makeTranscript(count: number): Array<{ role: string; content: string }> {
  const entries: Array<{ role: string; content: string }> = [];
  for (let i = 0; i < count; i++) {
    entries.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` });
  }
  return entries;
}

/**
 * Build the real Stop event payload shape that Claude Code sends.
 */
function makeStopPayload(transcriptPath: string, cwd = '/some/project'): Record<string, unknown> {
  return {
    transcript_path: transcriptPath,
    cwd,
    hook_event_name: 'Stop',
    stop_hook_active: true,
  };
}

function runHook(
  stdinData: unknown,
  env: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: typeof stdinData === 'string' ? stdinData : JSON.stringify(stdinData),
    encoding: 'utf-8',
    env: {
      ...process.env,
      // Point to a nonexistent config so routing fails gracefully without side effects
      MCP_TASKS_CONFIG: path.join(os.tmpdir(), `no-config-${Date.now()}`, 'config.json'),
      ...env,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

describe('stop-intent-extractor hook', () => {
  it('MCP_TASKS_STOP_HOOK_DISABLED=1 → exits 0, no stderr output', () => {
    const transcriptPath = writeTempJsonl(makeTranscript(6));
    const payload = makeStopPayload(transcriptPath);
    const result = runHook(payload, { MCP_TASKS_STOP_HOOK_DISABLED: '1' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('empty stdin → exits 0 silently', () => {
    const result = runHook('');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('malformed JSON stdin → exits 0 silently', () => {
    const result = runHook('not valid json {{{{');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('payload > 512 KB → exits 0 silently (N3 guard)', () => {
    // Build a payload slightly over 512 KB
    const bigContent = 'x'.repeat(512 * 1024 + 100);
    const result = runHook(bigContent);
    expect(result.status).toBe(0);
    // No stderr since we exit before parsing
    expect(result.stderr).toBe('');
  });

  it('missing transcript_path and no transcript field → exits 0 silently (AC-10)', () => {
    const payload = { cwd: '/some/project', hook_event_name: 'Stop', stop_hook_active: true }; // no transcript_path or transcript
    const result = runHook(payload, {
      MCP_TASKS_CLAUDE_BINARY: SENTINEL_BINARY_PATH,
    });
    expect(result.status).toBe(0);
    // No LLM should be called — sentinel must not appear in stderr
    expect(result.stderr).not.toContain('SENTINEL_INVOKED');
  });

  it('transcript_path points to nonexistent file → exits 0 with stderr warning', () => {
    const payload = makeStopPayload('/tmp/does-not-exist-zxqwerty.jsonl');
    const result = runHook(payload, {
      MCP_TASKS_CLAUDE_BINARY: SENTINEL_BINARY_PATH,
    });
    expect(result.status).toBe(0);
    // Should log a warning to stderr about the missing file
    expect(result.stderr).toContain('[stop-intent] could not read transcript_path');
    // No LLM call
    expect(result.stderr).not.toContain('SENTINEL_INVOKED');
  });

  it('transcript_path with < 4 entries → exits 0, no LLM call (AC-7)', () => {
    const transcriptPath = writeTempJsonl(makeTranscript(3)); // only 3 entries — below threshold
    const payload = makeStopPayload(transcriptPath);
    const result = runHook(payload, {
      MCP_TASKS_CLAUDE_BINARY: SENTINEL_BINARY_PATH,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('SENTINEL_INVOKED');
  });

  it('transcript_path with invalid entry shapes → malformed entries filtered (AC-11); hook exits 0', () => {
    // Mix of valid + invalid entries — total valid below 4 threshold → exits without LLM
    const transcriptPath = writeTempJsonl([
      { role: 'user', content: 'Valid user message' },
      { role: 'assistant', content: 'Valid assistant message' },
      { role: 'invalid-role', content: 'Should be filtered' }, // invalid role
    ]);
    // Also manually add malformed lines to the JSONL
    const raw = fs.readFileSync(transcriptPath, 'utf-8');
    fs.writeFileSync(transcriptPath, raw + 'null\n42\n{"content":"missing role"}\n', 'utf-8');

    const payload = makeStopPayload(transcriptPath);
    const result = runHook(payload, {
      MCP_TASKS_CLAUDE_BINARY: SENTINEL_BINARY_PATH,
    });
    expect(result.status).toBe(0);
    // After filtering, only 2 valid entries remain (< 4) → no LLM call
    expect(result.stderr).not.toContain('SENTINEL_INVOKED');
  });

  it('all-assistant transcript (via transcript_path) → exits 0 silently', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      role: 'assistant',
      content: `Message ${i}`,
    }));
    const transcriptPath = writeTempJsonl(entries);
    const payload = makeStopPayload(transcriptPath);
    const result = runHook(payload, {
      MCP_TASKS_CLAUDE_BINARY: SENTINEL_BINARY_PATH,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('SENTINEL_INVOKED');
  });

  // ── Legacy fallback path (test-harness / forward compat) ─────────────────────
  // These tests verify that the hook still accepts a raw `transcript` array in
  // the payload (no transcript_path), for use in automated test harnesses that
  // cannot write temp JSONL files.

  it('[legacy] transcript array in payload (no transcript_path) < 4 entries → exits 0, no LLM call', () => {
    const payload = {
      transcript: makeTranscript(3),
      cwd: '/some/project',
    };
    const result = runHook(payload, {
      MCP_TASKS_CLAUDE_BINARY: SENTINEL_BINARY_PATH,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('SENTINEL_INVOKED');
  });

  it('[legacy] all-assistant transcript array (no transcript_path) → exits 0 silently', () => {
    const payload = {
      transcript: [
        { role: 'assistant', content: 'Message 1' },
        { role: 'assistant', content: 'Message 2' },
        { role: 'assistant', content: 'Message 3' },
        { role: 'assistant', content: 'Message 4' },
        { role: 'assistant', content: 'Message 5' },
      ],
      cwd: '/some/project',
    };
    const result = runHook(payload, {
      MCP_TASKS_CLAUDE_BINARY: SENTINEL_BINARY_PATH,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('SENTINEL_INVOKED');
  });
});
