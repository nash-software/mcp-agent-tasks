/**
 * Tests that verify the Challenger suppression during grounding/refer states.
 * Verify command: CLAUDE_CLI_DISABLED=1 npx vitest run --reporter=verbose advisor-challenger-grounding
 *
 * This is a dedicated test file for the grounding invariant (spec §5):
 * "The Challenger is suppressed during grounding mode — you do not challenge
 * someone who is dysregulated."
 */
import { describe, it, expect } from 'vitest';
import { runChallenger } from '../../src/store/advisor-challenger.js';
import type { RunLLM } from '../../src/types/advisor.js';

let runLLMCallCount = 0;
const countingRunLLM: RunLLM = async () => {
  runLLMCallCount++;
  return JSON.stringify({ counterpoint: 'A challenge', tests: ['Do this'] });
};

// ── Suppression contract ───────────────────────────────────────────────────

describe('challenge frame suppressed during grounding', () => {
  it('never calls RunLLM when gateAction is ground', async () => {
    runLLMCallCount = 0;
    const result = await runChallenger(
      { message: 'I am completely overwhelmed', beliefs: [], gateAction: 'ground' },
      countingRunLLM,
    );
    expect(result).toBeNull();
    expect(runLLMCallCount).toBe(0); // no LLM call = true isolation
  });

  it('never calls RunLLM when gateAction is refer', async () => {
    runLLMCallCount = 0;
    const result = await runChallenger(
      { message: "I can't go on", beliefs: [], gateAction: 'refer' },
      countingRunLLM,
    );
    expect(result).toBeNull();
    expect(runLLMCallCount).toBe(0);
  });

  it('produces output when gateAction is proceed', async () => {
    runLLMCallCount = 0;
    const result = await runChallenger(
      { message: 'I keep avoiding the hard conversation', beliefs: [], gateAction: 'proceed' },
      countingRunLLM,
    );
    expect(result).not.toBeNull();
    expect(runLLMCallCount).toBe(1); // exactly one LLM call
  });

  it('ground + refer suppression is unconditional regardless of beliefs', async () => {
    const beliefWithEvidence = {
      id: 'b1',
      statement: 'I always fail',
      downward_arrow: ['people leave me'],
      first_surfaced: '2026-06-22T00:00:00Z',
      last_surfaced: '2026-06-22T00:00:00Z',
      surfaced_count: 5,
      status: 'active' as const,
      disconfirming_evidence: [{ ts: '2026-06-22', note: 'Succeeded last week', source_session: 's1' }],
      linked_fears: [],
      linked_commitments: [],
    };

    // Even with rich belief context, suppressed when grounding
    const groundResult = await runChallenger(
      { message: 'I feel so activated right now', beliefs: [beliefWithEvidence], gateAction: 'ground' },
      countingRunLLM,
    );
    expect(groundResult).toBeNull();

    const referResult = await runChallenger(
      { message: 'There is no point', beliefs: [beliefWithEvidence], gateAction: 'refer' },
      countingRunLLM,
    );
    expect(referResult).toBeNull();
  });
});

// ── Transition test: ground → proceed ─────────────────────────────────────

describe('challenge resumes after grounding resolves', () => {
  it('returns null on ground, then result on proceed', async () => {
    const calls: string[] = [];
    const trackRunLLM: RunLLM = async (_prompt, opts) => {
      calls.push(`cold=${String(opts?.cold)}`);
      return JSON.stringify({ counterpoint: 'Try this instead', tests: ['Test A'] });
    };

    // First turn: dysregulated → ground → suppressed
    const groundResult = await runChallenger(
      { message: 'I am overwhelmed', beliefs: [], gateAction: 'ground' },
      trackRunLLM,
    );
    expect(groundResult).toBeNull();
    expect(calls).toHaveLength(0); // no LLM call during ground

    // Second turn: stabilised → proceed → challenger runs
    const proceedResult = await runChallenger(
      { message: 'I keep avoiding this pattern', beliefs: [], gateAction: 'proceed' },
      trackRunLLM,
    );
    expect(proceedResult).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('cold=true'); // isolation confirmed
  });
});
