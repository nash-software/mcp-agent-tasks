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

/**
 * Maximum SQLite index file size in bytes (100 MiB).
 * If the .index.db file exceeds this threshold at startup, the index is
 * treated as oversized and rebuilt from markdown source of truth.
 */
export const MAX_DB_BYTES = 100 * 1024 * 1024;

/**
 * Maximum number of lines kept in the agent-log.jsonl rolling log.
 * Lines beyond this cap are trimmed from the head on each append.
 */
export const AGENT_LOG_MAX = 500;
