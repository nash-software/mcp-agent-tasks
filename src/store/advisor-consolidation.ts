/**
 * Consolidation pass — episodic-to-semantic memory upgrade.
 *
 * Runs:
 *   1. On session close (triggered by server-ui.ts close handler) — T2.2
 *   2. Via POST /api/advisor/consolidate (manual / nightly cron) — T2.3
 *
 * NIGHTLY CRON (add to OS scheduler after T2.3 ships):
 *   0 3 * * * node -e "import('./dist/store/advisor-consolidation.js').then(m => m.consolidateAll())"
 *
 * This file is a stub for Phase 0. Full arbiter logic (T2.1) and consolidation pass (T2.2)
 * are implemented in Phase 2.
 *
 * RunLLM seam — every LLM call uses this injectable type so tests run under CLAUDE_CLI_DISABLED=1:
 *   type RunLLM = (prompt: string, opts?: { tier?: PrismTier; cold?: boolean }) => Promise<string>
 */

import type { PrismTier } from '../types/advisor.js';

/** Injectable LLM runner — pass a mock in tests, real runner in production. */
export type RunLLM = (prompt: string, opts?: { tier?: PrismTier; cold?: boolean }) => Promise<string>;

/**
 * Consolidate a single session: extract candidate entities from the episodic log,
 * run the arbiter against existing entities, write results.
 *
 * Idempotent: re-running on the same session_id produces no duplicate entities
 * (dedupe by session_id + entity content hash).
 *
 * Full implementation: T2.2. This stub returns immediately.
 */
export async function consolidateSession(
  _sessionId: string,
  _runLLM: RunLLM,
): Promise<void> {
  // T2.2: implement arbiter + entity extraction
}

/**
 * Consolidate ALL sessions that have not yet been processed.
 * Used by the nightly cron and the manual /api/advisor/consolidate endpoint.
 *
 * Full implementation: T2.3. This stub returns immediately.
 */
export async function consolidateAll(
  _runLLM: RunLLM,
): Promise<void> {
  // T2.3: iterate unprocessed sessions, call consolidateSession
}
