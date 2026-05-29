# P2-04b: Draft auto-triage (passive-capture → Haiku → auto-promote or needs-you queue)

**Type:** Feature
**Phase:** 2
**Epic:** MCPAT-022
**Size:** M — one new async function in `server-ui.ts`, two new fields through the full 5-layer stack
(types → schema → MarkdownStore → SqliteIndex → server handler), and one new endpoint.
No new views (UI surface is a sub-section inside the existing Today candidate queue, owned by P1-03).

---

## Description — WHY

The passive-capture hook silently creates `status:'draft'` tasks while the user is working. Those
drafts pile up with no reviewer. The only way to see them today is through `InboxView` — which this
epic deletes. Even when it existed, nobody opened it during deep work.

The fix closes the capture loop without adding friction: the moment a draft is created, the server
fires a background Haiku call that classifies it. High-confidence, clearly actionable drafts are
**auto-promoted to `todo`** — the user never has to touch them. Ambiguous or decision-like items stay
as drafts but gain a `triage_note` explaining why, so when the user glances at Today's candidate
queue they have the context to make the call in one tap.

The design principle: capture is instant and silent; triage is background and non-blocking;
human review is reserved only for genuinely ambiguous cases.

---

## Domain Model

### Draft lifecycle after this spec

```
passive-capture hook
  → creates status:'draft' task (already working)
  → server receives the new task ID
  → fires spawnBackgroundTriage(taskId, ...) — non-blocking, same fire-and-forget pattern as
    spawnBackgroundRouting in /api/capture/quick (~line 362 server-ui.ts)

spawnBackgroundTriage:
  → calls Haiku with the triage prompt (see §Technical Notes)
  → parses JSON response

  if confidence >= DRAFT_TRIAGE_THRESHOLD (default 0.8) AND needs_human === false:
    → patch task: project, priority, area from Haiku response
    → transition status: draft → todo
    → task appears as a normal unscheduled candidate in Today

  if confidence < DRAFT_TRIAGE_THRESHOLD OR needs_human === true:
    → patch task: triage_note, triage_confidence (status stays 'draft')
    → task surfaces in Today's "Needs your call · N" sub-section

  if Haiku unavailable / parse error / timeout:
    → patch task: triage_note = "Auto-triage unavailable — review manually"
    → status stays 'draft'
```

### Invariants

- **Capture response never waits for triage.** The HTTP response (200 + taskId) is sent before
  `spawnBackgroundTriage` is invoked — the function must be called after `sendJson`.
- **Confidence invariant:** `triage_note` is written if and only if `confidence < threshold`
  OR `needs_human === true` OR the Haiku call failed. If omitted from the Haiku response when
  confidence ≥ threshold, the field is left unset on the task.
- **Triage is idempotent:** re-triaging an already-promoted (`todo`) task has no effect on status;
  it may update `triage_note` and `triage_confidence` from the new response.
- **No task is silently lost.** Every failure path writes a `triage_note` and leaves the task as
  `draft` so the user can find it in the "Needs your call" queue.

---

## Acceptance Criteria

1. **Non-blocking capture:** A draft task created by the passive-capture hook triggers a background
   Haiku call within 5 seconds of creation. The HTTP response for the originating capture request
   returns before triage begins. Verified by: integration test asserting response time < 500ms with
   a mocked Haiku call that sleeps 2s; and that `triage_confidence` appears on the task only after
   that delay.

2. **Auto-promote path:** When the Haiku response has `confidence >= DRAFT_TRIAGE_THRESHOLD` and
   `needs_human === false`, the task's `status` transitions to `todo` and its `project`, `priority`,
   and `area` fields are updated to the inferred values. No human action required.
   Verified by: unit test mocking a high-confidence Haiku response; assert task `status === 'todo'`
   and fields match the mock response.

3. **Flag path:** When the Haiku response has `confidence < DRAFT_TRIAGE_THRESHOLD` OR
   `needs_human === true`, the task's `status` remains `'draft'`, `triage_note` is set to the
   Haiku-provided `triage_note` string, and `triage_confidence` is set to the returned score.
   Verified by: unit test mocking a low-confidence response; assert `status === 'draft'` and
   `triage_note` is non-empty.

4. **"Needs your call" surface:** Flagged drafts (status `'draft'` with a `triage_note`) appear in
   `GET /api/today` under a distinct `needs_review` array (alongside existing `committed` and
   `candidates`). Each entry includes `triage_note` and the Haiku-suggested `project`/`priority`/
   `area` for pre-filling the promote UI. Verified by: integration test creating a flagged draft and
   asserting it appears in `needs_review` but not in `candidates`.

5. **Manual re-triage endpoint:** `POST /api/tasks/:id/triage` re-runs the same Haiku triage logic
   on any existing task (not just drafts — the endpoint accepts any status but only auto-promotes
   from `draft`). Returns `{ triaged: true, promoted: boolean, triage_note?: string }` synchronously
   (waits for Haiku — this is a user-initiated action, not a background call).
   Verified by: integration test calling the endpoint on a draft task and asserting the response
   shape and task mutation.

6. **Threshold config:** `DRAFT_TRIAGE_THRESHOLD` environment variable, parsed as a float at server
   startup (default `0.8`, clamped to `[0.0, 1.0]`). When set to `0.0`, all Haiku responses with
   `needs_human === false` are auto-promoted regardless of confidence. When set to `1.0`, only
   `confidence === 1.0` results auto-promote (effectively disabling auto-promotion for the Haiku
   model). Verified by: unit test with threshold overridden to `0.0` and `1.0`.

7. **Field round-trip:** `triage_note` and `triage_confidence` survive a full markdown ↔ SQLite
   round-trip: write via `upsertTask`, rebuild index via `task_rebuild_index`, read back via
   `task_get`. Both fields appear in `schema/task.schema.json`. Verified by: integration test
   calling `rebuild-index` after writing a triaged draft and asserting fields are preserved.

8. **Failure fallback:** If the Haiku call fails for any reason (no API key, timeout >30s, spawn
   error, non-JSON response), the task's `status` remains `'draft'` and `triage_note` is set to
   `"Auto-triage unavailable — review manually"`. No exception propagates to the server's request
   handler. Verified by: unit test mocking spawn failure; assert `triage_note` equals the fallback
   string.

---

## Technical Notes

### Files to modify (5-layer pattern — same as P2-04 / `agent_status`)

| Layer | File | Change |
|---|---|---|
| Types | `src/types/task.ts` | Add `triage_note?: string` and `triage_confidence?: number` to `TaskFrontmatter` |
| Schema | `schema/task.schema.json` | Add `triage_note` (string, maxLength 500) and `triage_confidence` (number, min 0, max 1) as optional properties |
| Markdown store | `src/store/MarkdownStore.ts` | Read/write the two new fields in frontmatter serialisation / deserialisation |
| SQLite index | `src/store/SqliteIndex.ts` | Add `triage_note TEXT` and `triage_confidence REAL` columns; include in `upsertTask`, `getTask`, `listTasks`, migration guard |
| Server | `src/server-ui.ts` | (a) `spawnBackgroundTriage` function; (b) call it from the passive-capture write path; (c) `POST /api/tasks/:id/triage` endpoint; (d) `GET /api/today` extended with `needs_review` array; (e) `DRAFT_TRIAGE_THRESHOLD` env read at startup |

### `spawnBackgroundTriage` — insertion point

The passive-capture hook writes draft tasks via the existing store path. After the task is written
(and after `sendJson` returns the response), insert:

```ts
// Fire-and-forget — same pattern as spawnBackgroundRouting (~line 362)
spawnBackgroundTriage(taskId, task.title, captureContext, projectIndexes);
```

`captureContext` is whatever the passive-capture hook supplies (project prefix hint, surrounding
text snippet). Pass `null` if not available — the prompt handles it gracefully.

### `spawnBackgroundTriage` — structure (mirrors `spawnBackgroundRouting`)

```ts
function spawnBackgroundTriage(
  taskId: string,
  title: string,
  captureContext: string | null,
  projectIndexes: ProjectIndex[],
): void {
  const knownPrefixes = projectIndexes.map(p => p.prefix).join(', ');
  const prompt = buildTriagePrompt(title, captureContext, knownPrefixes);

  let finished = false;
  let stdout = '';

  try {
    const child = spawn('claude', [
      '--model', 'claude-haiku-4-5-20251001',
      '-p', prompt,
    ], { detached: false, stdio: ['ignore', 'pipe', 'ignore'] });

    const timer = setTimeout(() => {
      if (!finished) { finished = true; child.kill(); applyFallback(taskId, projectIndexes); }
    }, 30_000);

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });

    child.on('close', () => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      applyTriageResult(taskId, stdout, projectIndexes);
    });

    child.on('error', () => {
      clearTimeout(timer);
      if (finished) return;
      finished = true;
      applyFallback(taskId, projectIndexes);
    });
  } catch {
    applyFallback(taskId, projectIndexes);
  }
}
```

`applyTriageResult` parses the JSON, validates fields, and either promotes or flags the task.
`applyFallback` writes `triage_note = "Auto-triage unavailable — review manually"`.

### Haiku prompt contract

```
System: "You are triaging a passively captured draft task. Return JSON only."

User: "Title: {title}
Project hint: {prefix or 'unknown'}
Context: {capture_context or 'none'}

Classify this draft:
- project: one of [{known_prefixes}] or 'GEN' if unclear
- priority: critical|high|medium|low
- area: client|personal|outsource|internal
- confidence: 0.0-1.0 (how certain are you of project+priority)
- needs_human: true if this is a decision/question/ambiguous, false if it's a clear actionable task
- triage_note: one short sentence explaining low confidence or why needs_human=true (omit if confidence>=0.8 and needs_human=false)"
```

**Model:** `claude-haiku-4-5-20251001` — fast, cheap, background-safe.

**JSON parse strategy:** extract the first `{...}` block from stdout (Haiku sometimes emits a
leading newline or trailing whitespace). Validate that all required keys are present; if missing,
treat as parse failure and call `applyFallback`.

### `POST /api/tasks/:id/triage` — endpoint contract

- **Request:** `POST /api/tasks/:id/triage` with empty body or `{}`.
- **Behaviour:** synchronous — waits for the Haiku call to complete (up to 30s timeout).
- **Response (success):** `{ triaged: true, promoted: boolean, triage_note?: string,
  triage_confidence?: number }`.
- **Response (task not found):** 404 `{ error: 'NOT_FOUND' }`.
- **Response (Haiku failure):** 200 `{ triaged: true, promoted: false, triage_note:
  "Auto-triage unavailable — review manually" }` — never a 5xx.
- **Auto-promote guard:** only transitions `status: draft → todo`. If the task is already `todo`
  or any other status, the endpoint updates `triage_note` / `triage_confidence` but does not
  change `status`.

### `GET /api/today` — extended response

Add a `needs_review` array alongside `committed` and `candidates`:

```ts
interface TodayResponse {
  committed: Task[];
  candidates: Task[];
  needs_review: Task[];   // NEW — status:'draft' tasks with triage_note set
  capacity: { committedMinutes: number; targetMinutes: number };
}
```

`needs_review` is populated by querying SQLite for tasks where `status = 'draft'` and
`triage_note IS NOT NULL`. Order by `last_activity DESC`. The UI sub-section "Needs your call · N"
is implemented in P1-03's update; this spec owns the data contract only.

### `DRAFT_TRIAGE_THRESHOLD` env var

Read at `startUiServer` startup:

```ts
const DRAFT_TRIAGE_THRESHOLD = Math.min(1.0, Math.max(0.0,
  parseFloat(process.env['DRAFT_TRIAGE_THRESHOLD'] ?? '0.8')
));
```

Pass as a parameter into `spawnBackgroundTriage` and the `applyTriageResult` helper.

---

## Failure Modes

| Scenario | Behaviour |
|---|---|
| No `ANTHROPIC_API_KEY` / Haiku unavailable | `spawnBackgroundTriage` catches spawn error; calls `applyFallback`; task stays `draft` with `triage_note = "Auto-triage unavailable — review manually"` |
| Haiku responds with non-JSON / truncated output | `applyTriageResult` catches JSON parse error; calls `applyFallback` |
| Haiku response missing required keys | Treated as parse failure; `applyFallback` |
| Haiku timeout (>30s) | Timer fires `child.kill()`; `applyFallback` |
| `upsertTask` throws during promote | Log error server-side; task stays `draft` (never half-promoted); `triage_note` not written |
| `POST /api/tasks/:id/triage` on non-existent task | 404 — no side effects |
| `spawnBackgroundTriage` called on already-promoted task | `applyTriageResult` skips status transition; updates `triage_note`/`triage_confidence` only |

---

## Out of Scope

- **"Needs your call" UI sub-section in TodayView** — owned by P1-03's update. This spec delivers
  the `needs_review` array in `GET /api/today` and the field contract; P1-03 renders it.
- **Real-time push to UI** — polling `GET /api/today` every 30s (existing interval) is sufficient.
  Triage completes within ~5s; the user will see the result on the next poll.
- **Bulk re-triage of existing drafts** — the `POST /api/tasks/:id/triage` endpoint covers
  manual per-task re-triage. A bulk endpoint is not in scope.
- **`agent_status` field** — owned by P2-04 (Hermes backend). The two new fields here
  (`triage_note`, `triage_confidence`) are independent and can be added in the same migration if
  P2-04 and P2-04b land together, or independently if not.
- **InboxView** — deleted by P1-02. This spec does not resurrect it.

---

## Dependencies

- **P2-04 (`agent_status` field):** Uses the same 5-layer field-addition pattern
  (types → schema → MarkdownStore → SqliteIndex → server). If P2-04 and P2-04b land in the same
  sprint, coordinate the SQLite migration (single `ALTER TABLE` statement for all new columns is
  preferred over two separate migrations). If they land independently, both must include migration
  guards (`IF NOT EXISTS` / version check) so neither breaks the other.
- **P1-03 (Today view):** Must consume the new `needs_review` array from `GET /api/today` and
  render the "Needs your call · N" sub-section above the regular candidate list. Each row shows
  `triage_note` as a secondary line, pre-fills the suggested `project`/`priority`/`area`, and
  provides a one-tap "Promote" action (`POST /api/tasks/:id/promote`) plus an optional edit path.
  This spec owns the data; P1-03 owns the render.

---

## Testing

### Unit tests (`tests/unit/`)

| Test | Assertion |
|---|---|
| `buildTriagePrompt` — with context | Prompt contains title, project hint, context string, known prefixes |
| `buildTriagePrompt` — context null | Prompt contains `'none'` for context |
| `applyTriageResult` — high confidence, !needs_human | Task promoted to `todo`; project/priority/area patched; `triage_note` absent |
| `applyTriageResult` — low confidence | Task stays `draft`; `triage_note` and `triage_confidence` written |
| `applyTriageResult` — needs_human true | Task stays `draft`; `triage_note` written even if confidence ≥ threshold |
| `applyTriageResult` — malformed JSON | Falls through to `applyFallback`; `triage_note = "Auto-triage unavailable — review manually"` |
| `applyFallback` | `triage_note = "Auto-triage unavailable — review manually"`; status unchanged |
| `DRAFT_TRIAGE_THRESHOLD` clamping | `1.5` → `1.0`; `-0.1` → `0.0`; `NaN` → `0.8` (default) |
| `POST /api/tasks/:id/triage` — promote path | Response `{ triaged: true, promoted: true }` |
| `POST /api/tasks/:id/triage` — flag path | Response `{ triaged: true, promoted: false, triage_note: '...' }` |
| `POST /api/tasks/:id/triage` — Haiku failure | Response `{ triaged: true, promoted: false, triage_note: 'Auto-triage unavailable...' }` |
| `POST /api/tasks/:id/triage` — already todo | Status unchanged; `triage_note` updated |

### Integration tests (`tests/integration/`)

| Test | Assertion |
|---|---|
| Draft → background triage → auto-promote round-trip | Create draft, mock Haiku (high confidence), wait for background call, assert task is `todo` with correct project/priority/area |
| Draft → background triage → flag round-trip | Create draft, mock Haiku (low confidence), assert task is `draft` with `triage_note` |
| `GET /api/today` with flagged draft | Flagged draft appears in `needs_review`, not in `candidates` |
| `GET /api/today` with promoted draft | Promoted task appears in `candidates` (if unscheduled) or `committed` (if scheduled) |
| `POST /api/tasks/:id/triage` endpoint — full cycle | Call endpoint, assert synchronous response, assert task mutation persisted to markdown and SQLite |
| Markdown ↔ SQLite round-trip | Write task with `triage_note` + `triage_confidence`, run `rebuild-index`, read back, assert both fields preserved |
| Capture response latency | Assert HTTP 200 arrives before background Haiku call finishes (mock Haiku to sleep 2s) |

---

## Open Questions

- **Should auto-promoted tasks get `scheduled_for = today` if captured during work hours?**
  Default: **no.** Auto-promoted tasks land unscheduled as normal candidates; the user schedules
  them deliberately via the Today candidate queue. The capture-to-calendar path is a deliberate
  commitment, not an inference. Revisit if user feedback shows unscheduled candidate queue grows
  too large.
