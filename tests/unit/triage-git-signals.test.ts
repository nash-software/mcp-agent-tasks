/**
 * Unit tests for probeMerge (src/triage/git-signals.ts) using an injected
 * command runner — no real git/gh invocation.
 */
import { describe, it, expect } from 'vitest';
import { probeMerge, type CmdRunner } from '../../src/triage/git-signals.js';
import type { Task } from '../../src/types/task.js';

function task(over: Partial<Task['git']> = {}, base?: string): Task {
  return {
    id: 'MCPAT-001', title: 't', type: 'feature', status: 'in_progress', priority: 'medium',
    project: 'MCPAT', tags: [], complexity: 1, why: '', created: '', updated: '', last_activity: '',
    claimed_by: null, claimed_at: null, claim_ttl_hours: 4, transitions: [],
    git: {
      commits: [], ...over,
      ...(base ? { pr: { number: 5, url: '', title: '', state: 'open', merged_at: null, base_branch: base } } : {}),
    },
    body: '', file_path: '', scheduled_for: null,
  } as Task;
}

/** Build a runner that responds based on cmd+args. */
function runner(handler: (cmd: string, args: string[]) => { code: number; stdout: string }): CmdRunner {
  return (cmd, args) => handler(cmd, args);
}

describe('probeMerge', () => {
  it('returns pr-merged (hard) when gh reports MERGED', () => {
    const t = task({ pr: { number: 106, url: '', title: '', state: 'open', merged_at: null, base_branch: 'main' } });
    const run = runner((cmd) => cmd === 'gh'
      ? { code: 0, stdout: JSON.stringify({ state: 'MERGED', mergedAt: '2026-06-06T00:00:00Z' }) }
      : { code: 1, stdout: '' });
    const ev = probeMerge(t, '/repo', run);
    expect(ev).toMatchObject({ resolved: true, signal: 'pr-merged', hard: true });
  });

  it('returns open-pr (not resolved) when gh reports OPEN', () => {
    const t = task({ pr: { number: 106, url: '', title: '', state: 'open', merged_at: null, base_branch: 'main' } });
    const run = runner((cmd) => cmd === 'gh' ? { code: 0, stdout: JSON.stringify({ state: 'OPEN', mergedAt: null }) } : { code: 1, stdout: '' });
    expect(probeMerge(t, '/repo', run)).toMatchObject({ resolved: false, signal: 'open-pr' });
  });

  it('returns commit-in-main (hard) when a commit is an ancestor of origin/main', () => {
    const t = task({ commits: [{ sha: 'abc1234', message: 'm', authored_at: '' }] });
    const run = runner((cmd, args) =>
      cmd === 'git' && args.includes('--is-ancestor') ? { code: 0, stdout: '' } : { code: 1, stdout: '' });
    expect(probeMerge(t, '/repo', run)).toMatchObject({ resolved: true, signal: 'commit-in-main', hard: true });
  });

  it('returns branch-merged (hard) when the branch appears in --merged', () => {
    const t = task({ branch: 'feat/x' });
    const run = runner((cmd, args) =>
      cmd === 'git' && args.includes('--merged') ? { code: 0, stdout: '  main\n* other\n  feat/x\n' } : { code: 1, stdout: '' });
    expect(probeMerge(t, '/repo', run)).toMatchObject({ resolved: true, signal: 'branch-merged', hard: true });
  });

  it('falls back to stored pr.state=merged (soft) when no repo path', () => {
    const t = task({ pr: { number: 9, url: '', title: '', state: 'merged', merged_at: '2026-01-01', base_branch: 'main' } });
    expect(probeMerge(t, null, runner(() => ({ code: 1, stdout: '' })))).toMatchObject({ resolved: true, signal: 'pr-state-fallback', hard: false });
  });

  it('falls back to open-pr when stored pr.state=open and no live signal', () => {
    const t = task({ pr: { number: 9, url: '', title: '', state: 'open', merged_at: null, base_branch: 'main' } });
    const run = runner(() => ({ code: 1, stdout: '' })); // all live checks fail
    expect(probeMerge(t, '/repo', run)).toMatchObject({ resolved: false, signal: 'open-pr' });
  });

  it('returns none when there is no git linkage at all', () => {
    expect(probeMerge(task(), '/repo', runner(() => ({ code: 1, stdout: '' })))).toMatchObject({ resolved: false, signal: 'none' });
  });

  it('uses the PR base_branch for the ancestor ref', () => {
    const t = task({ commits: [{ sha: 'deadbee', message: 'm', authored_at: '' }], pr: { number: 1, url: '', title: '', state: 'closed', merged_at: null, base_branch: 'develop' } });
    let seenRef = '';
    const run = runner((cmd, args) => {
      if (cmd === 'gh') return { code: 0, stdout: JSON.stringify({ state: 'CLOSED', mergedAt: null }) };
      if (cmd === 'git' && args.includes('--is-ancestor')) { seenRef = args[args.length - 1]!; return { code: 0, stdout: '' }; }
      return { code: 1, stdout: '' };
    });
    probeMerge(t, '/repo', run);
    expect(seenRef).toBe('origin/develop');
  });
});
