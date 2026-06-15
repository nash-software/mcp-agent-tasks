# MCPAT-087: Persist triage sweep results so the view rehydrates without re-running the AI sweep

**Type**: Feature
**Priority**: High
**Status**: Todo

## Description

The AI triage sweep (Tier-2 LLM batch) is expensive — it can take minutes and consumes claude API quota. Currently, results live in two volatile layers: React `useState` in `TriageView.tsx` (cleared on navigation or page reload) and the server-side `triageRunCache` Map in `server-ui.ts` (cleared on tray restart). The JSONL audit only persists decisions that have been applied, never previewed/swept results. Users are forced to re-run the full sweep every time they open the Triage view or restart the tray — even if nothing has changed.

Persisting the latest sweep report to disk eliminates the re-run tax and makes `POST /api/triage/apply` reliable across server restarts.

## Acceptance Criteria

- [ ] **AC-1 — Write on run**: `POST /api/triage/run` writes the full `TriageReport` + a top-level `savedAt` ISO-8601 timestamp to `scratchpads/.triage-runs/latest.report.json` (atomic rename) immediately after the sweep completes, overwriting any prior file.
- [ ] **AC-2 — GET /api/triage/latest**: New endpoint returns the persisted file as JSON if it exists; returns `404 { error: 'NO_LATEST_RUN' }` if not. Response includes the `savedAt` field from the file.
- [ ] **AC-3 — TriageView rehydrates on mount**: On mount, `TriageView` queries `/api/triage/latest` (new React Query key `['triage','latest']`). If the response is a full AI sweep report (`report.ranAI === true` or equivalent discriminator), it renders those results immediately with a "last run X ago" badge derived from `savedAt`. The existing `['triage','preview']` (Tier-0) query is only used as a fallback when `/latest` returns 404.
- [ ] **AC-4 — "last run X ago" badge**: When displaying a rehydrated report, a badge in the Triage toolbar shows human-readable elapsed time (e.g. "last run 2h ago"). The badge is absent when displaying a live just-run result or the Tier-0 preview.
- [ ] **AC-5 — Apply fallback reads from file**: `POST /api/triage/apply` — if the `runId` is absent from the in-memory `triageRunCache` (e.g. after server restart) — reads decisions from `latest.report.json` and validates that the `runId` matches before proceeding. Returns `409 { error: 'RUN_MISMATCH' }` if the runId does not match the persisted file.
- [ ] **AC-6 — Apply clears the file**: After a successful `POST /api/triage/apply`, `latest.report.json` is deleted (or overwritten with `null`/empty sentinel). A subsequent `/api/triage/latest` returns 404, causing `TriageView` to fall back to Tier-0 preview on next load.
- [ ] **AC-7 — Re-run overwrites immediately**: Clicking "Re-run AI sweep" replaces the displayed results with the new report immediately on success (no diff view). The new report is written to `latest.report.json`, replacing the previous one.
- [ ] **AC-8 — Atomic write**: The file write uses a temp-file + rename pattern (consistent with project's atomic write convention) to prevent a partially-written file from being served.

### Testing
- [ ] Unit tests for the `writeLatestReport` / `readLatestReport` helper functions (happy path + partial-write / missing-dir recovery)
- [ ] Unit test: `POST /api/triage/apply` with cold `triageRunCache` reads from file and succeeds; mismatched runId returns 409
- [ ] Unit test: `GET /api/triage/latest` returns 404 when file absent, returns report when present
- [ ] Integration test: run sweep → navigate away → reload → results displayed without re-running

## Technical Notes

### Files to modify

- **`src/server-ui.ts`** (~L1274): Add `writeLatestReport` / `readLatestReport` helpers alongside `rememberTriageRun`. Call `writeLatestReport` at the end of the `POST /api/triage/run` handler (L3566, after `rememberTriageRun`). Add the `GET /api/triage/latest` route. Modify `POST /api/triage/apply` to fall back to file on cache miss. Delete file on successful apply.
- **`src/triage/audit.ts`**: Consider co-locating `writeLatestReport` / `readLatestReport` here alongside `writeRun`/`readRun` — both use `scratchpads/.triage-runs/` and follow the same atomic-write pattern.
- **`src/ui/src/api.ts`**: Add `fetchTriageLatest(): Promise<TriageReport | null>` function calling `GET /api/triage/latest` (return null on 404).
- **`src/ui/src/views/TriageView.tsx`** (~L104–L119): Replace or supplement the `preview` query with a `latest` query. Derive `ranAI` from the loaded report's source (latest vs preview). Add the "last run X ago" badge to the toolbar.

### Persisted file shape

```ts
// scratchpads/.triage-runs/latest.report.json
interface PersistedTriageReport extends TriageReport {
  savedAt: string // ISO-8601, written by server on POST /api/triage/run
}
```

The existing `TriageReport` type (in `src/triage/types.ts`) already contains `runId`, `decisions`, `skips`, and `summary` — only `savedAt` is new.

### Apply fallback guard

```ts
// In POST /api/triage/apply handler (cold cache path):
const persisted = await readLatestReport()
if (!persisted || persisted.runId !== body.runId) {
  sendJson(res, 409, { error: 'RUN_MISMATCH', message: 'runId does not match persisted run — re-run the sweep' })
  return
}
const decisions = persisted.decisions
```

### Atomic write pattern (follow existing convention)

```ts
import { writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const LATEST_REPORT_PATH = join(TRIAGE_RUNS_DIR, 'latest.report.json')

function writeLatestReport(report: PersistedTriageReport): void {
  const tmp = LATEST_REPORT_PATH + '.tmp'
  writeFileSync(tmp, JSON.stringify(report, null, 2), 'utf8')
  renameSync(tmp, LATEST_REPORT_PATH)
}
```

### "last run X ago" — elapsed formatting

Reuse or extend the existing `fmtElapsed` utility in `src/ui/src/lib/format.ts` if suitable. Badge renders only when the view is in rehydrated (not freshly-run) mode.

### Discriminating rehydrated vs live results

Add a transient boolean `isRehydrated` to the `TriageView` local state (or derive from whether the report came from `/latest` vs the `sweep` mutation) to gate the badge. Do not persist this field to the JSON file — it is UI-only.

## Failure Modes

| Scenario | Behaviour |
|---|---|
| Disk full / write fails during `writeLatestReport` | Log warning, continue — report still served from in-memory Map for this session; next session falls back to Tier-0 preview. Non-fatal. |
| `latest.report.json` is corrupt / invalid JSON | `readLatestReport` catches JSON.parse error, returns null; server returns 404 from `/api/triage/latest`; `TriageView` falls back to Tier-0 preview. |
| `POST /api/triage/apply` with stale runId (tasks mutated since sweep) | Apply proceeds (same behaviour as today — no staleness check is in scope). |
| Server restart between run and apply | Apply reads decisions from file; succeeds as long as runId matches. |
| `scratchpads/.triage-runs/` directory missing | `writeLatestReport` must `mkdirSync` with `{ recursive: true }` before writing. |

## Out of Scope

- Per-run history (keep only `latest.report.json`; per-run history is already served by audit JSONL)
- Staleness warnings when tasks are mutated after the sweep
- Diff view between prior and new sweep results on re-run
- Any changes to the Tier-0 preview caching behaviour
- localStorage or React Query persistence plugins
- Surfacing `latest.report.json` in the undo flow (undo reads from audit JSONL, not latest)

## Open Questions

- After a successful Apply clears `latest.report.json`, should `TriageView` drop back to Tier-0 preview automatically (recommended safe default), or show a "sweep applied — re-run for next batch" empty state? Defer to implementation.

## Effort Estimate

**S** (half-day to 1 day)

Rationale: ~30 lines of server changes (write helper + new endpoint + apply fallback), ~20 lines of UI changes (new query + badge). No new dependencies. Atomic write pattern already established in codebase.
