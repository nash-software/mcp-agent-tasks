/**
 * Idempotency tests for advisor-consolidation.
 * Verifies: re-running consolidateSession on the same session produces no duplicate entities.
 * Verify command: CLAUDE_CLI_DISABLED=1 npx vitest run --reporter=verbose advisor-consolidation-idempotency
 */
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { consolidateSession, consolidateAll } from '../../src/store/advisor-consolidation.js';
import { appendEpisodic } from '../../src/store/advisor-episodic.js';
import { listEntities } from '../../src/store/advisor-entities.js';
import type { RunLLM, BeliefRecord } from '../../src/types/advisor.js';

function mockRunLLM(jsonResponse: string): RunLLM {
  return async () => jsonResponse;
}

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-idempotency-test-'));
  process.env['MCP_TASKS_DIR'] = tempDir;
});

// ── Idempotency — consolidateSession ──────────────────────────────────────

describe('consolidateSession idempotency', () => {
  it('calling consolidateSession twice on same session creates exactly one entity', async () => {
    await appendEpisodic({
      id: 'idp-1',
      session_id: 'sess-idem-001',
      ts: '2026-06-22T01:00:00Z',
      role: 'user',
      content: 'I always procrastinate on the important things',
    });

    const extraction = JSON.stringify({
      beliefs: [{ statement: 'I always procrastinate on important things', downward_arrow: ['I will fail deadlines'] }],
      fears: [],
      values: [],
      commitments: [],
    });

    const runLLM = mockRunLLM(extraction);

    // First call
    await consolidateSession('sess-idem-001', runLLM);
    // Second call — must be a no-op (session already in consolidated.jsonl)
    await consolidateSession('sess-idem-001', runLLM);

    const beliefs = await listEntities('belief') as BeliefRecord[];
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0].surfaced_count).toBe(1); // not incremented twice
  });

  it('consolidated.jsonl grows by exactly one entry per new session', async () => {
    for (let i = 1; i <= 3; i++) {
      await appendEpisodic({
        id: `batch-${i}`,
        session_id: `sess-batch-${i}`,
        ts: '2026-06-22T01:00:00Z',
        role: 'user',
        content: `Session ${i} content`,
      });
    }

    const extraction = JSON.stringify({ beliefs: [], fears: [], values: [], commitments: [] });
    const runLLM = mockRunLLM(extraction);

    // Run each session twice
    for (let i = 1; i <= 3; i++) {
      await consolidateSession(`sess-batch-${i}`, runLLM);
      await consolidateSession(`sess-batch-${i}`, runLLM);
    }

    const logPath = path.join(tempDir, 'advisor-sessions', 'consolidated.jsonl');
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(l => l.trim());
    // Exactly 3 entries — one per session, no duplicates
    expect(lines).toHaveLength(3);

    const ids = lines.map(l => (JSON.parse(l) as { session_id: string }).session_id);
    expect(new Set(ids).size).toBe(3); // all unique
  });

  it('fears with same name merged, not duplicated', async () => {
    // Session 1
    await appendEpisodic({
      id: 'fear-s1',
      session_id: 'sess-fear-1',
      ts: '2026-06-22T01:00:00Z',
      role: 'user',
      content: 'I am afraid of rejection',
    });

    // Session 2 — same fear surfaced again
    await appendEpisodic({
      id: 'fear-s2',
      session_id: 'sess-fear-2',
      ts: '2026-06-22T02:00:00Z',
      role: 'user',
      content: 'That rejection fear came up again today',
    });

    const fearExtraction = JSON.stringify({
      beliefs: [],
      fears: [{ name: 'Rejection', body_location: 'throat', what_shifts_it: ['reassurance'] }],
      values: [],
      commitments: [],
    });

    await consolidateSession('sess-fear-1', mockRunLLM(fearExtraction));
    await consolidateSession('sess-fear-2', mockRunLLM(fearExtraction));

    const fears = await listEntities('fear');
    // Same name → one entity, not two
    expect(fears).toHaveLength(1);
    // Sessions list updated to include both
    const fear = fears[0] as { sessions: string[]; name: string };
    expect(fear.name).toBe('Rejection');
    expect(fear.sessions).toContain('sess-fear-1');
    expect(fear.sessions).toContain('sess-fear-2');
  });

  it('values with same label merged (confidence bumped, no duplicate)', async () => {
    const valueExtraction = JSON.stringify({
      beliefs: [],
      fears: [],
      values: [{ value: 'Autonomy', ladder: ['freedom', 'agency'] }],
      commitments: [],
    });

    await appendEpisodic({ id: 'v1', session_id: 'sess-val-1', ts: '2026-06-22T01:00:00Z', role: 'user', content: 'Autonomy matters a lot to me' });
    await appendEpisodic({ id: 'v2', session_id: 'sess-val-2', ts: '2026-06-22T02:00:00Z', role: 'user', content: 'Autonomy came up again' });

    await consolidateSession('sess-val-1', mockRunLLM(valueExtraction));
    await consolidateSession('sess-val-2', mockRunLLM(valueExtraction));

    const values = await listEntities('value');
    expect(values).toHaveLength(1);
    const val = values[0] as { confidence: number; value: string };
    expect(val.value).toBe('Autonomy');
    expect(val.confidence).toBeGreaterThan(0.7); // bumped by second session
  });
});

// ── consolidateAll idempotency ─────────────────────────────────────────────

describe('consolidateAll idempotency', () => {
  it('running twice skips already-processed sessions', async () => {
    for (let i = 1; i <= 2; i++) {
      await appendEpisodic({
        id: `ca-${i}`,
        session_id: `sess-ca-${i}`,
        ts: '2026-06-22T01:00:00Z',
        role: 'user',
        content: `Consolidate all session ${i}`,
      });
    }

    const extraction = JSON.stringify({ beliefs: [], fears: [], values: [], commitments: [] });
    const runLLM = mockRunLLM(extraction);

    const first = await consolidateAll(runLLM);
    expect(first.processed).toBe(2);
    expect(first.skipped).toBe(0);

    const second = await consolidateAll(runLLM);
    expect(second.processed).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it('returns 0 processed for empty episodic dir', async () => {
    const result = await consolidateAll(mockRunLLM('{}'));
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(0);
  });
});
