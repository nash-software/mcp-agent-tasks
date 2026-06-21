/**
 * Unit tests for advisor-consolidation arbiter.
 * Verifies:
 *   - Pivot never deletes: TimeBoundSummary written, prior record survives with status='softening'
 *   - New entities are created on first consolidation
 *   - Graceful fallback when LLM unavailable (ENOENT / CLAUDE_CLI_DISABLED)
 *
 * All LLM calls use injectable mockRunLLM — no real claude spawn.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { consolidateSession } from '../../src/store/advisor-consolidation.js';
import { appendEpisodic } from '../../src/store/advisor-episodic.js';
import { listEntities } from '../../src/store/advisor-entities.js';
import type { RunLLM, BeliefRecord } from '../../src/types/advisor.js';

function mockRunLLM(jsonResponse: string): RunLLM {
  return async () => jsonResponse;
}

const failingRunLLM: RunLLM = async () => { throw new Error('LLM unavailable'); };

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-consolidation-test-'));
  process.env['MCP_TASKS_DIR'] = tempDir;
});

// ── Entity creation ────────────────────────────────────────────────────────

describe('consolidateSession — entity creation', () => {
  it('creates a belief entity from first-session extraction', async () => {
    await appendEpisodic({
      id: 'rec-1',
      session_id: 'sess-001',
      ts: '2026-06-22T01:00:00Z',
      role: 'user',
      content: 'I feel like I am not good enough no matter what I do',
    });

    const extraction = JSON.stringify({
      beliefs: [{ statement: 'I am not good enough', downward_arrow: ['I will fail', 'People will leave'] }],
      fears: [],
      values: [],
      commitments: [],
    });

    await consolidateSession('sess-001', mockRunLLM(extraction));

    const beliefs = await listEntities('belief') as BeliefRecord[];
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0].statement).toBe('I am not good enough');
    expect(beliefs[0].status).toBe('active');
    expect(beliefs[0].surfaced_count).toBe(1);
    expect(beliefs[0].downward_arrow).toContain('I will fail');
  });

  it('creates fear entity with sessions array', async () => {
    await appendEpisodic({
      id: 'rec-2',
      session_id: 'sess-002',
      ts: '2026-06-22T01:00:00Z',
      role: 'user',
      content: 'I have this fear of abandonment, I feel it in my chest',
    });

    const extraction = JSON.stringify({
      beliefs: [],
      fears: [{ name: 'Abandonment', body_location: 'chest', what_shifts_it: ['connection', 'reassurance'] }],
      values: [],
      commitments: [],
    });

    await consolidateSession('sess-002', mockRunLLM(extraction));

    const fears = await listEntities('fear');
    expect(fears).toHaveLength(1);
    expect((fears[0] as { name: string }).name).toBe('Abandonment');
    expect((fears[0] as { sessions: string[] }).sessions).toContain('sess-002');
  });

  it('gracefully handles LLM failure — session is still marked consolidated', async () => {
    await appendEpisodic({
      id: 'rec-3',
      session_id: 'sess-003',
      ts: '2026-06-22T01:00:00Z',
      role: 'user',
      content: 'Just had a good day',
    });

    // No error thrown — failure mode is silent
    await expect(consolidateSession('sess-003', failingRunLLM)).resolves.toBeUndefined();

    // Session marked consolidated so it won't retry infinitely
    const consolidated = fs.readFileSync(
      path.join(tempDir, 'advisor-sessions', 'consolidated.jsonl'),
      'utf-8',
    );
    expect(consolidated).toContain('sess-003');
  });

  it('empty session (no records) — marks as consolidated without error', async () => {
    // No episodic records written for this session ID
    await expect(consolidateSession('sess-empty', failingRunLLM)).resolves.toBeUndefined();
  });
});

// ── Pivot detection — TimeBoundSummary invariant ───────────────────────────

describe('pivot — TimeBoundSummary written, prior record survives', () => {
  it('adds reconciliation field on pivot, does NOT delete the belief', async () => {
    // Session 1: belief first surfaces
    await appendEpisodic({
      id: 'rec-s1',
      session_id: 'sess-pivot-1',
      ts: '2026-06-22T01:00:00Z',
      role: 'user',
      content: 'I feel like I am not capable of leading anything',
    });

    const extraction1 = JSON.stringify({
      beliefs: [{ statement: 'I am not capable of leading', downward_arrow: ['people will see through me'] }],
      fears: [], values: [], commitments: [],
    });
    await consolidateSession('sess-pivot-1', mockRunLLM(extraction1));

    // Verify belief created as active
    const beliefsAfter1 = await listEntities('belief') as BeliefRecord[];
    expect(beliefsAfter1).toHaveLength(1);
    expect(beliefsAfter1[0].status).toBe('active');
    expect(beliefsAfter1[0].reconciliation).toBeUndefined();

    // Session 2: disconfirming language appears alongside belief topic
    await appendEpisodic({
      id: 'rec-s2',
      session_id: 'sess-pivot-2',
      ts: '2026-06-22T02:00:00Z',
      role: 'user',
      content: 'I realize that belief about not being capable of leading is not as true as I thought. I actually led the team last week.',
    });

    const extraction2 = JSON.stringify({
      beliefs: [{ statement: 'I am not capable of leading', downward_arrow: [] }],
      fears: [], values: [], commitments: [],
    });
    await consolidateSession('sess-pivot-2', mockRunLLM(extraction2));

    // Invariant: belief still exists (never deleted)
    const beliefsAfter2 = await listEntities('belief') as BeliefRecord[];
    expect(beliefsAfter2).toHaveLength(1);

    const belief = beliefsAfter2[0];
    // Prior statement is preserved
    expect(belief.statement).toBe('I am not capable of leading');
    // TimeBoundSummary was written
    expect(belief.reconciliation).toBeDefined();
    expect(belief.reconciliation!.prior_value).toBe('I am not capable of leading');
    expect(belief.reconciliation!.reconciled_at).toBeTruthy();
    // Status moved to softening (not deleted, not wiped)
    expect(belief.status).toBe('softening');
    // Surfaced count incremented
    expect(belief.surfaced_count).toBe(2);
  });

  it('no pivot without disconfirming language — belief stays active', async () => {
    await appendEpisodic({
      id: 'rec-np',
      session_id: 'sess-no-pivot',
      ts: '2026-06-22T01:00:00Z',
      role: 'user',
      content: 'I keep feeling like I am not worth it. I try to push through but it comes back.',
    });

    const extraction = JSON.stringify({
      beliefs: [{ statement: 'I am not worth it', downward_arrow: [] }],
      fears: [], values: [], commitments: [],
    });
    await consolidateSession('sess-no-pivot', mockRunLLM(extraction));

    // Second session, same belief, no disconfirming language
    await appendEpisodic({
      id: 'rec-np2',
      session_id: 'sess-no-pivot-2',
      ts: '2026-06-22T02:00:00Z',
      role: 'user',
      content: 'Still feeling like I am not worth it today.',
    });

    const extraction2 = JSON.stringify({
      beliefs: [{ statement: 'I am not worth it', downward_arrow: [] }],
      fears: [], values: [], commitments: [],
    });
    await consolidateSession('sess-no-pivot-2', mockRunLLM(extraction2));

    const beliefs = await listEntities('belief') as BeliefRecord[];
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0].status).toBe('active');
    expect(beliefs[0].reconciliation).toBeUndefined();
    expect(beliefs[0].surfaced_count).toBe(2);
  });
});
