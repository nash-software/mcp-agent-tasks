/**
 * Unit tests for src/store/advisor-entities.ts (T0.3)
 * CRUD only — no arbiter/consolidation logic.
 * Runs under CLAUDE_CLI_DISABLED=1 — no LLM calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { listEntities, getEntity, upsertEntity } from '../../src/store/advisor-entities.js';
import type { BeliefRecord, FearRecord, ValueRecord, CommitmentRecord } from '../../src/types/advisor.js';

beforeEach(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entities-test-'));
  process.env['MCP_TASKS_DIR'] = tempDir;
});

describe('beliefs CRUD', () => {
  const belief: BeliefRecord = {
    id: 'bel-1',
    statement: "I'm not good enough",
    downward_arrow: ['People will reject me', 'I am fundamentally flawed'],
    first_surfaced: '2026-06-01T00:00:00.000Z',
    last_surfaced: '2026-06-21T00:00:00.000Z',
    surfaced_count: 3,
    status: 'active',
    disconfirming_evidence: [],
  };

  it('listEntities returns [] initially', async () => {
    expect(await listEntities('belief')).toEqual([]);
  });

  it('upsertEntity creates a new belief', async () => {
    await upsertEntity('belief', belief);
    const all = await listEntities('belief');
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(belief);
  });

  it('getEntity returns the belief by id', async () => {
    await upsertEntity('belief', belief);
    const found = await getEntity('belief', 'bel-1');
    expect(found).toEqual(belief);
  });

  it('getEntity returns null for unknown id', async () => {
    expect(await getEntity('belief', 'no-such-id')).toBeNull();
  });

  it('upsertEntity replaces an existing belief without duplicating', async () => {
    await upsertEntity('belief', belief);
    const updated: BeliefRecord = { ...belief, surfaced_count: 5, status: 'softening' };
    await upsertEntity('belief', updated);
    const all = await listEntities('belief');
    expect(all).toHaveLength(1);
    expect((all[0] as BeliefRecord).surfaced_count).toBe(5);
    expect((all[0] as BeliefRecord).status).toBe('softening');
  });

  it('ids are stable across upserts', async () => {
    await upsertEntity('belief', belief);
    await upsertEntity('belief', { ...belief, statement: 'I cannot succeed' });
    const all = await listEntities('belief');
    expect(all[0]?.id).toBe('bel-1');
  });
});

describe('entity type isolation', () => {
  const fear: FearRecord = {
    id: 'fear-1',
    name: 'Rejection',
    sessions: ['session-abc'],
    status: 'active',
  };
  const value: ValueRecord = {
    id: 'val-1',
    value: 'Authenticity',
    ladder: ['I want to feel honest', 'Honesty matters', 'Being authentic'],
    source_session: 'session-abc',
    confidence: 0.85,
  };
  const commitment: CommitmentRecord = {
    id: 'com-1',
    improvement_goal: 'Exercise daily',
    counter_behaviours: ['Stay up late', 'Skip morning'],
    hidden_commitment: 'Staying comfortable',
    big_assumption: 'Discomfort means danger',
    tests_run: [],
    status: 'active',
  };

  it('each entity type is stored separately', async () => {
    await upsertEntity('fear', fear);
    await upsertEntity('value', value);
    await upsertEntity('commitment', commitment);

    expect(await listEntities('fear')).toHaveLength(1);
    expect(await listEntities('value')).toHaveLength(1);
    expect(await listEntities('commitment')).toHaveLength(1);
    expect(await listEntities('belief')).toHaveLength(0);
  });

  it('getEntity does not cross-contaminate types', async () => {
    await upsertEntity('fear', fear);
    expect(await getEntity('belief', 'fear-1')).toBeNull();
    expect(await getEntity('fear', 'fear-1')).not.toBeNull();
  });
});
