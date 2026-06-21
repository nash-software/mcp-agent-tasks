/**
 * Unit tests for the Challenger subsystem (T3.1).
 * Key invariants:
 *   - Challenger never shares LLM instance with the coach (cold: true enforced)
 *   - Returns ChallengeResult when gate=proceed and LLM is available
 *   - Returns null when gate=ground (suppressed — invariant from spec §5)
 *   - Returns null when gate=refer (suppressed — invariant from spec §5)
 *   - Returns null when LLM unavailable (graceful fallback)
 */
import { describe, it, expect } from 'vitest';
import { runChallenger } from '../../src/store/advisor-challenger.js';
import type { RunLLM, BeliefRecord } from '../../src/types/advisor.js';

// Track call opts to verify isolation
function trackingRunLLM(
  response: string,
  calls: Array<{ prompt: string; opts?: Parameters<RunLLM>[1] }>,
): RunLLM {
  return async (prompt, opts) => {
    calls.push({ prompt, opts });
    return response;
  };
}

const failingRunLLM: RunLLM = async () => { throw new Error('LLM unavailable'); };

const sampleBelief: BeliefRecord = {
  id: 'belief-1',
  statement: 'I am not capable of leading',
  downward_arrow: ['I will fail', 'People will leave me'],
  first_surfaced: '2026-06-22T01:00:00Z',
  last_surfaced: '2026-06-22T01:00:00Z',
  surfaced_count: 2,
  status: 'active',
  disconfirming_evidence: [],
  linked_fears: [],
  linked_commitments: [],
};

const sampleChallenge = JSON.stringify({
  counterpoint: 'You led the team meeting last Thursday — what actually went wrong there, specifically?',
  tests: [
    'List three decisions you made this week that others followed.',
    'Ask one colleague what they think of your leadership style.',
  ],
});

// ── Isolation invariant ────────────────────────────────────────────────────

describe('Challenger isolation — never shares instance with coach', () => {
  it('always calls RunLLM with cold: true (isolation flag)', async () => {
    const calls: Array<{ prompt: string; opts?: Parameters<RunLLM>[1] }> = [];
    const runLLM = trackingRunLLM(sampleChallenge, calls);

    await runChallenger(
      { message: 'I feel like I am not capable', beliefs: [sampleBelief], gateAction: 'proceed' },
      runLLM,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].opts?.cold).toBe(true);
  });

  it('is callable with a completely independent RunLLM function', async () => {
    let challengerCallCount = 0;
    let coachCallCount = 0;

    const coachRunLLM: RunLLM = async () => { coachCallCount++; return 'coach response'; };
    const challengerRunLLM: RunLLM = async (_prompt, opts) => {
      expect(opts?.cold).toBe(true); // isolation enforced
      challengerCallCount++;
      return sampleChallenge;
    };

    // Coach and challenger use different RunLLM instances — they're independent
    coachRunLLM('hello');
    await runChallenger(
      { message: 'I keep failing', beliefs: [], gateAction: 'proceed' },
      challengerRunLLM,
    );

    expect(coachCallCount).toBe(1);
    expect(challengerCallCount).toBe(1);
  });
});

// ── Grounding/refer suppression ───────────────────────────────────────────

describe('Challenger suppression during gate states', () => {
  it('returns null when gateAction is ground', async () => {
    const calls: Array<{ prompt: string; opts?: Parameters<RunLLM>[1] }> = [];
    const runLLM = trackingRunLLM(sampleChallenge, calls);

    const result = await runChallenger(
      { message: 'I am overwhelmed', beliefs: [], gateAction: 'ground' },
      runLLM,
    );

    expect(result).toBeNull();
    expect(calls).toHaveLength(0); // RunLLM must NOT be called at all when suppressed
  });

  it('returns null when gateAction is refer', async () => {
    const calls: Array<{ prompt: string; opts?: Parameters<RunLLM>[1] }> = [];
    const runLLM = trackingRunLLM(sampleChallenge, calls);

    const result = await runChallenger(
      { message: 'I do not want to be here', beliefs: [], gateAction: 'refer' },
      runLLM,
    );

    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

// ── Happy path ─────────────────────────────────────────────────────────────

describe('Challenger — happy path (gateAction: proceed)', () => {
  it('returns ChallengeResult with counterpoint and tests[]', async () => {
    const result = await runChallenger(
      { message: 'I am not capable of leading', beliefs: [sampleBelief], gateAction: 'proceed' },
      trackingRunLLM(sampleChallenge, []),
    );

    expect(result).not.toBeNull();
    expect(typeof result!.counterpoint).toBe('string');
    expect(result!.counterpoint.length).toBeGreaterThan(10);
    expect(Array.isArray(result!.tests)).toBe(true);
    expect(result!.tests.length).toBeGreaterThanOrEqual(1);
  });

  it('limits counterpoint to 500 chars', async () => {
    const longResponse = JSON.stringify({
      counterpoint: 'A'.repeat(600),
      tests: ['test1'],
    });
    const result = await runChallenger(
      { message: 'test', beliefs: [], gateAction: 'proceed' },
      trackingRunLLM(longResponse, []),
    );
    expect(result!.counterpoint.length).toBeLessThanOrEqual(500);
  });

  it('limits tests to max 3 items', async () => {
    const manyTests = JSON.stringify({
      counterpoint: 'A counterpoint',
      tests: ['t1', 't2', 't3', 't4', 't5'],
    });
    const result = await runChallenger(
      { message: 'test', beliefs: [], gateAction: 'proceed' },
      trackingRunLLM(manyTests, []),
    );
    expect(result!.tests.length).toBeLessThanOrEqual(3);
  });

  it('includes disconfirming evidence from belief in prompt', async () => {
    const beliefWithEvidence: BeliefRecord = {
      ...sampleBelief,
      disconfirming_evidence: [{ ts: '2026-06-22', note: 'Led team meeting successfully', source_session: 'sess-1' }],
    };

    const capturedCalls: Array<{ prompt: string; opts?: Parameters<RunLLM>[1] }> = [];
    await runChallenger(
      { message: 'I cannot lead', beliefs: [beliefWithEvidence], gateAction: 'proceed' },
      trackingRunLLM(sampleChallenge, capturedCalls),
    );

    expect(capturedCalls[0].prompt).toContain('Led team meeting successfully');
  });
});

// ── Graceful degradation ───────────────────────────────────────────────────

describe('Challenger graceful fallback', () => {
  it('returns null when LLM is unavailable (CLAUDE_CLI_DISABLED)', async () => {
    const result = await runChallenger(
      { message: 'test message', beliefs: [], gateAction: 'proceed' },
      failingRunLLM,
    );
    expect(result).toBeNull();
  });

  it('returns null when LLM returns unparseable output', async () => {
    const result = await runChallenger(
      { message: 'test', beliefs: [], gateAction: 'proceed' },
      async () => 'not json at all',
    );
    expect(result).toBeNull();
  });

  it('returns null when counterpoint field is missing', async () => {
    const result = await runChallenger(
      { message: 'test', beliefs: [], gateAction: 'proceed' },
      async () => JSON.stringify({ tests: ['test1'] }),
    );
    expect(result).toBeNull();
  });
});
