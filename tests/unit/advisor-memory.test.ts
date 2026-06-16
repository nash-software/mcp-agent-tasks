/**
 * Tests for src/store/advisor-memory.ts — pure logic only, no I/O.
 *
 * Covers:
 *  - selectMemoriesForContext: cap at 5, pinned-first, recency-ordered
 *  - computeDecay: flips faded after N zero-access sessions, exempts pinned
 *  - formatMemoryBlock: renders expected string, empty input, char cap
 */
import { describe, it, expect } from 'vitest';
import type { AdvisorMemory } from '../../src/types/advisor.js';
import {
  selectMemoriesForContext,
  computeDecay,
  formatMemoryBlock,
  MEMORY_CONTEXT_MAX,
  MEMORY_PINNED_MAX,
  MEMORY_DECAY_SESSIONS,
  MEMORY_BLOCK_MAX_CHARS,
} from '../../src/store/advisor-memory.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeMemory(overrides: Partial<AdvisorMemory> & { id: string }): AdvisorMemory {
  return {
    id: overrides.id,
    content: overrides.content ?? `Memory ${overrides.id}`,
    source_session_id: overrides.source_session_id ?? 'sess-1',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    last_accessed_at: overrides.last_accessed_at ?? '2026-01-01T00:00:00.000Z',
    access_count: overrides.access_count ?? 0,
    pinned: overrides.pinned ?? false,
    faded: overrides.faded ?? false,
  };
}

// ─── selectMemoriesForContext ──────────────────────────────────────────────────

describe('selectMemoriesForContext', () => {
  it('returns empty array for no memories', () => {
    expect(selectMemoriesForContext([])).toEqual([]);
  });

  it('excludes faded memories', () => {
    const memories = [
      makeMemory({ id: 'a', faded: true }),
      makeMemory({ id: 'b', faded: false }),
    ];
    const result = selectMemoriesForContext(memories);
    expect(result.map(m => m.id)).toEqual(['b']);
  });

  it('caps total at MEMORY_CONTEXT_MAX (5)', () => {
    const memories = Array.from({ length: 10 }, (_, i) =>
      makeMemory({ id: `m${i}`, last_accessed_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }),
    );
    const result = selectMemoriesForContext(memories);
    expect(result.length).toBe(MEMORY_CONTEXT_MAX);
  });

  it('places pinned memories first', () => {
    const memories = [
      makeMemory({ id: 'unpinned-1', pinned: false, last_accessed_at: '2026-01-03T00:00:00.000Z' }),
      makeMemory({ id: 'pinned-1', pinned: true, last_accessed_at: '2026-01-01T00:00:00.000Z' }),
      makeMemory({ id: 'unpinned-2', pinned: false, last_accessed_at: '2026-01-02T00:00:00.000Z' }),
    ];
    const result = selectMemoriesForContext(memories);
    expect(result[0].id).toBe('pinned-1');
  });

  it('sorts pinned memories by last_accessed_at descending', () => {
    const memories = [
      makeMemory({ id: 'p1', pinned: true, last_accessed_at: '2026-01-01T00:00:00.000Z' }),
      makeMemory({ id: 'p2', pinned: true, last_accessed_at: '2026-01-03T00:00:00.000Z' }),
      makeMemory({ id: 'p3', pinned: true, last_accessed_at: '2026-01-02T00:00:00.000Z' }),
    ];
    const result = selectMemoriesForContext(memories);
    expect(result.map(m => m.id)).toEqual(['p2', 'p3', 'p1']);
  });

  it('sorts unpinned memories by last_accessed_at descending', () => {
    const memories = [
      makeMemory({ id: 'u1', last_accessed_at: '2026-01-01T00:00:00.000Z' }),
      makeMemory({ id: 'u3', last_accessed_at: '2026-01-03T00:00:00.000Z' }),
      makeMemory({ id: 'u2', last_accessed_at: '2026-01-02T00:00:00.000Z' }),
    ];
    const result = selectMemoriesForContext(memories);
    expect(result.map(m => m.id)).toEqual(['u3', 'u2', 'u1']);
  });

  it('caps pinned at MEMORY_PINNED_MAX (3) and fills remaining slots with unpinned', () => {
    // 5 pinned memories — should cap at 3 pinned, then fill 2 with unpinned
    const memories = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeMemory({ id: `pinned-${i}`, pinned: true, last_accessed_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeMemory({ id: `unpinned-${i}`, pinned: false, last_accessed_at: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }),
      ),
    ];
    const result = selectMemoriesForContext(memories);
    expect(result.length).toBe(MEMORY_CONTEXT_MAX);
    const pinnedResults = result.filter(m => m.pinned);
    const unpinnedResults = result.filter(m => !m.pinned);
    expect(pinnedResults.length).toBe(MEMORY_PINNED_MAX);
    expect(unpinnedResults.length).toBe(MEMORY_CONTEXT_MAX - MEMORY_PINNED_MAX);
  });

  it('does not mutate the input array', () => {
    const memories = [makeMemory({ id: 'a' }), makeMemory({ id: 'b' })];
    const original = [...memories];
    selectMemoriesForContext(memories);
    expect(memories).toEqual(original);
  });
});

// ─── computeDecay ─────────────────────────────────────────────────────────────

describe('computeDecay', () => {
  it('fades non-pinned memory with access_count 0 after MEMORY_DECAY_SESSIONS sessions', () => {
    const memory = makeMemory({ id: 'a', access_count: 0, pinned: false });
    const result = computeDecay([memory], () => MEMORY_DECAY_SESSIONS);
    expect(result[0].faded).toBe(true);
  });

  it('does not fade memory that has been accessed (access_count > 0)', () => {
    const memory = makeMemory({ id: 'a', access_count: 1, pinned: false });
    const result = computeDecay([memory], () => MEMORY_DECAY_SESSIONS);
    expect(result[0].faded).toBe(false);
  });

  it('does not fade memory when sessionsSinceCreated < MEMORY_DECAY_SESSIONS', () => {
    const memory = makeMemory({ id: 'a', access_count: 0, pinned: false });
    const result = computeDecay([memory], () => MEMORY_DECAY_SESSIONS - 1);
    expect(result[0].faded).toBe(false);
  });

  it('exempts pinned memories from decay', () => {
    const memory = makeMemory({ id: 'a', access_count: 0, pinned: true });
    const result = computeDecay([memory], () => MEMORY_DECAY_SESSIONS + 5);
    expect(result[0].faded).toBe(false);
  });

  it('un-fades a previously faded pinned memory', () => {
    const memory = makeMemory({ id: 'a', pinned: true, faded: true });
    const result = computeDecay([memory], () => 0);
    expect(result[0].faded).toBe(false);
  });

  it('does not mutate the input array', () => {
    const memory = makeMemory({ id: 'a', access_count: 0, faded: false });
    const original = { ...memory };
    computeDecay([memory], () => MEMORY_DECAY_SESSIONS);
    expect(memory.faded).toBe(original.faded);
  });

  it('correctly handles mixed pinned and unpinned memories', () => {
    const memories = [
      makeMemory({ id: 'pinned', pinned: true, access_count: 0 }),
      makeMemory({ id: 'unfaded-accessed', pinned: false, access_count: 5 }),
      makeMemory({ id: 'should-fade', pinned: false, access_count: 0 }),
    ];
    const result = computeDecay(memories, () => MEMORY_DECAY_SESSIONS);
    const byId = Object.fromEntries(result.map(m => [m.id, m]));
    expect(byId['pinned'].faded).toBe(false);
    expect(byId['unfaded-accessed'].faded).toBe(false);
    expect(byId['should-fade'].faded).toBe(true);
  });
});

// ─── formatMemoryBlock ────────────────────────────────────────────────────────

describe('formatMemoryBlock', () => {
  it('returns empty string for empty input', () => {
    expect(formatMemoryBlock([])).toBe('');
  });

  it('renders correct prefix and content', () => {
    const memories = [makeMemory({ id: 'a', content: 'User prefers async communication' })];
    const result = formatMemoryBlock(memories);
    expect(result).toContain('Things I know about you:');
    expect(result).toContain('User prefers async communication');
  });

  it('joins multiple memories with period-space', () => {
    const memories = [
      makeMemory({ id: 'a', content: 'First fact' }),
      makeMemory({ id: 'b', content: 'Second fact' }),
    ];
    const result = formatMemoryBlock(memories);
    expect(result).toContain('First fact. Second fact');
  });

  it(`truncates output at MEMORY_BLOCK_MAX_CHARS (${MEMORY_BLOCK_MAX_CHARS})`, () => {
    const longContent = 'x'.repeat(200);
    const memories = Array.from({ length: 5 }, (_, i) =>
      makeMemory({ id: `m${i}`, content: longContent }),
    );
    const result = formatMemoryBlock(memories);
    expect(result.length).toBeLessThanOrEqual(MEMORY_BLOCK_MAX_CHARS);
  });

  it('does not truncate short content', () => {
    const memories = [makeMemory({ id: 'a', content: 'Short content' })];
    const result = formatMemoryBlock(memories);
    expect(result.length).toBeLessThan(MEMORY_BLOCK_MAX_CHARS);
    expect(result).toBe('Things I know about you: Short content.');
  });
});
