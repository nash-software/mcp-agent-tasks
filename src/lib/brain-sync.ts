import type { NoteRecord } from '../types/note.js';
import type { SqliteIndex } from '../store/sqlite-index.js';

const BRAIN_MCP_URL_DEFAULT = 'https://nash-vps.tail5c5009.ts.net:8093';
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

function getBrainUrl(): string {
  return process.env['BRAIN_MCP_URL'] ?? BRAIN_MCP_URL_DEFAULT;
}

async function postToBrain(payload: unknown): Promise<boolean> {
  const res = await fetch(`${getBrainUrl()}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'brain_store',
        arguments: payload,
      },
      id: 1,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  return res.ok;
}

async function trySync(note: NoteRecord): Promise<boolean> {
  const payload = {
    id: note.id,
    body: note.body,
    project: note.project,
    tags: note.tags,
    task_id: note.task_id,
  };

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]!));
    }
    try {
      const ok = await postToBrain(payload);
      if (ok) return true;
    } catch {
      // network error — will retry
    }
  }
  return false;
}

/**
 * Fire-and-forget: sync a note to the brain knowledge base.
 * On persistent failure, marks the note with brain_sync_failed = 1.
 * Never throws — designed to be called without await.
 */
export function syncNoteToBrain(note: NoteRecord, index: SqliteIndex): void {
  void trySync(note).then(ok => {
    if (!ok) {
      try {
        index.markNoteBrainSyncFailed(note.id);
      } catch {
        // Index may be closed if server is shutting down — ignore
      }
    } else {
      try {
        index.clearNoteBrainSyncFailed(note.id);
      } catch {
        // Ignore
      }
    }
  }).catch(() => {
    // Catch any unhandled rejection from trySync itself
  });
}

/**
 * Retry sync for all notes that previously failed.
 * Called on server boot. Runs synchronously (sequential) to avoid overwhelming the brain.
 */
export async function retryFailedBrainSyncs(index: SqliteIndex): Promise<void> {
  let pending: NoteRecord[];
  try {
    pending = index.getNotesPendingBrainSync();
  } catch {
    return; // index error — skip silently
  }

  for (const note of pending) {
    try {
      const ok = await trySync(note);
      if (ok) {
        index.clearNoteBrainSyncFailed(note.id);
      }
    } catch {
      // Keep flag set — will retry on next boot
    }
  }
}
