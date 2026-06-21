/**
 * Unit tests for src/store/advisor-state.ts (T0.4 — store only, no classifier).
 * Runs under CLAUDE_CLI_DISABLED=1 — no LLM calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { appendState, recentState, stateRange } from '../../src/store/advisor-state.js';
import type { StateLogEntry } from '../../src/types/advisor.js';

beforeEach(() => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-test-'));
  process.env['MCP_TASKS_DIR'] = tempDir;
});

function entry(overrides: Partial<StateLogEntry> = {}): StateLogEntry {
  return {
    ts: '2026-06-21T10:00:00.000Z',
    session_id: 'session-abc',
    valence: 0.2,
    arousal: 0.3,
    mode: 'processing',
    ...overrides,
  };
}

describe('appendState + recentState', () => {
  it('returns [] when no entries exist', async () => {
    expect(await recentState(5)).toEqual([]);
  });

  it('appends and retrieves a state entry with all fields', async () => {
    const e = entry({ somatic_notes: 'tight chest', triggers: ['work deadline'] });
    await appendState(e);
    const recent = await recentState(5);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toEqual(e);
  });

  it('recentState(n) returns the last n entries in insertion order', async () => {
    for (let i = 1; i <= 5; i++) {
      await appendState(entry({ ts: `2026-06-2${i}T10:00:00.000Z`, arousal: i * 0.1 }));
    }
    const recent = await recentState(3);
    expect(recent).toHaveLength(3);
    expect(recent[0]?.arousal).toBeCloseTo(0.3);
    expect(recent[2]?.arousal).toBeCloseTo(0.5);
  });

  it('recentState(n) clamps to available count when n > total', async () => {
    await appendState(entry());
    expect(await recentState(100)).toHaveLength(1);
  });
});

describe('stateRange', () => {
  it('returns entries within [fromTs, toTs]', async () => {
    await appendState(entry({ ts: '2026-06-01T00:00:00.000Z' }));
    await appendState(entry({ ts: '2026-06-15T00:00:00.000Z' }));
    await appendState(entry({ ts: '2026-06-30T00:00:00.000Z' }));

    const ranged = await stateRange('2026-06-10T00:00:00.000Z', '2026-06-20T00:00:00.000Z');
    expect(ranged).toHaveLength(1);
    expect(ranged[0]?.ts).toBe('2026-06-15T00:00:00.000Z');
  });

  it('returns [] when range matches nothing', async () => {
    await appendState(entry({ ts: '2026-06-01T00:00:00.000Z' }));
    expect(await stateRange('2026-07-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z')).toEqual([]);
  });

  it('is inclusive on both bounds', async () => {
    await appendState(entry({ ts: '2026-06-01T00:00:00.000Z' }));
    await appendState(entry({ ts: '2026-06-30T00:00:00.000Z' }));
    const ranged = await stateRange('2026-06-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z');
    expect(ranged).toHaveLength(2);
  });
});
