/**
 * index-health.ts — Startup integrity + size self-heal for the SQLite index.
 *
 * Call ensureHealthyIndex() once at server boot, before constructing the
 * SqliteIndex you will use for the session.
 *
 * If the database is corrupt or oversized it will be deleted and rebuilt
 * from the markdown source of truth so the server can boot cleanly.
 */

import fs from 'node:fs';
import { SqliteIndex } from './sqlite-index.js';
import { MAX_DB_BYTES, BLOAT_RATIO_THRESHOLD, MIN_PAGE_FLOOR } from './limits.js';

export interface HealthOpts {
  /** Override the maximum allowed db bytes (useful for tests). Defaults to MAX_DB_BYTES. */
  maxDbBytes?: number;
  /**
   * Free-page ratio threshold above which the DB is considered bloated.
   * Only applies when page_count >= minPageFloor.
   * Defaults to BLOAT_RATIO_THRESHOLD (0.4).
   */
  bloatRatio?: number;
  /**
   * Minimum page count before the ratio-based bloat check kicks in.
   * Tiny DBs are never rebuilt on ratio alone.
   * Defaults to MIN_PAGE_FLOOR (256).
   */
  minPageFloor?: number;
}

export type HealthResult = 'ok' | 'rebuilt';

/**
 * Result returned by ensureHealthyIndex (Step D — single DB open at boot).
 *
 * - healthy path: `result='ok'`, `index` is the already-open, already-init'd
 *   SqliteIndex that was used for the health probe. The caller MUST close it
 *   when done (or adopt it as the session index).
 * - unhealthy/rebuilt path: `result='rebuilt'`, `index=null`. The caller must
 *   open its own fresh SqliteIndex.
 *
 * This eliminates the double-open that previously occurred when:
 *   1. ensureHealthyIndex opened a probe (then closed it), and
 *   2. server.ts opened a second SqliteIndex immediately after.
 */
export interface HealthCheckResult {
  result: HealthResult;
  /** Open SqliteIndex on the healthy path; null on the rebuilt path. */
  index: SqliteIndex | null;
}

/**
 * Ensure the SQLite index at dbPath is healthy before the server opens it.
 *
 * Healthy path:
 *   Returns `{ result: 'ok', index: <open SqliteIndex> }`.
 *   The caller receives the already-open connection that was used for the
 *   health probe — no second DB open is required. The caller owns the
 *   connection and MUST call close() when the server shuts down.
 *
 * Unhealthy path (corrupt, oversized, or bloated):
 *   1. Deletes db + WAL + SHM sidecar files.
 *   2. Opens a fresh SqliteIndex, calls rebuildFn(freshIndex) so all projects
 *      can be reconciled into it.
 *   3. Runs VACUUM + checkpoint on the fresh index, then closes it.
 *   4. Returns `{ result: 'rebuilt', index: null }`.
 *      The caller must open its own SqliteIndex for the session.
 *
 * Error semantics:
 *   If the probe connection cannot be closed on a corrupt path, the handle is
 *   released before deletion — this prevents Windows WAL-lock errors on unlink.
 *
 * @param dbPath    Absolute path to the .index.db file.
 * @param opts      Optional overrides (e.g. maxDbBytes for tests).
 * @param rebuildFn Called with a temporary fresh SqliteIndex when a rebuild is
 *                  needed.  Must NOT close the index.
 * @returns HealthCheckResult
 */
export function ensureHealthyIndex(
  dbPath: string,
  opts: HealthOpts,
  rebuildFn: (freshIndex: SqliteIndex) => void,
): HealthCheckResult {
  const maxBytes = opts.maxDbBytes ?? MAX_DB_BYTES;
  const bloatRatio = opts.bloatRatio ?? BLOAT_RATIO_THRESHOLD;
  const minPageFloor = opts.minPageFloor ?? MIN_PAGE_FLOOR;

  let reason: string | null = null;

  // --- 1. Check file size first (cheaper than opening SQLite) ---
  if (fs.existsSync(dbPath)) {
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(dbPath).size;
    } catch {
      reason = 'stat-failed';
    }
    if (reason === null && sizeBytes > maxBytes) {
      reason = `oversized (${sizeBytes} bytes > ${maxBytes} threshold)`;
    }
  }

  // --- 2. If still ok, open and run quick_check + ratio check ---
  // On the healthy path we keep the probe open and return it to the caller
  // so the DB is opened only once at boot (MCPAT-071 Step D).
  let probe: SqliteIndex | null = null;
  if (reason === null) {
    try {
      probe = new SqliteIndex(dbPath);
      probe.init();
      if (!probe.quickCheck()) {
        reason = 'quick_check failed (corrupt)';
      } else {
        // Ratio-based bloat detection: rebuild if too many dead pages (MCPAT-071 Step B).
        // Only triggers above MIN_PAGE_FLOOR so trivially small DBs are left alone.
        const ratio = probe.freePageRatio();
        const pages = probe.pageCount();
        if (ratio > bloatRatio && pages >= minPageFloor) {
          reason = `bloated (${(ratio * 100).toFixed(1)}% free pages, ${pages} pages)`;
        }
        // Stale status CHECK constraint detection (MCPAT-084): pre-MCPAT-084 DBs lack
        // 'closed' in the tasks.status CHECK. SQLite cannot ALTER a CHECK constraint,
        // so we route through the existing nuke-and-rebuild path.
        if (reason === null && probe.hasStaleStatusConstraint()) {
          reason = 'stale status CHECK constraint (missing closed)';
        }
      }
    } catch (err) {
      reason = `open/init failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    // NOTE: Do NOT close probe here on the healthy path — we return it to the caller.
    // On the unhealthy path we close it below before deletion (Windows lock safety).
  }

  if (reason === null) {
    // Healthy — hand the already-open connection back so the caller doesn't need
    // to open the DB a second time. probe is non-null here (no error path).
    return { result: 'ok', index: probe };
  }

  // --- 3. Corrupt or oversized — close probe (if open) then nuke and rebuild ---
  // Close the probe first so Windows can unlink the file (WAL lock).
  try { probe?.close(); } catch { /* ignore */ }

  console.error(`[index-health] rebuilding: ${reason}`);

  // Delete db + WAL + SHM sidecar files (ignore errors — file may not exist)
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ignore */ }
  }

  const fresh = new SqliteIndex(dbPath);
  fresh.init();

  let rebuildOk = true;
  try {
    rebuildFn(fresh);
  } catch (err) {
    rebuildOk = false;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[index-health] rebuildFn error: ${msg}`);
  }

  // Compact the freshly built index and flush WAL, then close the temp instance.
  // The caller must open its own SqliteIndex for the session.
  fresh.vacuum();
  fresh.checkpoint();
  fresh.close();

  // If the rebuild did not complete cleanly, return 'ok' so the caller runs its
  // normal startup reconcile and re-populates the (now empty) index, rather than
  // skipping it on the assumption the rebuild succeeded (MCPAT-049 F4).
  // In both cases index=null — the caller must open their own SqliteIndex.
  return { result: rebuildOk ? 'rebuilt' : 'ok', index: null };
}
