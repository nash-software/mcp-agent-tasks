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
/** Maximum number of file paths stored per task (prevents index bloat). */
export const MAX_FILES = 200;

/**
 * Maximum SQLite index file size in bytes (~25 MiB).
 * Still ~4x a generous working set, but no longer 17x.
 * If the .index.db file exceeds this threshold at startup, the index is
 * treated as oversized and rebuilt from markdown source of truth.
 */
export const MAX_DB_BYTES = 25 * 1024 * 1024;

/**
 * Free-page ratio above which the index is considered bloated and will be
 * rebuilt by ensureHealthyIndex. 0.4 = 40% of pages are dead/unused.
 * Only triggers when page_count >= MIN_PAGE_FLOOR to avoid churning tiny DBs.
 */
export const BLOAT_RATIO_THRESHOLD = 0.4;

/**
 * Minimum page count before the ratio-based bloat check kicks in.
 * Tiny DBs can have a high ratio by accident (e.g. a handful of rows after
 * bulk deletion) but are so small that rebuilding gains nothing.
 * 256 pages * 4 KiB/page = 1 MiB minimum before ratio check applies.
 */
export const MIN_PAGE_FLOOR = 256;

/**
 * Maximum number of lines kept in the agent-log.jsonl rolling log.
 * Lines beyond this cap are trimmed from the head on each append.
 */
export const AGENT_LOG_MAX = 500;
