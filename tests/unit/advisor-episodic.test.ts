/**
 * Unit tests for src/store/advisor-episodic.ts (T0.2)
 * Runs under CLAUDE_CLI_DISABLED=1 — no LLM calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { appendEpisodic, readEpisodic, queryEpisodic } from '../../src/store/advisor-episodic.js';
import type { EpisodicRecord } from '../../src/types/advisor.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-test-'));
  process.env['MCP_TASKS_DIR'] = tempDir;
});

function rec(overrides: Partial<EpisodicRecord> = {}): EpisodicRecord {
  return {
    id: 'ep-1',
    session_id: 'session-abc',
    ts: '2026-06-21T10:00:00.000Z',
    role: 'user',
    content: 'I feel stuck and I keep going in circles about this.',
    ...overrides,
  };
}

describe('appendEpisodic + readEpisodic', () => {
  it('round-trips a verbatim turn including optional fields', async () => {
    const entry: EpisodicRecord = rec({
      play: 'downward_arrow',
      state_tags: ['anxious', 'chest-tight'],
      charge: 0.7,
      open_loop: true,
    });
    await appendEpisodic(entry);
    const read = await readEpisodic('session-abc');
    expect(read).toHaveLength(1);
    expect(read[0]).toEqual(entry);
  });

  it('accumulates multiple turns for the same session', async () => {
    await appendEpisodic(rec({ id: 'ep-1', role: 'user', content: 'Turn 1' }));
    await appendEpisodic(rec({ id: 'ep-2', role: 'assistant', content: 'Turn 2' }));
    const read = await readEpisodic('session-abc');
    expect(read).toHaveLength(2);
    expect(read[0]?.content).toBe('Turn 1');
    expect(read[1]?.content).toBe('Turn 2');
  });

  it('returns [] for unknown session', async () => {
    const read = await readEpisodic('no-such-session');
    expect(read).toEqual([]);
  });

  it('does not mix records from different sessions', async () => {
    await appendEpisodic(rec({ id: 'ep-1', session_id: 'session-abc' }));
    await appendEpisodic(rec({ id: 'ep-2', session_id: 'session-xyz' }));
    expect(await readEpisodic('session-abc')).toHaveLength(1);
    expect(await readEpisodic('session-xyz')).toHaveLength(1);
  });
});

describe('queryEpisodic', () => {
  it('filters by play', async () => {
    await appendEpisodic(rec({ id: 'ep-1', play: 'ladder' }));
    await appendEpisodic(rec({ id: 'ep-2', play: 'downward_arrow' }));
    const res = await queryEpisodic({ play: 'ladder' });
    expect(res).toHaveLength(1);
    expect(res[0]?.id).toBe('ep-1');
  });

  it('filters by open_loop', async () => {
    await appendEpisodic(rec({ id: 'ep-1', open_loop: true }));
    await appendEpisodic(rec({ id: 'ep-2' }));
    const res = await queryEpisodic({ openLoops: true });
    expect(res).toHaveLength(1);
    expect(res[0]?.id).toBe('ep-1');
  });

  it('filters by sinceTs', async () => {
    await appendEpisodic(rec({ id: 'ep-1', ts: '2026-01-01T00:00:00.000Z' }));
    await appendEpisodic(rec({ id: 'ep-2', ts: '2026-06-01T00:00:00.000Z' }));
    const res = await queryEpisodic({ sinceTs: '2026-03-01T00:00:00.000Z' });
    expect(res).toHaveLength(1);
    expect(res[0]?.id).toBe('ep-2');
  });

  it('returns [] when no files exist', async () => {
    expect(await queryEpisodic({})).toEqual([]);
  });
});
