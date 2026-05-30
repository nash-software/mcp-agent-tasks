# P4-01 — Task mutation layer + editable panel

**Type:** Feature
**Phase:** Phase 4 — Make the read-only UI usable
**Epic:** MCPAT-041 (Life OS — Phase 4: Usability)
**Task:** MCPAT-042
**Size:** L
**Depends on:** none (foundational — unblocks P4-02, P4-03, P4-04)
**Owners:** api-specialist (HTTP routes) · ui-specialist (TaskPanel editing + api/hook rewire)

> Read `docs/life-os/specs/00-epic-overview.md` first — §3 (tokens), §4 (data shapes,
> `Status`/`Priority` unions), §5 (client conventions: optimistic mutations, query keys). This is the
> **keystone** of Phase 4: the audit (`docs/life-os/audit/2026-05-30-functional-audit.md` §0, A1, A2)
> found the UI is a read-only shell — the client already *defines* `transitionTask()` and
> `updateTaskPriority()` (`src/ui/src/api.ts:173,190`) but they target HTTP routes that **do not exist**
> in `server-ui.ts`, and the errors are swallowed by `if (res.ok)` guards. This spec builds those two
> routes by **bridging the existing MCP tool logic** (`task_update`, `task_transition`) and makes the
> task panel editable. Everything else in Phase 4 (board DnD, Done lifecycle, estimate-on-commit)
> depends on the transition route landing here.

---

## Why

The mutation layer was never implemented. Concretely:

| Client call (`api.ts`) | Targets | Server today |
|---|---|---|
| `updateTaskPriority()` (`api.ts:190`) | `PATCH /api/tasks/:id` | ❌ no PATCH handler at all |
| `transitionTask()` (`api.ts:173`) | `POST /api/tasks/:id/transition` | ❌ no `/transition` route |

`TaskPanel.tsx` renders title/why/priority/estimate as read-only text. The only action button is
mis-wired to the draft-only `/promote` route, which 400s on a real task and is swallowed — this is why
"J then Enter does nothing" (audit A2). There is **no `in_progress` affordance anywhere** — the UI can
read an in-progress task (`HeroTask.tsx`) but can never *start* one.

The fix is not to reinvent mutation logic. The store already encapsulates it: `TaskStore.updateTask`
(`src/store/task-store.ts:79`) enforces the field allow-list and rejects status changes;
`TaskStore.transitionTask` (`:153`) enforces the state machine via `isValidTransition`
(`src/types/transitions.ts:13`) and throws `INVALID_TRANSITION`. The two new HTTP routes **bridge**
that logic — same as `POST /signoff` (P2-04) bridges the signoff field write.

---

## Scope

**In scope**
- `PATCH /api/tasks/:id` — bridge `task_update` fields: `title`, `why`, `priority`, `estimate_hours`.
- `POST /api/tasks/:id/transition` — bridge `task_transition` with the state-machine + idempotency guards.
- Make `TaskPanel.tsx` fields editable (title, why, priority, estimate). Add a **"Start"** (→ `in_progress`)
  control. Re-point the panel "Done" button OFF `/promote` ONTO the real transition route.
- Re-wire `src/ui/src/api.ts` (`updateTaskPriority` → real PATCH; generalize to `updateTask`;
  `transitionTask` already targets the right route — confirm) and `hooks/useToday.ts` (`markDone`,
  reopen, `blockTask` → real transition). Errors must now **surface to the user** (toast / inline),
  not be swallowed.

**Out of scope**
- `project`/`area` re-assignment editing in the panel — `task_update` does **not** allow changing
  `project` (it is the ID prefix; re-assignment is `rerouteTask`, a separate concern). The brief lists
  "project/area" but the store's `updateTask` allow-list (`task-store.ts:13-30`) excludes them. Edit
  only the fields `task_update` actually permits; flag project re-assignment as a follow-up (Open Q).
- Done → Complete → Completed tab and archive batch — **P4-02**.
- Drag-and-drop — **P4-03**. (This spec ships the transition route DnD will call.)
- Estimate-on-commit prompt — **P4-04**. (This spec ships editable estimate in the panel.)

---

## Data shapes / API contract

State machine (canonical, from `src/types/transitions.ts:3-11` — **do not redefine, import**):

```
todo        → in_progress, blocked
in_progress → done, blocked, todo, approved
blocked     → in_progress, todo
done        → in_progress            (reopen only)
draft       → approved, blocked
approved    → in_progress, draft, blocked
archived    → (terminal)
```

### `PATCH /api/tasks/:id`

| | |
|---|---|
| Request body | `{ title?: string; why?: string; priority?: Priority; estimate_hours?: number }` (all optional; at least one) |
| Success | `200` → full updated `Task` |
| Errors | `400 INVALID_FIELD` (bad priority enum, title >200, why >1000, status key present); `404 TASK_NOT_FOUND` |

- `Priority = 'critical' | 'high' | 'medium' | 'low'` (overview §4; `task_update` enum `task-update.ts:17`).
- **Reject `status` in the PATCH body** with `400` — status changes go through `/transition` only,
  mirroring `updateTask`'s own guard (`task-store.ts:82`). Surface that as a clear error.

### `POST /api/tasks/:id/transition`

| | |
|---|---|
| Request body | `{ to: Status; reason?: string }` |
| Success | `200` → full updated `Task` (with appended `transitions[]` entry) |
| Errors | `400 INVALID_FIELD` (`to` missing / not a valid status); `404 TASK_NOT_FOUND`; `409 INVALID_TRANSITION` (transition not allowed from current status — e.g. Done-on-Done) |

- `to` ∈ the `task_transition` enum (`task-transition.ts:16`): `'todo' | 'in_progress' | 'done' | 'blocked'`.
  (`approved` is reachable from `in_progress` in the store map but the tool enum omits it — keep the tool
  enum as the contract; do not widen here.)
- **Idempotency / guard:** a transition that `isValidTransition` rejects (Done→Done, etc.) returns
  **409 `INVALID_TRANSITION`**, never a silent success. The store already throws this `McpTasksError`
  code — map it to HTTP 409.

> Client contract is already written: `api.ts:178` posts `{ to, reason }`; `api.ts:184` reads `err.error`.
> Both routes must therefore return errors as `{ error: <CODE> }` via the existing `sendError` helper
> (`server-ui.ts:416`) so the client's `err.error` read works and the message surfaces.

---

## Acceptance Criteria

1. **`POST /api/tasks/:id/transition` exists and bridges `task_transition`.** Posting `{ to: 'in_progress' }`
   to a `todo` task returns `200` with `status: 'in_progress'` and a new `transitions[]` entry; re-reading
   the task (fresh `getTask`) confirms persistence to markdown + SQLite.
2. **Transition guard surfaces, does not swallow.** Posting `{ to: 'done' }` to an already-`done` task
   returns **`409 { error: 'INVALID_TRANSITION' }`** (Done-on-Done rejected). Posting `{ to: 'bogus' }`
   returns `400`. Posting to an unknown ID returns `404 TASK_NOT_FOUND`. No path returns 200 on a
   rejected transition.
3. **`PATCH /api/tasks/:id` exists and bridges `task_update`.** `PATCH` with `{ priority: 'high' }`
   returns `200` with the updated task; with `{ title: 'x' }` updates the title; with
   `{ estimate_hours: 2 }` sets the estimate. Persistence confirmed on re-read.
4. **PATCH rejects status + invalid fields.** `PATCH` with `{ status: 'done' }` returns `400` (status
   must use `/transition`); `{ priority: 'urgent' }` returns `400 INVALID_FIELD`; `{ title: <201 chars> }`
   returns `400`. Unknown ID → `404`.
5. **TaskPanel is editable.** Title, why, priority, and estimate render as editable controls (input /
   textarea / priority cycle or select / number input). Committing an edit fires `updateTask` (PATCH)
   and the panel reflects the saved value. (Read-only text replaced — audit A1.)
6. **"Start" affordance exists.** The panel shows a **Start** action for a `todo`/`blocked` task that
   POSTs `{ to: 'in_progress' }`; it is hidden/disabled when the task is already `in_progress` or `done`.
   (Closes audit A2 — "no in_progress affordance anywhere".)
7. **"Done" button is re-pointed.** The panel's primary done action no longer calls `/promote`; it calls
   `transitionTask(id, 'done')`. After clicking Done on an `in_progress` task the task reads `done`.
   The draft-only `/promote` route is **only** used where a `draft`→`approved`/`todo` promotion is
   intended (if at all in the panel).
8. **`useToday` mutations hit the real route.** `markDone`, reopen, and `blockTask` in
   `hooks/useToday.ts` call `transitionTask` against `/transition`; on a non-2xx the mutation's
   `onError` fires (optimistic rollback + user-visible error), per overview §5. No swallowed 404.
9. **Errors surface to the user.** A rejected transition or PATCH produces a visible toast/inline error
   (not a console-only log, not a silent no-op). The swallowed-404 problem (audit §0) is gone.
10. **Gates pass.** `npm run type-check` (strict, no `any`) and `npm run build` succeed.

---

## Build steps

1. **Bridge layer for transition (`server-ui.ts`).** Insert a `transitionMatch` route block **before** the
   404 fallthrough and near the existing `scheduleMatch` (`server-ui.ts:1196`) and `signoffMatch`
   (`:1231`) blocks — copy that exact shape (regex → `projectIndexes.find(p => taskId.startsWith(p.prefix+'-'))`
   → 404 if absent → read body → mutate → upsert → return). Inside, call the store's transition logic:
   resolve the project's `TaskStore` (the indexes expose the store; mirror how `signoff`/`triage` reach
   the task) and call `store.transitionTask(taskId, body.to, body.reason)`. Wrap in try/catch: map
   `McpTasksError` code `INVALID_TRANSITION` → HTTP 409, `TASK_NOT_FOUND` → 404, `INVALID_FIELD` → 400,
   via `sendError(res, code, err.message)`. Validate `body.to` is a string in the transition enum first
   (400 otherwise). **Test:** integration — boot server on ephemeral port; `POST /transition {to:'in_progress'}`
   on a `todo` fixture → 200 + persisted; Done-on-Done → 409; bad `to` → 400; unknown id → 404.
2. **Bridge layer for PATCH (`server-ui.ts`).** Add a `PATCH` branch on the
   `^/api/tasks/([^/]+)$` path (no sub-segment). Read JSON body, **reject if `status` key present** (400),
   then call `store.updateTask(taskId, { title?, why?, priority?, estimate_hours? })` — the store enforces
   the allow-list and throws `INVALID_FIELD` for anything else. Map errors as in step 1. Return the
   updated task. **Test:** integration — `PATCH {priority:'high'}` → 200 persisted; `PATCH {status:'done'}`
   → 400; `PATCH {priority:'urgent'}` → 400; unknown id → 404.
3. **Rewire `api.ts`.** Generalize `updateTaskPriority` into `updateTask(id, fields: Partial<{title,why,priority,estimate_hours}>)`
   keeping a thin `updateTaskPriority` wrapper for existing callers. Confirm `transitionTask` already
   targets `/transition` (it does, `api.ts:173`) — leave its shape, it now hits a live route. Both must
   throw on non-2xx (they already do) so mutations roll back. **Test:** type-check passes; existing
   `updateTaskPriority` callers still compile.
4. **Rewire `hooks/useToday.ts`.** Point `markDone`, reopen, `blockTask` at `transitionTask`
   (`'done'`/`'in_progress'`/`'blocked'`). Ensure each is a TanStack `useMutation` with optimistic update
   + `onError` rollback + `invalidate(['today'])` / `['tasks']` (overview §5). **Test:** unit — `markDone`
   calls `transitionTask(id,'done')`; a rejected promise triggers rollback (no permanent optimistic state).
5. **Editable TaskPanel + Start/Done (`components/TaskPanel.tsx`).** Replace read-only title/why/priority/
   estimate with controlled editable controls that commit via `updateTask`. Add a **Start** button (→
   `transitionTask(id,'in_progress')`, shown for `todo`/`blocked`). Re-point the existing "Done" button to
   `transitionTask(id,'done')` (remove the `/promote` call for real tasks). Surface mutation errors as a
   toast/inline message. Respect tokens (§3) and the slide-in panel (no modal). **Test:** RTL — editing
   title fires PATCH with new title; clicking Start fires transition to `in_progress`; clicking Done fires
   transition to `done`; a rejected transition shows a visible error.

---

## Test notes

- **Integration (api-specialist):** mirror the existing `server-ui` test harness (ephemeral port +
  `fetch`). Cover the 200 / 400 / 404 / 409 matrix for both routes (ACs 1–4). Assert persistence by
  re-reading via `GET /api/tasks` or a fresh index `getTask`.
- **Unit (store):** `transitionTask` already has guard coverage; add a case asserting Done→Done throws
  `INVALID_TRANSITION` if not already present.
- **Unit (UI, RTL):** TaskPanel editable fields + Start/Done wiring (ACs 5–7); `useToday` rewire (AC 8);
  error surfacing (AC 9).
- **Gate:** `npm run type-check` + `npm test` green before PR.

---

## Failure modes

- **Done-on-Done (idempotency).** `isValidTransition('done','done')` is false → store throws
  `INVALID_TRANSITION` → HTTP 409. The button should be disabled when already done (defense in depth),
  but the server is the source of truth.
- **PATCH with `status`.** Rejected 400 with a clear message — prevents bypassing the state machine.
- **Project re-assignment attempted via PATCH.** `project` is not in the `updateTask` allow-list → 400.
  This is intended; re-routing is a separate operation (Open Q).
- **Swallowed errors regression.** Any new `if (res.ok)` guard that drops the error body re-introduces
  audit §0. All mutation client fns must `throw` on non-2xx (they already do — keep it).

---

## Open questions

1. **Project / area re-assignment.** The brief lists "project/area" as editable, but `task_update`'s
   allow-list (and the fact that `project` is the ID prefix) means re-assignment is `rerouteTask`
   (`server-ui.ts:501`), not a field edit. Default: **defer** — edit only `task_update`-permitted fields
   in P4-01; spec a dedicated "move task to project" affordance later if needed.
2. **`approved` in the transition enum.** The store map allows `in_progress → approved`, but the
   `task_transition` tool enum omits `approved`. Default: keep the tool enum as the HTTP contract
   (`todo|in_progress|done|blocked`); do not expose `approved` via this route.
3. **Optimistic vs await for panel edits.** Today's mutations are optimistic (§5). For text-field edits
   (title/why) a debounced PATCH-on-blur may be cleaner than per-keystroke optimism. Default: commit on
   blur / explicit save; confirm against panel feel during build.
```
