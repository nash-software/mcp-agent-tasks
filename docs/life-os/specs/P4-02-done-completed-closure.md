# P4-02 — Done → Complete → Completed sprint-closure tab

**Type:** Feature
**Phase:** Phase 4 — Make the read-only UI usable
**Epic:** MCPAT-041 (Life OS — Phase 4: Usability)
**Task:** MCPAT-043
**Size:** L
**Depends on:** P4-01 (transition route + mutation client). Coordinates with P4-03 (Done-column action).
**Owners:** api-specialist (batch-close route + closed/archived modelling) · ui-specialist (Done-column "Complete all" + Completed tab)

> Read `docs/life-os/specs/00-epic-overview.md` first — §4 (data shapes, `Status` union), §5 (client
> conventions). This resolves audit **decision 1** (`docs/life-os/audit/2026-05-30-functional-audit.md`
> §A3, "Product decisions required" #1): *where does done work go?* Answer: **Done stays a board column;
> a deliberate "Complete all" batch action closes the whole Done column into a terminal `closed`/archived
> state; a new "Completed" tab renders those as a sprint-closure summary.** Markdown-first, fail-closed,
> idempotent.

---

## Why

Today (audit §A3) "Done" tasks just sort to the bottom of the committed list (`TodayView.tsx:42`); there
is **no archive concept and no Completed view**, and **no idempotency guard** against re-closing. The Done
board column accumulates forever. Sprint closure — the deliberate "this batch of work is finished, sweep it
away and summarise it" gesture — does not exist.

The model: **`done` is a working column**, not the end. A user finishes tasks (→ `done`, via P4-01's
transition). When the Done column is "full" / the sprint ends, they hit **"Complete all"** in the
Done-column menu, which moves every `done` task into a terminal closed state stamped with a batch id, and
those tasks then surface in a **Completed** tab grouped as a sprint-closure summary (counts, titles, total
estimate burned). Done tasks **stay in the Done column** until "Complete all" fires.

---

## Scope

**In scope**
- **Terminal closed state.** Model "completed/closed" (see *Modelling decision* below). Closing a `done`
  task moves it out of the active board (no longer in `done`) into the terminal state with a
  **completion batch id + timestamp**.
- **`POST /api/tasks/close-batch`** (or per the chosen modelling) — closes **all** currently-`done` tasks of
  the active scope into the terminal state in one idempotent batch; returns the batch summary. Skips tasks
  not in `done` (no Done-on-Done, no double-close).
- **Done-column "Complete all" action** — surfaced in the Board Done-column header/menu. Confirms, then
  fires the batch close. (The Board *renders* this; P4-03 owns the column menu chrome — coordinate.)
- **New "Completed" tab/nav entry** — renders closed tasks grouped by completion batch (or completion
  date), each group showing: count, task titles, total `estimate_hours` burned. Read-only summary view.
- **Markdown-first / fail-closed:** write goes through the store (markdown → SQLite), same write protocol
  as every other mutation; if the batch write fails partway, the next reconcile corrects (no half-closed
  UI claim).

**Out of scope**
- Board drag-and-drop — **P4-03** (this spec only adds the Done-column "Complete all" action; P4-03 owns
  the DnD + column chrome it lives in — coordinate, don't duplicate).
- Editing/reopening a *closed* task — closing is terminal for this phase (reopen-from-closed is an Open Q).
- Per-task manual archive — closure is a **batch** gesture only in this phase.
- Estimate-on-commit prompt — **P4-04** (this spec only *reads* `estimate_hours` for the burn-down total).

---

## Data shapes / API contract

### Modelling decision (FLAGGED — must be settled before build)

Two viable models for "completed/closed". **Recommended: a dedicated `closed` status** (cleaner state
machine, queryable, mirrors the existing union) over an orthogonal `archived` boolean flag.

| Option | Shape | Pros | Cons |
|---|---|---|---|
| **A. `closed` status (recommended)** | extend `Status` union with `closed`; add `closed_at` + `close_batch` fields | one source of truth (status); board filters `status==='done'`; Completed tab filters `status==='closed'`; reuses transition machine | touches the canonical `Status` union + state machine (`transitions.ts`) + `task.schema.json` |
| **B. `archived` flag** | keep `status:'done'`, add `archived:true` + `closed_at` + `close_batch` | no union change | dual truth (status *and* archived); every board/today query must now also exclude `archived`; the bug class the codebase explicitly warns against (overview §9 "duplicate state") |

> **Default = Option A** (`closed` status). It avoids the duplicate-state anti-pattern (overview §9) and
> keeps a single queryable terminal state. If the team prefers B, the ACs below translate (swap
> `status==='closed'` for `archived===true`). **Settle this in build step 1.**

Assuming Option A:

```ts
type Status = 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled' | 'closed'; // + closed (terminal)

interface Task {
  // …existing…
  closed_at?: number;     // epoch ms — when the batch close ran
  close_batch?: string;   // batch id, e.g. "close-2026-05-30T14:22:00Z" — groups a sprint closure
}
```

State machine addition (`src/types/transitions.ts`): `done → closed` (terminal). `closed` has **no**
outgoing transitions in this phase.

### `POST /api/tasks/close-batch`

| | |
|---|---|
| Request body | `{ project?: string }` — optional scope; default = all projects' `done` tasks |
| Behaviour | For each task with `status==='done'` in scope: transition `done → closed`, stamp `closed_at` + shared `close_batch`. **Skip** any task not in `done` (idempotent). |
| Success | `200` → `{ batch: string; closed: number; tasks: Task[]; totalEstimateHours: number }` |
| Errors | `400` (bad scope); `500` only on store write failure (fail-closed — no partial UI claim) |

- **Idempotency:** running it twice closes the *new* `done` tasks only; the second run on an empty Done
  column returns `{ closed: 0 }` — never re-closes already-`closed` tasks (no double-close), never throws
  Done-on-Done.

### `GET` for the Completed tab

Reuse `GET /api/tasks` and filter client-side to `status==='closed'`, grouped by `close_batch`
(falling back to `closed_at` date). No new GET route required unless the closed set grows large — if so,
add `GET /api/tasks/completed` returning pre-grouped batches (Open Q; default: client-side filter).

---

## Acceptance Criteria

1. **Closed terminal state exists.** Per the chosen model, a closed task is no longer `status==='done'`
   (Option A: `status==='closed'`). The board's Done column query excludes it; it does not reappear in
   Today's committed list. Persistence confirmed on re-read (markdown + SQLite).
2. **`done → closed` is the only entry to closed.** A `todo`/`in_progress`/`blocked` task cannot be closed
   directly — only `done` tasks are swept by the batch. (State machine: `done → closed` only.)
3. **"Complete all" closes the whole Done column.** With N `done` tasks, invoking the Done-column
   "Complete all" action calls `POST /api/tasks/close-batch`; all N move to closed under **one shared
   `close_batch` id**; the Done column is then empty.
4. **Idempotent — no double-close.** Running "Complete all" again on an empty Done column returns
   `{ closed: 0 }` and changes nothing. Already-`closed` tasks are never re-stamped / re-closed. No
   Done-on-Done error surfaces.
5. **Done tasks persist until closure.** Marking a task `done` (P4-01) leaves it in the Done column; it is
   **not** auto-closed. Only "Complete all" moves it to closed. (Verifies Done is a working column.)
6. **Completed tab renders grouped batches.** A new "Completed" nav entry shows closed tasks grouped by
   `close_batch` (fallback `closed_at` date). Each group shows: task count, task titles, and **total
   `estimate_hours` burned** (Σ over the group's tasks). Empty state when no closed tasks.
7. **Fail-closed.** If the batch store write fails, no task is reported closed to the UI for that failure;
   a re-read (and the next reconcile) reflects the true on-disk state — no phantom "closed" in the UI.
8. **Gates pass.** `npm run type-check` (strict, no `any`) and `npm run build` succeed.

---

## Build steps

1. **Settle the modelling decision + extend the model.** Default to Option A: add `closed` to the `Status`
   union (`src/types/task.ts`), add `done → closed` (terminal) to `src/types/transitions.ts`, add
   `closed_at` + `close_batch` to the type + `schema/task.schema.json` + SQLite columns/migration
   (mirror how P2-04 added `agent_status`, and how `area`/`scheduled_for` migrations are done). **Test:**
   unit — `isValidTransition('done','closed')` true; `isValidTransition('todo','closed')` false; schema
   accepts the new fields; SQLite migration round-trips them.
2. **Store batch-close method.** Add `TaskStore.closeBatch({ project? })`: select `status==='done'` tasks,
   generate one `close_batch` id + `closed_at`, transition each `done → closed` via the existing transition
   path, write per the standard protocol (SQLite → markdown → index.yaml). Skip non-`done` tasks. Return
   `{ batch, closed, tasks, totalEstimateHours }`. **Test:** integration — N done → closeBatch → all
   `closed` with shared batch id, persisted; second call → `{ closed: 0 }`; a non-done task is untouched.
3. **`POST /api/tasks/close-batch` route (`server-ui.ts`).** Add the route near the other task routes
   (mirror P4-01's transition block shape: resolve store → call `closeBatch` → `sendError` on failure →
   return summary). Fail-closed: only report tasks actually written. **Test:** integration — POST closes
   the Done column, returns the summary; idempotent on re-POST; bad scope → 400.
4. **Done-column "Complete all" action.** In the Board Done-column header/menu (coordinate with P4-03's
   column chrome — if P4-03 hasn't shipped, add a minimal Done-column header button), add "Complete all"
   with a confirm. On confirm fire a `closeBatch` mutation (TanStack, invalidate `['tasks']`/`['today']`,
   optimistic clear of Done with `onError` rollback, overview §5). **Test:** RTL — clicking "Complete all"
   fires the mutation; Done column clears; rejected promise rolls back.
5. **Completed tab + grouped summary.** Add a "Completed" nav entry (`nav.ts` / `Nav.tsx` — follow the
   existing tab-registration pattern) and a `views/CompletedView.tsx` that reads `GET /api/tasks`, filters
   `status==='closed'`, groups by `close_batch` (fallback `closed_at` date), and renders per-group count /
   titles / total estimate burned. Tokens §3, no modal. **Test:** RTL — closed tasks render grouped by
   batch with correct counts + summed estimate; empty state when none.

---

## Test notes

- **Unit (store + transitions):** `done → closed` validity, batch idempotency, `totalEstimateHours` sum,
  schema + migration round-trip (ACs 1–2, 4).
- **Integration (api-specialist):** `/close-batch` closes the column, idempotent re-POST, fail-closed
  behaviour (ACs 3–5, 7). Assert persistence by re-read.
- **Unit (UI, RTL):** "Complete all" wiring + Completed view grouping/summary (ACs 3, 6).
- **Gate:** `npm run type-check` + `npm test` green before PR.

---

## Failure modes

- **Double-close / Done-on-Done.** Batch only selects `status==='done'`; already-`closed` tasks are never
  in the selection → re-run is a no-op `{ closed: 0 }`. No `INVALID_TRANSITION` thrown to the user.
- **Partial batch write.** Fail-closed: the store write protocol commits atomically per task; on failure
  the UI must re-read true state (reconcile corrects). Never optimistically mark "closed" without a
  confirmed write for that task.
- **Duplicate state (if Option B chosen).** If `archived` flag is used, every board/today/candidate query
  MUST also exclude `archived` — missing one re-introduces the overview §9 duplicate-state bug. Option A
  avoids this entirely.

---

## Open questions

1. **Modelling — `closed` status vs `archived` flag.** Default: `closed` status (Option A). Settle in
   build step 1 with the team; ACs translate if B is chosen.
2. **Reopen from closed.** This phase treats `closed` as terminal (no outgoing transitions). If reopening a
   closed task is needed, add `closed → todo`/`in_progress` later — flag, don't build now.
3. **Closure scope.** Default scope = all projects' `done` tasks. If per-project sprint closure is wanted,
   the `project` param already supports it — confirm the UX (one global "Complete all" vs per-project).
