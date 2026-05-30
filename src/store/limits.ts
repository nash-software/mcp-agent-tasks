/**
 * Shared cap constants for child-array sizes.
 *
 * These are applied in both the SQLite layer (sqlite-index.ts upsertTask)
 * and the in-memory/markdown layer (markdown-store.ts write, task-store.ts
 * transition/commit mutations) so that all three stores remain in agreement.
 *
 * Never duplicate these literals — always import from this module.
 */
export const MAX_TRANSITIONS = 100;
export const MAX_COMMITS = 50;
export const MAX_TAGS = 50;
