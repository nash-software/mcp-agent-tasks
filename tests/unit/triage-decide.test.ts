/**
 * Unit tests for the pure Tier-0 decision core (src/triage/decide.ts).
 * No git, no gh, no store — pure logic over a Task + MergeEvidence.
 */
import { describe, it, expect } from 'vitest';
import { transitionPath, decideTier0 } from '../../src/triage/decide.js';
import { isDecision } from '../../src/triage/types.js';
import type { MergeEvidence } from '../../src/triage/types.js';
import type { Task } from '../../src/types/task.js';

const HOUR = 3600_000;
const NOW = Date.parse('2026-06-07T12:00:00Z');

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'MCPAT-001', title: 't', type: 'feature', status: 'in_progress', priority: 'medium',
    project: 'MCPAT', tags: [], complexity: 1, why: '', created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z', last_activity: '2026-01-01T00:00:00Z',
    claimed_by: null, claimed_at: null, claim_ttl_hours: 4, transitions: [],
    git: { commits: [] }, body: '', file_path: '/x', scheduled_for: null,
    ...over,
  } as Task;
}

const hardMerged: MergeEvidence = { resolved: true, signal: 'pr-merged', detail: 'PR #106 merged', hard: true };
const softMerged: MergeEvidence = { resolved: true, signal: 'pr-state-fallback', detail: 'stored pr.state=merged', hard: false };
const openPr: MergeEvidence = { resolved: false, signal: 'open-pr', detail: 'PR #106 open', hard: true };
const none: MergeEvidence = { resolved: false, signal: 'none', detail: '', hard: false };

describe('transitionPath', () => {
  it('returns [from] for from===to', () => {
    expect(transitionPath('done', 'done')).toEqual(['done']);
  });
  it('in_progress → done is a direct hop', () => {
    expect(transitionPath('in_progress', 'done')).toEqual(['in_progress', 'done']);
  });
  it('todo → done routes through in_progress', () => {
    expect(transitionPath('todo', 'done')).toEqual(['todo', 'in_progress', 'done']);
  });
  it('blocked → done routes through in_progress', () => {
    expect(transitionPath('blocked', 'done')).toEqual(['blocked', 'in_progress', 'done']);
  });
  it('draft → done routes through approved → in_progress', () => {
    expect(transitionPath('draft', 'done')).toEqual(['draft', 'approved', 'in_progress', 'done']);
  });
  it('archived → done is impossible → null', () => {
    expect(transitionPath('archived', 'done')).toBeNull();
  });
});

describe('decideTier0', () => {
  it('resolves an in_progress task with a hard merged PR', () => {
    const o = decideTier0(task({ status: 'in_progress' }), hardMerged, NOW);
    expect(isDecision(o)).toBe(true);
    if (isDecision(o)) {
      expect(o.toStatus).toBe('done');
      expect(o.path).toEqual(['in_progress', 'done']);
      expect(o.signal).toBe('pr-merged');
      expect(o.evidenceHard).toBe(true);
    }
  });

  it('resolves a todo task with a hard merge via a two-hop path', () => {
    const o = decideTier0(task({ status: 'todo' }), hardMerged, NOW);
    expect(isDecision(o)).toBe(true);
    if (isDecision(o)) expect(o.path).toEqual(['todo', 'in_progress', 'done']);
  });

  it('skips a task that is already done', () => {
    const o = decideTier0(task({ status: 'done' }), hardMerged, NOW);
    expect(isDecision(o)).toBe(false);
    if (!isDecision(o)) expect(o.reason).toBe('not-open');
  });

  it('skips when there is no merge signal', () => {
    const o = decideTier0(task(), none, NOW);
    if (!isDecision(o)) expect(o.reason).toBe('no-signal'); else throw new Error('should skip');
  });

  it('skips when the PR is still open', () => {
    const o = decideTier0(task(), openPr, NOW);
    if (!isDecision(o)) expect(o.reason).toBe('open-pr'); else throw new Error('should skip');
  });

  it('skips an actively-claimed task even with a hard merge', () => {
    const claimedAt = new Date(NOW - 1 * HOUR).toISOString(); // within 4h ttl
    const o = decideTier0(task({ claimed_by: 'sess-1', claimed_at: claimedAt, claim_ttl_hours: 4 }), hardMerged, NOW);
    if (!isDecision(o)) expect(o.reason).toBe('claimed-active'); else throw new Error('should skip');
  });

  it('resolves when the claim has expired (stale claim)', () => {
    const claimedAt = new Date(NOW - 10 * HOUR).toISOString(); // past 4h ttl
    const o = decideTier0(task({ claimed_by: 'sess-1', claimed_at: claimedAt, claim_ttl_hours: 4 }), hardMerged, NOW);
    expect(isDecision(o)).toBe(true);
  });

  it('hard evidence resolves even when the task was touched in the last 24h', () => {
    const o = decideTier0(task({ updated: new Date(NOW - 1 * HOUR).toISOString() }), hardMerged, NOW);
    expect(isDecision(o)).toBe(true);
  });

  it('soft evidence is guarded when the task was touched in the last 24h', () => {
    const o = decideTier0(task({ updated: new Date(NOW - 1 * HOUR).toISOString() }), softMerged, NOW);
    if (!isDecision(o)) expect(o.reason).toBe('fresh'); else throw new Error('should skip');
  });

  it('soft evidence resolves when the task is old (beyond fresh window)', () => {
    const o = decideTier0(task({ updated: new Date(NOW - 72 * HOUR).toISOString() }), softMerged, NOW);
    expect(isDecision(o)).toBe(true);
  });
});
