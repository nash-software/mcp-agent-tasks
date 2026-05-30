# P4-07 — Roadmap task linking (assign tasks to milestones)

**Type:** Feature
**Phase:** Phase 4 — Make the read-only UI usable
**Epic:** MCPAT-041 (Life OS — Phase 4: Usability)
**Task:** MCPAT-048
**Size:** M
**Depends on:** P4-01 (PATCH route). Soft-reuses P4-03 (drag) but MUST be buildable without it.
**Owners:** api-specialist (extend PATCH allow-list) · ui-specialist (RoadmapView task picker)

> Read `docs/life-os/specs/00-epic-overview.md` first — §4 (data shapes), §5 (client conventions).
> This is **THE roadmap gap** from the audit (`docs/life-os/audit/2026-05-30-functional-audit.md` §A5):
> the `task.milestone` field exists and `RoadmapView.tsx:163` reads `t.milestone === ms.id` to compute
> progress, but **nothing in the UI ever SETS `task.milestone`**. So every milestone is empty and every
> progress bar reads `0/0`. The add-milestone form already works (`RoadmapView.tsx:100-105` →
> `POST /api/milestones`); what is missing is task→milestone *linking*.

---

## Why

`RoadmapView` is structurally complete but inert. Concretely:

| Capability | State today |
|---|---|
| Create a milestone | ✅ works — form at `RoadmapView.tsx:100-105` → `POST /api/milestones` |
| Render milestone + progress bar | ✅ works — `RoadmapView.tsx:162-199`, `pct = done/related.length` |
| Compute `related` tasks | ✅ reads `tasks.filter(t => t.milestone === ms.id)` (`:163`) |
| **Assign a task to a milestone** | ❌ **no affordance anywhere — `task.milestone` is never written** |

Because no task ever has `milestone` set, `related` is always `[]`, `pct` is always `0`, and the roadmap
looks "useless" (audit §A5). The fix is small: let the user link tasks to a milestone. The store already
persists `task.milestone` (it round-trips through markdown frontmatter + SQLite); we only need a write
path (PATCH) and a UI to drive it.

---

## Scope

**In scope**
- **Extend P4-01's `PATCH /api/tasks/:id`** to accept `milestone: string | null` (assign / clear).
  If P4-01's PATCH already enumerates editable fields, this spec only *notes* `milestone` is included;
  if not, this spec adds `milestone` to the allow-list (server route + store `updateTask` allow-list).
- **RoadmapView task-picker (baseline, non-drag):** each milestone card gets a **"+ Add task"** control
  opening a picker of unassigned/eligible tasks (filtered to the milestone's project); selecting one
  PATCHes `{ milestone: ms.id }`. A per-task "remove from milestone" PATCHes `{ milestone: null }`.
- **Render assigned tasks** under each milestone card (title + status dot), so the milestone is no longer
  an empty shell. Progress bar then reflects real linked-task `done/total` (no code change to the math —
  it already reads `related`).
- **Optional drag-to-assign (soft):** if P4-03 (@dnd-kit) has shipped, additionally allow dropping a task
  onto a milestone card to assign it. Gate this behind P4-03's presence; the picker is the baseline and
  ships regardless.

**Out of scope**
- Changing the progress math (`RoadmapView.tsx:164-165`) — it already derives from `related`.
- Milestone CRUD beyond what exists (`POST /api/milestones` stays as-is).
- Cross-project milestone assignment edge cases — restrict the picker to the milestone's own project
  (a milestone belongs to one project prefix; `milestoneProject(ms)` already resolves it).
- The roadmap empty-state copy / "New Milestone" affordance polish — that is **P4-06** (infra batch).
  This spec is strictly task↔milestone linking.

---

## Data shapes / API contract

`Task.milestone` is an existing optional field (`string` milestone id, or absent/`null` when unlinked).
See overview §4. Do **not** introduce a new field.

### `PATCH /api/tasks/:id` (extends P4-01)

| | |
|---|---|
| Added field | `milestone?: string \| null` — assign (`"<milestone-id>"`) or clear (`null`) |
| Success | `200` → full updated `Task` |
| Errors | `400 INVALID_FIELD` (milestone id not a string/null); `404 TASK_NOT_FOUND` |

- The store's `updateTask` allow-list must include `milestone` (mirror how `estimate_hours` is permitted).
  If P4-01 already added it, this is a no-op note; otherwise add `milestone` to `task-store.ts` allow-list
  and the server PATCH field pick.
- Setting `milestone: null` (or `''` → normalize to unset) clears the link. Assigning a non-existent
  milestone id is **not** validated server-side (the store does not know about milestones); the UI picker
  only offers real milestone ids, so this stays a UI-enforced invariant. Flag if stricter validation is
  wanted (Open Q).

---

## Acceptance Criteria

1. **PATCH accepts `milestone`.** `PATCH /api/tasks/:id` with `{ milestone: 'MCPAT-roadmap-1' }` returns
   `200` with `milestone` set on the task; re-reading (fresh `getTask`) confirms persistence to markdown +
   SQLite. `{ milestone: null }` clears it (re-read shows no/`null` milestone).
2. **PATCH rejects a bad milestone value.** `PATCH` with `{ milestone: 42 }` (non-string, non-null) returns
   `400 INVALID_FIELD`. Unknown task id → `404`.
3. **"+ Add task" picker exists per milestone.** Each milestone card in `RoadmapView.tsx` shows a
   "+ Add task" control. Opening it lists tasks of that milestone's project that are **not already**
   assigned to it. Selecting a task fires `updateTask(id, { milestone: ms.id })`.
4. **Assigned tasks render under the milestone.** After assigning, the task appears in a list under that
   milestone card (title + status dot), without a full page reload (optimistic or post-invalidate).
5. **Progress bar reflects reality.** A milestone with 2 assigned tasks, 1 `done`, shows `1/2 done` / `50%`
   (the existing `related`/`pct` math now has non-empty input). With 0 assigned it still shows `0/0` / `0%`.
6. **Remove from milestone works.** A per-assigned-task "remove" control fires
   `updateTask(id, { milestone: null })`; the task disappears from the milestone list and the count drops.
7. **Drag-to-assign is gated, not required.** If P4-03 is present, dropping a task card onto a milestone
   assigns it (same PATCH). If P4-03 is absent, the picker is the sole path and the build still passes — no
   hard import of `@dnd-kit` in `RoadmapView` unless P4-03 has shipped.
8. **Gates pass.** `npm run type-check` (strict, no `any`) and `npm run build` succeed.

---

## Build steps

1. **Allow-list `milestone` in the mutation layer.** Confirm whether P4-01's `PATCH /api/tasks/:id` and
   `TaskStore.updateTask` allow-list (`src/store/task-store.ts`) already permit `milestone`. If not, add
   `milestone` to (a) the server PATCH field pick in `server-ui.ts` and (b) the store allow-list, accepting
   `string | null`. **Test:** integration — `PATCH {milestone:'m1'}` → 200 + persisted on re-read;
   `PATCH {milestone:null}` clears; `PATCH {milestone:42}` → 400.
2. **`assignMilestone` client mutation.** In `src/ui/src/api.ts`, reuse P4-01's `updateTask(id, fields)` —
   no new fn needed; callers pass `{ milestone }`. Add a TanStack `useMutation` (optimistic + `onError`
   rollback + invalidate `['tasks']`/`['milestones']`, overview §5) in `RoadmapView` or a `useRoadmap`
   hook. **Test:** unit — assign calls `updateTask(id,{milestone:ms.id})`; clear passes `null`; rejected
   promise rolls back.
3. **"+ Add task" picker (baseline).** In `RoadmapView.tsx`, add a per-milestone "+ Add task" control that
   opens a picker (reuse the existing inline-form pattern at `RoadmapView.tsx:100-150`, tokens §3). Source
   the list from the already-fetched `tasks`, filtered to `milestoneProject(ms)` and excluding tasks where
   `t.milestone === ms.id`. Selecting calls the assign mutation. **Test:** RTL — picker lists only
   same-project unassigned tasks; selecting one fires the assign mutation.
4. **Render assigned tasks + remove.** Under each milestone card, render `related` (already computed at
   `:163`) as a compact list (title + status dot + a "remove" control firing `{ milestone: null }`).
   Keep the existing progress bar (`:187-198`) — it consumes `related`/`pct` unchanged. **Test:** RTL —
   assigning then asserting the task row appears and the count/`pct` update; remove drops it.
5. **(Soft) drag-to-assign if P4-03 present.** Only if `@dnd-kit` exists (P4-03 shipped): make milestone
   cards droppable; on drop call the same assign mutation. Behind a presence check so this spec compiles
   without P4-03. **Test:** skip/condition this test on P4-03; the picker tests are the gate.

---

## Test notes

- **Integration (api-specialist):** PATCH `milestone` set/clear/invalid matrix (ACs 1–2). Assert
  persistence by re-read. If P4-01 already allow-lists `milestone`, this collapses to a confirmation test.
- **Unit (UI, RTL):** picker filtering + assign/remove mutations + progress reflecting `related` (ACs 3–6).
- **Gate:** `npm run type-check` + `npm test` green before PR.

---

## Failure modes

- **Assigning a task from another project.** The picker filters to `milestoneProject(ms)`; do not offer
  cross-project tasks. Server does not validate, so this is a UI invariant (Open Q for stricter checks).
- **Stale `related` after assign.** Must invalidate `['tasks']` (and `['milestones']` if progress is
  server-derived elsewhere) so the bar updates; optimistic update covers the instant feel.
- **Hard dependency creep on P4-03.** Do not `import` `@dnd-kit` unconditionally — keep the picker the
  baseline so P4-07 ships independent of P4-03's merge order.

---

## Open questions

1. **Server-side milestone-id validation.** The store does not know milestones, so `PATCH` cannot verify
   the id exists. Default: UI-enforced (picker only offers real ids). Escalate to a validated write only if
   a non-UI client starts setting `milestone`.
2. **Multi-milestone tasks.** `task.milestone` is singular — one milestone per task. If a task should
   belong to multiple milestones, that is a schema change (out of scope; flag if requested).
