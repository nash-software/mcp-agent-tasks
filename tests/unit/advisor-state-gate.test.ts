/**
 * Unit tests for the state classifier + gate (T1.3, T1.4)
 * All LLM calls use mocked runLLM — no real claude spawn.
 * Runs under CLAUDE_CLI_DISABLED=1.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { classifyState, gate } from '../../src/store/advisor-state.js';
import type { StateLogEntry, RunLLM } from '../../src/types/advisor.js';

// Mock runLLM that returns a canned JSON response
function mockRunLLM(response: string): RunLLM {
  return async () => response;
}

// runLLM that always fails (simulates CLAUDE_CLI_DISABLED=1)
const failingRunLLM: RunLLM = async () => { throw new Error('LLM unavailable'); };

beforeEach(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-gate-test-'));
  process.env['MCP_TASKS_DIR'] = tempDir;
});

// ── classifyState ──────────────────────────────────────────────────────────

describe('classifyState — heuristic fallback (LLM unavailable)', () => {
  it('classifies normal message as processing', async () => {
    const c = await classifyState('I want to work on the project plan', [], failingRunLLM);
    expect(c.mode).toBe('processing');
    expect(c.arousal).toBeLessThan(0.5);
  });

  it('classifies rumination markers as ruminating', async () => {
    const c = await classifyState('I keep going over the same thing, it just goes in circles', [], failingRunLLM);
    expect(c.mode).toBe('ruminating');
    expect(c.arousal).toBeGreaterThan(0.5);
  });

  it('classifies distress markers as ruminating with high arousal', async () => {
    const c = await classifyState("I'm so overwhelmed I can't breathe", [], failingRunLLM);
    expect(c.mode).toBe('ruminating');
    expect(c.arousal).toBeGreaterThan(0.6);
  });

  it('classifies crisis language with very high arousal', async () => {
    const c = await classifyState("I don't want to be here anymore, there's no point", [], failingRunLLM);
    expect(c.mode).toBe('ruminating');
    expect(c.arousal).toBeGreaterThanOrEqual(0.9);
    expect(c.triggers).toContain('crisis-language');
  });
});

describe('classifyState — LLM confirmation path', () => {
  it('uses LLM response when LLM succeeds and heuristic flagged something', async () => {
    const llmResponse = JSON.stringify({ mode: 'grounded', arousal: 0.2, valence: 0.5 });
    // Message with distress marker triggers LLM confirmation path
    const c = await classifyState(
      "I'm so overwhelmed right now",
      [],
      mockRunLLM(llmResponse),
    );
    expect(c.mode).toBe('grounded');
    expect(c.arousal).toBeCloseTo(0.2);
  });

  it('falls back to heuristic when LLM returns invalid JSON', async () => {
    const c = await classifyState(
      'I keep going in circles about this',
      [],
      mockRunLLM('sorry, I cannot help'),
    );
    expect(c.mode).toBe('ruminating'); // heuristic result
  });

  it('falls back to heuristic when LLM returns invalid mode', async () => {
    const c = await classifyState(
      'I keep spiralling',
      [],
      mockRunLLM(JSON.stringify({ mode: 'confused', arousal: 0.5, valence: -0.3 })),
    );
    expect(c.mode).toBe('ruminating'); // heuristic result
  });

  it('clamps LLM arousal to 0..1 range', async () => {
    const c = await classifyState(
      "I'm overwhelmed",
      [],
      mockRunLLM(JSON.stringify({ mode: 'ruminating', arousal: 1.5, valence: -0.5 })),
    );
    expect(c.arousal).toBeLessThanOrEqual(1);
  });
});

// ── gate ──────────────────────────────────────────────────────────────────

describe('gate — proceed path', () => {
  it('returns proceed for processing state with low arousal', () => {
    const result = gate({ mode: 'processing', arousal: 0.3, valence: 0.1 }, []);
    expect(result.action).toBe('proceed');
  });

  it('returns proceed for grounded state', () => {
    const result = gate({ mode: 'grounded', arousal: 0.2, valence: 0.4 }, []);
    expect(result.action).toBe('proceed');
  });
});

describe('gate — ground path', () => {
  it('returns ground for ruminating state', () => {
    const result = gate({ mode: 'ruminating', arousal: 0.5, valence: -0.4 }, []);
    expect(result.action).toBe('ground');
  });

  it('returns ground for high arousal even without rumination mode', () => {
    const result = gate({ mode: 'processing', arousal: 0.7, valence: -0.3 }, []);
    expect(result.action).toBe('ground');
  });
});

describe('gate — refer path', () => {
  it('returns refer for crisis-language trigger', () => {
    const result = gate({ mode: 'ruminating', arousal: 0.95, valence: -0.9, triggers: ['crisis-language'] }, []);
    expect(result.action).toBe('refer');
  });

  it('returns refer for arousal >= 0.9 even without explicit crisis trigger', () => {
    const result = gate({ mode: 'ruminating', arousal: 0.92, valence: -0.8 }, []);
    expect(result.action).toBe('refer');
  });

  function highArousalEntry(ts: string): StateLogEntry {
    return { ts, session_id: 's1', valence: -0.7, arousal: 0.75, mode: 'ruminating' };
  }

  it('returns refer for 3 consecutive high-arousal turns', () => {
    const recent: StateLogEntry[] = [
      highArousalEntry('2026-06-21T10:00:00.000Z'),
      highArousalEntry('2026-06-21T10:05:00.000Z'),
      highArousalEntry('2026-06-21T10:10:00.000Z'),
    ];
    const result = gate({ mode: 'ruminating', arousal: 0.7, valence: -0.5 }, recent);
    expect(result.action).toBe('refer');
  });

  it('does NOT refer for only 2 consecutive high-arousal turns', () => {
    const recent: StateLogEntry[] = [
      highArousalEntry('2026-06-21T10:00:00.000Z'),
      highArousalEntry('2026-06-21T10:05:00.000Z'),
    ];
    const result = gate({ mode: 'ruminating', arousal: 0.7, valence: -0.5 }, recent);
    expect(result.action).toBe('ground');
  });
});

describe('gate — ordering invariant: crisis overrides sustained distress check', () => {
  it('returns refer immediately on crisis regardless of recent state', () => {
    const result = gate(
      { mode: 'ruminating', arousal: 0.95, valence: -0.9, triggers: ['crisis-language'] },
      [], // no prior high-arousal turns
    );
    expect(result.action).toBe('refer');
  });
});
