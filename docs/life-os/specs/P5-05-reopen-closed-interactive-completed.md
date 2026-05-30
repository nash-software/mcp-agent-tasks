# P5-05 — Reopen closed tasks + interactive CompletedView

**Type:** Feature
**Phase:** Phase 5 — Close the daily-use gaps + harden the gate
**Epic:** MCPAT-050 (Life OS — Phase 5)
**Task:** MCPAT-055
**Size:** M
**Depends on:** P5-01 (real gate). Builds on P4-01 (`/transition`) and P4-02 (`closed` terminal status +
CompletedView).
**Owners:** api-specialist (transition map) · ui-specialist (CompletedView interactivity)

> Read `docs/life-os/specs/00-epic-overview.md` first — §4 (`Status` union incl. `closed`), §5
> (optimistic mutations). Read **P4-02** (`P4-02-done-completed-closure.md`) — it introduced the `closed`
> terminal status and the CompletedView this spec makes interactive. Evidence: audit §B1, §B2
> (`transitions.ts:28` — `closed` has no out-transition; `CompletedView.tsx:158-172` — plain
> non-clickable `<li>`) — **do NOT re-investigate.**

---

## Why

P4-02 modelled sprint closure as a `closed` terminal status. But `closed` has **no out-transition**
(`src/types/transitions.ts` / client `lib/transitions.ts:28` — `closed: []`), so a task closed by a
mistaken "Complete all" is **permanently stuck** (audit §B1). And the CompletedView renders rows as plain
`<li>` with no click/action (`CompletedView.tsx:158-172`, audit §B2) — a dead-end tab. This spec makes
`closed` reopenable (`closed → todo` / `closed → in_progress`) on both server and client state machines,
and makes Completed rows open the TaskPanel so closed tasks can be inspected and reopened.

---

## Scope

**In scope**
- Add `closed → todo` and `closed → in_progress` to the **server** state machine
  (`src/types/transitions.ts`) and the **client** mirror (`src/ui/src/lib/transitions.ts:28` —
  `isValidBoardTransition` / `VALID_TRANSITIONS`).
- Make `CompletedView` rows **clickable → open the TaskPanel** (peek/detail), so a closed task can be
  inspected and reopened from the panel.
- A **Reopen** affordance in the TaskPanel for a `closed` task → `transitionTask(id, 'todo'|'in_progress')`
  via the existing `/transition` route (P4-01), optimistic + rollback + toast.

**Out of scope**
- Adding `closed` to the **board** as a draggable column — Completed is its own tab (P4-02). Reopen
  happens via the panel, not board drag.
- Bulk reopen — single-task reopen only.
- New transition HTTP route — `/transition` already exists (P4-01); this spec only widens the allowed
  transition map.
- `archived` reopen — `archived` stays terminal.

---

## Data shapes / API contract

### State-machine change (canonical — `src/types/transitions.ts`)

```
closed → todo, in_progress     (NEW — reopen)
```

- The client mirror (`src/ui/src/lib/transitions.ts:28`) must match: `closed: ['todo', 'in_progress']`.
- The **server is the source of truth** — a 409 from `/transition` still rolls the client back (P4-01).
- The `/transition` route (P4-01) needs **no change** — it bridges `task_transition`/`isValidTransition`,
  which now permits the new edges. (If the `task_transition` **tool enum** restricts targets, confirm
  `todo`/`in_progress` are allowed targets — they are in the P4-01 contract:
  `todo|in_progress|done|blocked`.)
- `archived` remains `[]` (terminal). `closed` is **not** terminal after this change.

No request/response shape change — `POST /api/tasks/:id/transition { to: 'todo'|'in_progress' }` already
exists; it now succeeds from a `closed` source.

---

## Acceptance Criteria

1. **Server permits `closed → todo`/`in_progress`.** `isValidTransition('closed','todo')` and
   `isValidTransition('closed','in_progress')` return `true`; all other `closed → X` remain `false`.
   (Falsifiable: unit on `src/types/transitions.ts`.)
2. **Transition route reopens a closed task.** `POST /api/tasks/:id/transition { to: 'in_progress' }` on a
   `closed` task → `200` with `status: 'in_progress'` and a new transitions entry; persisted (markdown +
   index). `{ to: 'done' }` on a `closed` task still → `409 INVALID_TRANSITION`. (Falsifiable: integration
   matrix.)
3. **Client mirror matches.** `lib/transitions.ts:28` has `closed: ['todo','in_progress']`;
   `isValidBoardTransition('closed','todo')` returns `true`. (Falsifiable: unit; and `tsc -b` stays green
   — the map must remain a valid `Record`/`Partial<Record>` per P5-01.)
4. **Completed rows open the panel.** Clicking a row in `CompletedView` (`CompletedView.tsx:158-172`)
   opens the TaskPanel for that task (peek or detail), instead of being an inert `<li>`. (Falsifiable:
   RTL — clicking a Completed row sets the selected task / opens the panel.)
5. **Reopen affordance.** For a `closed` task, the TaskPanel shows a **Reopen** control (to
   `todo` or `in_progress`) that fires `transitionTask`; it is hidden for non-closed tasks. After reopen,
   the task leaves the Completed list. (Falsifiable: RTL — Reopen fires the transition; the task moves
   out of Completed.)
6. **Optimistic + rollback + error surface.** Reopen is optimistic with `onError` rollback and a visible
   error on failure (overview §5). (Falsifiable: a rejected reopen restores the closed state + shows an
   error.)
7. **Gates pass.** `npm run type-check` (`tsc -b` green) + `npm run build` succeed; `npm test` green.

---

## Build steps

1. **Widen server state machine.** In `src/types/transitions.ts`, add `closed: ['todo','in_progress']`.
   Confirm `archived` stays `[]`. **Test:** unit — `isValidTransition('closed','todo')` true;
   `('closed','done')` false; `('archived', X)` false.
2. **Widen client mirror.** In `src/ui/src/lib/transitions.ts:28`, set `closed: ['todo','in_progress']`.
   Ensure the map shape keeps `tsc -b` green (P5-01). **Test:** unit on `isValidBoardTransition`.
3. **Confirm transition route + tool enum.** Verify `POST /api/tasks/:id/transition` (P4-01) accepts the
   new source without change; if the `task_transition` tool enum gates **targets**, confirm
   `todo`/`in_progress` are permitted (they are). No route code change expected. **Test:** integration —
   reopen a closed fixture → 200 persisted; `closed → done` → 409.
4. **Clickable Completed rows.** In `CompletedView.tsx:158-172`, make each row open the TaskPanel
   (set selected task / panel mode), reusing the existing row-click → panel pattern from other views
   (e.g. TodayView/Board peek-on-click). **Test:** RTL — clicking a Completed row opens the panel.
5. **Reopen control in TaskPanel.** Show a **Reopen** action for `closed` tasks → `transitionTask(id,
   'todo')` (and/or an `in_progress` option), optimistic + rollback + toast; hide it for non-closed.
   Invalidate `['tasks']` / the Completed query so the row leaves the list. **Test:** RTL — Reopen fires
   the transition and the task exits Completed; rejected reopen rolls back + errors.
6. **Run gates.** `npm run type-check` + `npm run build` + `npm test`.

---

## Test notes

- **Unit (store):** the new `closed → todo|in_progress` edges; `closed → done`/other still rejected;
  `archived` still terminal (ACs 1).
- **Integration (api-specialist):** reopen a `closed` fixture via `/transition` → 200 persisted;
  `closed → done` → 409 (AC2).
- **Unit (UI, RTL):** Completed row opens panel (AC4); Reopen fires transition + leaves Completed +
  rollback/error (ACs 5, 6).
- **Gate:** `npm run type-check` (`tsc -b`) + `npm test` before PR.

---

## Failure modes

- **Client/server map drift.** If only the client mirror is widened, the server 409s the reopen and it
  silently rolls back (looks broken). Both maps must change together — server is source of truth.
- **Re-adding `closed → done`.** Don't widen beyond `todo`/`in_progress`; a `closed → done` self-loop is
  meaningless and a Done-on-Done-class no-op.
- **Inert Completed rows.** Leaving the `<li>` non-interactive keeps the dead-end (audit §B2). Rows must
  open the panel.
- **Map breaks `tsc -b`.** Editing `lib/transitions.ts` must keep the `Record`/`Partial<Record>` valid
  (P5-01) — don't reintroduce a TS2739/partial-map error.

---

## Open questions

1. **Reopen target default.** `closed → todo` (back to queue) vs `closed → in_progress` (resume). Default:
   offer **both** in the panel; if a single default is needed, **`todo`** (re-triage before resuming).
   Confirm with user.
2. **Completed query invalidation key.** Confirm the Completed list's query key (from P4-02) so reopen
   invalidates the right cache and the row leaves immediately. Default: invalidate `['tasks']` + the
   Completed-specific key; verify against P4-02's implementation.
