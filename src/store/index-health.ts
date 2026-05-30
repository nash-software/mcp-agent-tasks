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
import { MAX_DB_BYTES } from './limits.js';

export interface HealthOpts {
  /** Override the maximum allowed db bytes (useful for tests). Defaults to MAX_DB_BYTES. */
  maxDbBytes?: number;
}

export type HealthResult = 'ok' | 'rebuilt';

/**
 * Ensure the SQLite index at dbPath is healthy before the server opens it.
 *
 * Healthy path  → returns `'ok'`. The caller should then open SqliteIndex normally.
 * Unhealthy path →
 *   1. Deletes db + WAL + SHM sidecar files.
 *   2. Opens a fresh SqliteIndex, calls rebuildFn(freshIndex) so all projects
 *      can be reconciled into it.
 *   3. Runs VACUUM + checkpoint on the fresh index, then closes it.
 *   4. Returns `'rebuilt'`.
 *
 * In both cases the caller is responsible for opening (or re-opening) its own
 * SqliteIndex after this function returns.  This avoids shared-ownership
 * ambiguity: ensureHealthyIndex never leaks an open connection to the caller.
 *
 * @param dbPath    Absolute path to the .index.db file.
 * @param opts      Optional overrides (e.g. maxDbBytes for tests).
 * @param rebuildFn Called with a temporary fresh SqliteIndex when a rebuild is
 *                  needed.  Must NOT close the index.
 * @returns 'ok' or 'rebuilt'
 */
export function ensureHealthyIndex(
  dbPath: string,
  opts: HealthOpts,
  rebuildFn: (freshIndex: SqliteIndex) => void,
): HealthResult {
  const maxBytes = opts.maxDbBytes ?? MAX_DB_BYTES;

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

  // --- 2. If still ok, open and run quick_check ---
  if (reason === null) {
    let probe: SqliteIndex | null = null;
    try {
      probe = new SqliteIndex(dbPath);
      probe.init();
      if (!probe.quickCheck()) {
        reason = 'quick_check failed (corrupt)';
      }
    } catch (err) {
      reason = `open/init failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      try { probe?.close(); } catch { /* ignore */ }
    }
  }

  if (reason === null) {
    return 'ok';
  }

  // --- 3. Corrupt or oversized — nuke and rebuild ---
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
  // The caller will open its own SqliteIndex for the session.
  fresh.vacuum();
  fresh.checkpoint();
  fresh.close();

  // If the rebuild did not complete cleanly, return 'ok' so the caller runs its
  // normal startup reconcile and re-populates the (now empty) index, rather than
  // skipping it on the assumption the rebuild succeeded (MCPAT-049 F4).
  return rebuildOk ? 'rebuilt' : 'ok';
}
