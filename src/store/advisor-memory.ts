/**
 * Pure-logic functions for advisor memory context selection and decay.
 * No I/O — all functions are deterministic and synchronous for trivial unit testing.
 */

import type { AdvisorMemory } from '../types/advisor.js';

/** Maximum number of sessions with access_count === 0 before a memory is faded. */
export const MEMORY_DECAY_SESSIONS = 10;

/** Maximum number of memories to include in a chat context block (pinned + unpinned). */
export const MEMORY_CONTEXT_MAX = 5;

/** Maximum number of pinned memories to include in a chat context block. */
export const MEMORY_PINNED_MAX = 3;

/** Maximum character count for the rendered memory block injected into the system prompt. */
export const MEMORY_BLOCK_MAX_CHARS = 550;

/**
 * Select the best memories for inclusion in a chat context block.
 *
 * Rules:
 *  - Faded memories are excluded.
 *  - Pinned memories are sorted first, then non-pinned sorted by last_accessed_at descending.
 *  - Cap: up to MEMORY_PINNED_MAX pinned + (MEMORY_CONTEXT_MAX - pinned_count) non-pinned.
 *  - Returns a new array; does not mutate input.
 */
export function selectMemoriesForContext(memories: AdvisorMemory[]): AdvisorMemory[] {
  const active = memories.filter(m => !m.faded);
  const pinned = active.filter(m => m.pinned).sort(
    (a, b) => b.last_accessed_at.localeCompare(a.last_accessed_at),
  );
  const unpinned = active.filter(m => !m.pinned).sort(
    (a, b) => b.last_accessed_at.localeCompare(a.last_accessed_at),
  );

  const selectedPinned = pinned.slice(0, MEMORY_PINNED_MAX);
  const remainingSlots = MEMORY_CONTEXT_MAX - selectedPinned.length;
  const selectedUnpinned = unpinned.slice(0, remainingSlots);

  return [...selectedPinned, ...selectedUnpinned];
}

/**
 * Apply session-based decay to memories.
 *
 * For each non-pinned memory with access_count === 0 where
 * sessionsSinceCreated(m) >= MEMORY_DECAY_SESSIONS, set faded = true.
 * Pinned memories are always kept (faded: false).
 *
 * Returns a new array; does not mutate input.
 *
 * @param memories - Full set of memories to evaluate.
 * @param sessionsSinceCreated - Function returning the number of sessions that have
 *   elapsed since the memory was created (caller computes from stored session list).
 */
export function computeDecay(
  memories: AdvisorMemory[],
  sessionsSinceCreated: (m: AdvisorMemory) => number,
): AdvisorMemory[] {
  return memories.map(m => {
    if (m.pinned) {
      // Pinned memories are immune to decay.
      return m.faded ? { ...m, faded: false } : m;
    }
    const shouldFade = m.access_count === 0 && sessionsSinceCreated(m) >= MEMORY_DECAY_SESSIONS;
    if (shouldFade && !m.faded) {
      return { ...m, faded: true };
    }
    return m;
  });
}

/**
 * Render a memory block string for injection into the advisor system prompt.
 *
 * Format: "Things I know about you: [c1]. [c2]. ..."
 * Truncated to MEMORY_BLOCK_MAX_CHARS (whole-sentence truncation not guaranteed — hard char cut).
 * Returns '' for empty input.
 */
export function formatMemoryBlock(selected: AdvisorMemory[]): string {
  if (selected.length === 0) return '';

  const items = selected.map(m => m.content.trim()).join('. ');
  const full = `Things I know about you: ${items}.`;

  if (full.length <= MEMORY_BLOCK_MAX_CHARS) return full;
  return full.slice(0, MEMORY_BLOCK_MAX_CHARS);
}
