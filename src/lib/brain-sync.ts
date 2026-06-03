import type { NoteRecord } from '../types/note.js';
import type { SqliteIndex } from '../store/sqlite-index.js';

/**
 * Note → brain write-back.
 *
 * STATUS: disabled. The brain MCP server (BRAIN_MCP_URL) currently exposes only READ
 * tools — brain_search, brain_search_all, brain_sources, brain_wiki_read, brain_wiki_at,
 * brain_health. There is no write/store tool, so notes cannot be pushed into the brain
 * index yet. Attempting a write would fail on every save and stamp a permanent
 * `brain_sync_failed` flag (amber dot) on every note — pure noise.
 *
 * The Advisor does NOT depend on this: it reads notes directly from the local NoteStore,
 * so disabling write-back costs nothing today. The SQLite `brain_sync_failed` column and
 * the index helpers are retained for forward-compatibility.
 *
 * To re-enable when the brain gains a write tool (e.g. `brain_store`): set
 * BRAIN_NOTE_SYNC=1 and implement the call using the Streamable HTTP transport
 * (Accept: application/json, text/event-stream; initialize → mcp-session-id → tools/call;
 * SSE response parsing) — see brainMcpToolCall in server-ui.ts for the working pattern.
 */

function noteSyncEnabled(): boolean {
  return process.env['BRAIN_NOTE_SYNC'] === '1';
}

/**
 * Fire-and-forget note → brain sync. No-op unless BRAIN_NOTE_SYNC=1 (no brain write tool
 * exists yet). Never throws. Safe to call without await.
 */
export function syncNoteToBrain(_note: NoteRecord, _index: SqliteIndex): void {
  if (!noteSyncEnabled()) return;
  // Intentionally not implemented until the brain exposes a write tool. When it does,
  // wire the Streamable HTTP call here and mark/clear brain_sync_failed accordingly.
}

/**
 * Retry sync for notes previously flagged as failed. No-op while note sync is disabled —
 * any pre-existing flags are cleared so stale amber dots don't linger.
 */
export async function retryFailedBrainSyncs(index: SqliteIndex): Promise<void> {
  await Promise.resolve();
  if (noteSyncEnabled()) return; // real retry path would live here when enabled
  // Clear any stale flags left by an earlier (broken) sync attempt so the UI is clean.
  try {
    for (const note of index.getNotesPendingBrainSync()) {
      index.clearNoteBrainSyncFailed(note.id);
    }
  } catch {
    // index unavailable — ignore
  }
}
