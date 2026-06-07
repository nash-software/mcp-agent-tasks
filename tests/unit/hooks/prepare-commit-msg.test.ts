/**
 * Unit tests for hooks/prepare-commit-msg.js (B-AC1)
 *
 * Tests the hook by invoking it directly with a temp message file
 * and a controlled GIT_BRANCH env var injected into the child process.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.resolve(__dirname, '../../../hooks/prepare-commit-msg.js');

/** Run the hook with a given message and branch, return resulting message. */
function runHook(msg: string, branch: string, source?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pcm-test-'));
  const msgFile = join(dir, 'COMMIT_EDITMSG');
  writeFileSync(msgFile, msg, 'utf-8');

  // The hook calls `git branch --show-current` internally.
  // We can't easily inject a branch via env, so we test the regex logic
  // by using a wrapper approach: stub out execSync via a monkey-patch temp script.
  // Instead, test the hook's branch extraction regex directly by patching git.

  // Simpler: create a tiny wrapper that sets a fake git command.
  const stubGit = join(dir, 'git');
  writeFileSync(stubGit, `#!/bin/sh\necho "${branch}"\n`, 'utf-8');
  execFileSync('chmod', ['+x', stubGit]);

  const args = [HOOK_PATH, msgFile, ...(source ? [source] : [])];
  try {
    execFileSync('node', args, {
      env: { ...process.env, PATH: `${dir}:${process.env['PATH'] ?? ''}` },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // hook exits 0 always; if it errors, readFileSync still returns original
  }

  const result = readFileSync(msgFile, 'utf-8');
  try { unlinkSync(stubGit); } catch { /* ignore */ }
  try { unlinkSync(msgFile); } catch { /* ignore */ }
  return result;
}

describe('prepare-commit-msg — branch extraction (B-AC1)', () => {
  it('stamps [MCPAT-081] from feat/MCPAT-081-my-feature branch', () => {
    const result = runHook('do the thing', 'feat/MCPAT-081-my-feature');
    expect(result).toMatch(/^\[MCPAT-081\] do the thing/);
  });

  it('stamps from fix/ prefix branch', () => {
    const result = runHook('fix null ptr', 'fix/PROJ-042-null-ptr-crash');
    expect(result).toMatch(/^\[PROJ-042\] fix null ptr/);
  });

  it('stamps from chore/ prefix branch', () => {
    const result = runHook('update deps', 'chore/HBOOK-010-deps-update');
    expect(result).toMatch(/^\[HBOOK-010\] update deps/);
  });

  it('stamps from refactor/ prefix branch', () => {
    const result = runHook('restructure module', 'refactor/ACR-007-module-split');
    expect(result).toMatch(/^\[ACR-007\] restructure module/);
  });

  it('stamps from docs/ prefix branch', () => {
    const result = runHook('update readme', 'docs/MCPAT-081-readme');
    expect(result).toMatch(/^\[MCPAT-081\] update readme/);
  });

  it('stamps from test/ prefix branch', () => {
    const result = runHook('add coverage', 'test/MCPAT-055-coverage');
    expect(result).toMatch(/^\[MCPAT-055\] add coverage/);
  });

  it('no-op for branch with no typed prefix (main branch)', () => {
    const result = runHook('random commit', 'main');
    expect(result).toBe('random commit');
  });

  it('no-op for untyped branch with task id but no prefix', () => {
    const result = runHook('random commit', 'MCPAT-081-something');
    expect(result).toBe('random commit');
  });

  it('no-op for feature branch without task ID (e.g. feat/my-feature)', () => {
    const result = runHook('do the thing', 'feat/my-feature-no-id');
    expect(result).toBe('do the thing');
  });

  it('idempotent: already-stamped message is not double-stamped', () => {
    const result = runHook('[MCPAT-081] already stamped', 'feat/MCPAT-081-my-feature');
    expect(result).toBe('[MCPAT-081] already stamped');
    expect(result.match(/\[MCPAT-081\]/g)?.length).toBe(1);
  });

  it('idempotent: any existing [PREFIX-NNN] stamp blocks re-stamp', () => {
    // Message carries a different ID than branch extracts — still no double-stamp
    const result = runHook('[OTHER-999] some message', 'feat/MCPAT-081-my-feature');
    expect(result).toBe('[OTHER-999] some message');
  });

  it('no-op when source is "merge"', () => {
    const result = runHook('Merge branch xyz', 'feat/MCPAT-081-my-feature', 'merge');
    expect(result).toBe('Merge branch xyz');
  });

  it('no-op when source is "squash"', () => {
    const result = runHook('Squash commit', 'feat/MCPAT-081-my-feature', 'squash');
    expect(result).toBe('Squash commit');
  });
});
