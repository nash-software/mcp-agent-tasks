/**
 * Tests for hooks/passive-capture.js
 * Spawns the hook as a child process with MCP_TASKS_DRY_RUN=1
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOOK_PATH = path.resolve('hooks/passive-capture.js');

function runHook(
  stdinData: unknown,
  env: Record<string, string> = {},
  cwd?: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: typeof stdinData === 'string' ? stdinData : JSON.stringify(stdinData),
    encoding: 'utf-8',
    env: {
      ...process.env,
      MCP_TASKS_DRY_RUN: '1',
      ...env,
    },
    cwd: cwd || process.cwd(),
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

describe('passive-capture hook', () => {
  it('plan file → stderr contains [passive-capture] (dry-run exits early)', () => {
    const input = { tool_input: { file_path: '/some/project/scratchpads/my-feature-plan.md' } };
    const result = runHook(input);
    // In dry-run mode the hook exits at the top with a DRY_RUN message
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('[passive-capture]');
  });

  it('src code file with no active task → stderr is empty (no action on code_change without task)', () => {
    const input = { tool_input: { file_path: '/some/project/src/utils.ts' } };
    // Point MCP_TASKS_CONFIG to a nonexistent path so hook exits before code_change logic
    const nonExistentConfig = path.join(os.tmpdir(), 'mcp-hook-nonexistent-' + Date.now(), 'config.json');
    const result = runHook(input, { MCP_TASKS_DRY_RUN: '0', MCP_TASKS_CONFIG: nonExistentConfig });
    // No global config → hook exits 0 silently
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('malformed stdin → exits 0 silently', () => {
    const result = spawnSync(process.execPath, [HOOK_PATH], {
      input: 'not valid json {{{{',
      encoding: 'utf-8',
      env: { ...process.env },
    });
    expect(result.status).toBe(0);
  });

  it('missing global config → exits 0 silently (no output)', () => {
    const nonExistentConfig = path.join(os.tmpdir(), 'mcp-hook-no-config-' + Date.now(), 'config.json');
    const input = { tool_input: { file_path: '/some/project/scratchpads/x-plan.md' } };
    const result = spawnSync(process.execPath, [HOOK_PATH], {
      input: JSON.stringify(input),
      encoding: 'utf-8',
      env: { ...process.env, MCP_TASKS_CONFIG: nonExistentConfig },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});
