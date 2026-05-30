# P5-04 — New-task modal + delete task (`DELETE /api/tasks/:id`)

**Type:** Feature
**Phase:** Phase 5 — Close the daily-use gaps + harden the gate
**Epic:** MCPAT-050 (Life OS — Phase 5)
**Task:** MCPAT-054
**Size:** M
**Depends on:** P5-01 (real gate)
**Owners:** api-specialist (`DELETE` route) · ui-specialist (New-task modal + delete affordance)

> Read `docs/life-os/specs/00-epic-overview.md` first — §3 (tokens), §4 (`Task` fields, `Priority`/`Area`
> unions), §5 (optimistic mutations, query invalidation). Evidence: audit §A2, §A3
> (`api.ts:53` createDraftTask is draft-only; only `/signoff` has a DELETE today) — **do NOT
> re-investigate.** The create path uses the **existing** `POST /api/tasks`; this spec adds a full-field
> **client modal** over it and a **new markdown-first `DELETE` route** + guarded UI affordance.

---

## Why

Today the only ways to create a task from the UI are quick-capture (title-only → routed) and braindump
(candidate extraction) — there is **no full-field "New task" form** (audit §A2; `createDraftTask` at
`api.ts:53` is draft-only). And there is **no way to delete a task** from the UI — no `DELETE` route
(only `/signoff` has one) and no client fn (audit §A3). A mistaken capture is currently un-removable from
the dashboard. This spec adds a New-task modal over the existing `POST /api/tasks` and a markdown-first
`DELETE /api/tasks/:id` with a guarded affordance.

Per overview §9, **detail views use slide-in panels, not modals** — but a **create form** is a discrete
data-entry action, not a detail view, so a modal is the correct affordance here (matches the prototype's
capture-style overlays for entry).

---

## Scope

**In scope**
- **New-task modal** (full fields: `title`, `project`, `priority`, `area`, `estimate_hours`, `why`) →
  existing `POST /api/tasks`. Triggered from a "New task" control (e.g. nav/header or `Cmd+K` action).
  Validates client-side, surfaces server errors, invalidates `['tasks']`/`['today']` on success.
- **`DELETE /api/tasks/:id`** — markdown-first deletion (remove the markdown file via the durable path,
  then drop from the SQLite index), returning `200` on success / `404` if absent.
- **Guarded delete affordance in TaskPanel** — a delete control behind a confirm step (overview §9: no
  accidental destructive action), firing the new client `deleteTask` fn with optimistic removal +
  rollback.

**Out of scope**
- Editing fields post-create — that is **P5-03**.
- Bulk delete / archive batch — single-task delete only.
- Subtask-aware cascade semantics beyond what the store already enforces (flag in Open Q if a task has
  subtasks).
- Changing `POST /api/tasks` itself — it already exists; the modal just sends full fields.

---

## Data shapes / API contract

### `POST /api/tasks` (existing — full-field create)

Request body (full create; extends what `createDraftTask` sends today):

```ts
{
  title: string;            // required, ≤200
  project: string;          // required, known prefix
  priority?: Priority;      // 'critical'|'high'|'medium'|'low' (default per store)
  area?: Area;              // 'client'|'personal'|'outsource'|'internal'
  estimate_hours?: number;  // ≥0
  why?: string;             // ≤1000
}
```

Success `200/201` → created `Task` (with minted ID). Errors `400 INVALID_FIELD` (bad enum / missing
required / over-length), surfaced as `{ error: <CODE> }`.

### `DELETE /api/tasks/:id` (new)

| | |
|---|---|
| Behaviour | Markdown-first: remove the task markdown via the durable/atomic path, then delete from SQLite index |
| Success | `200` → `{ deleted: true, id }` (or `204`) |
| Errors | `404 TASK_NOT_FOUND` (unknown id); `400` for a malformed id |
| Convention | markdown-first (`persistTaskDurable`-style delete); **no `TaskStore`** in `server-ui.ts` (§13) |

Client fn `deleteTask(id): Promise<void>` throws on non-2xx (so the optimistic mutation rolls back).

---

## Acceptance Criteria

1. **New-task modal exists + creates.** A "New task" control opens a modal with `title`, `project`,
   `priority`, `area`, `estimate_hours`, `why`; submitting POSTs to `/api/tasks` and the new task appears
   in the list (`['tasks']`/`['today']` invalidated). (Falsifiable: submitting a valid form creates a
   real task readable via `GET /api/tasks`.)
2. **New-task validation.** Missing `title` or `project` is blocked client-side; a server `400`
   (bad enum/over-length) shows a visible error and does not close the modal silently. (Falsifiable: an
   over-length title surfaces the server error.)
3. **`DELETE /api/tasks/:id` exists + is markdown-first.** Deleting a task removes its **markdown file**
   (via the durable path) and then the index entry; `GET /api/tasks` no longer returns it; a reconcile
   does **not** resurrect it. (Falsifiable: after delete + reconcile, the task is absent from both
   markdown and index.)
4. **DELETE error paths.** Deleting an unknown id → `404 TASK_NOT_FOUND`; a malformed id → `400`.
5. **No `TaskStore` in `server-ui.ts`.** The DELETE handler uses the markdown-first durable path; no
   `TaskStore` import is added. (Falsifiable: grep `server-ui.ts` for `TaskStore` → unchanged.)
6. **Guarded delete affordance.** TaskPanel exposes a delete control behind a **confirm step** (not a
   single click); confirming fires `deleteTask`, optimistically removes the task, and rolls back on error.
   (Falsifiable: a single click does not delete; confirm does; a rejected delete restores the task.)
7. **Errors surface.** Create and delete failures show a visible toast/inline error (overview §5), never a
   silent no-op.
8. **Gates pass.** `npm run type-check` (`tsc -b` green) + `npm run build` succeed; `npm test` green.

---

## Build steps

1. **`DELETE /api/tasks/:id` route (`server-ui.ts`).** Add a `DELETE` branch on `^/api/tasks/([^/]+)$`
   (mirror the existing PATCH/transition route blocks from P4-01). Resolve the project index by prefix →
   404 if absent → markdown-first delete (remove markdown via the durable/atomic path, then drop from the
   SQLite index). Return `200 { deleted: true, id }`. Map errors via `sendError`. **No `TaskStore`.**
   **Test:** integration — delete a fixture → 200, markdown + index gone, reconcile does not resurrect;
   unknown id → 404.
2. **`deleteTask` client fn (`api.ts`).** Add `deleteTask(id): Promise<void>` (DELETE; throw on non-2xx).
   **Test:** type-check passes; non-2xx throws.
3. **New-task client fn.** Generalize/extend the create path so the modal can send full fields to
   `POST /api/tasks` (keep `createDraftTask` for existing draft callers, or add `createTask(fields)`).
   **Test:** type-check; existing `createDraftTask` callers still compile.
4. **New-task modal (UI).** Build the modal (entry form — modal is correct here, not a slide panel) with
   the six fields, client-side required-field validation, server-error surfacing, and
   `invalidate(['tasks'],['today'])` on success. Wire a "New task" trigger (header/nav + a `Cmd+K`
   command entry). Respect tokens (§3). **Test:** RTL — valid submit fires the create POST; invalid form
   blocks submit; server 400 shows the error.
5. **Guarded delete in TaskPanel.** Add a delete control behind a confirm affordance; confirming fires
   `deleteTask` with optimistic removal + `onError` rollback + toast. **Test:** RTL — single click does
   not delete; confirm fires `deleteTask`; rejected delete restores the row.
6. **Run gates.** `npm run type-check` + `npm run build` + `npm test`.

---

## Test notes

- **Integration (api-specialist):** DELETE 200/404 + **markdown-first persistence** (deleted markdown
  does not resurrect on reconcile — the load-bearing regression, AC3). Mirror P4-01's route test harness.
- **Unit (UI, RTL):** New-task modal submit + validation (ACs 1, 2); guarded delete confirm + rollback
  (ACs 6, 7).
- **Gate:** `npm run type-check` (`tsc -b`) + `npm test` before PR.

---

## Failure modes

- **Index-only delete.** Dropping the SQLite row without removing the markdown re-creates the K1-class
  bug — reconcile resurrects the task. Delete markdown-first.
- **Unguarded delete.** A single-click delete on a slide-in panel risks accidental data loss (overview §9
  — destructive actions need a confirm). Gate it.
- **Modal for a detail view.** Don't repurpose this modal for task detail — detail stays a slide-in panel
  (§9). The modal is strictly the create form.
- **`TaskStore` in `server-ui.ts`.** Forbidden (§13). Use the markdown-first durable delete path.

---

## Open questions

1. **Delete with subtasks.** If a task has subtasks, does delete cascade, block, or orphan them? Default:
   **block with a clear error** if subtasks exist (safest); confirm the store's existing subtask
   semantics during build and surface the constraint in the confirm dialog.
2. **`POST /api/tasks` minted-ID response shape.** Confirm the existing route returns the full created
   task (id, status, project) so the modal can route/select it. Default: select the new task into the
   panel on success; fall back to a list refresh if the response is minimal.
3. **New-task trigger location.** Header button vs. `Cmd+K`-only vs. both. Default: **both** (a visible
   header/nav button + a command-palette entry), matching the prototype's discoverability.
