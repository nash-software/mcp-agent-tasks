# P4-03 — Board drag-and-drop (`@dnd-kit`)

**Type:** Feature
**Phase:** Phase 4 — Make the read-only UI usable
**Epic:** MCPAT-041 (Life OS — Phase 4: Usability)
**Task:** MCPAT-044
**Size:** M
**Depends on:** P4-01 (`POST /api/tasks/:id/transition`). Coordinates with P4-02 (Done-column "Complete all").
**Owners:** ui-specialist (DnD wiring + column chrome)

> Read `docs/life-os/specs/00-epic-overview.md` first — §3 (tokens, motion), §5 (client conventions).
> This resolves audit **decision 3** (`docs/life-os/audit/2026-05-30-functional-audit.md` §A4): the board
> has **zero DnD code** (`BoardView.tsx:58-88` renders static columns; `BoardCard.tsx:42-44` cards only
> open a read-only panel). Decision: **add `@dnd-kit`, wire drop → transition**, with a keyboard/a11y
> fallback. This is a pure front-end spec — the transition route it calls is delivered by **P4-01**.

---

## Why

The board looks like a kanban but behaves like a static list: you cannot move a card between columns to
change its status (audit §A4). Every status change today requires the panel. With P4-01's
`POST /api/tasks/:id/transition` live, dropping a card onto a column is just a transition call — the board
becomes a real interaction surface.

`@dnd-kit` is the chosen library (accessible, keyboard support built in, no HTML5-drag quirks).

---

## Scope

**In scope**
- Add `@dnd-kit/core` (+ `@dnd-kit/sortable` if intra-column ordering is wanted — default: cross-column
  only, no reordering) as a dependency.
- Wrap `BoardView` columns in a `DndContext`; make each `BoardCard` draggable and each column a droppable.
- **Drop → transition:** dropping a card onto a column calls `transitionTask(id, <column status>)` (P4-01).
  Optimistic move with `onError` rollback (overview §5). Invalid transitions (rejected 409 from P4-01)
  snap the card back and surface the error.
- **Keyboard / a11y fallback:** `@dnd-kit`'s `KeyboardSensor` — a card is focusable, space/enter picks it
  up, arrows move between columns, space/enter drops. Screen-reader announcements via dnd-kit's
  `announcements`.
- **Done-column "Complete all" surface:** the Done column header hosts P4-02's "Complete all" action.
  This spec provides the column-header/menu chrome; P4-02 provides the close-batch mutation it calls.
  Coordinate so the chrome is built **once** (whichever of P4-02/P4-03 lands first owns it; the other
  wires into it).

**Out of scope**
- The close-batch endpoint + closed/Completed model — **P4-02** (this spec only renders the trigger).
- Intra-column reordering / persisted sort order (default off; flag if wanted — Open Q).
- Touch/mobile DnD tuning — desktop-first (overview §10); dnd-kit's `PointerSensor` covers mouse + basic
  touch, no special mobile work.
- Roadmap drag-to-assign — **P4-07** soft-reuses this; not built here.

---

## Data shapes / API contract

No new endpoint. Drop maps a board column to a `Status` and calls **P4-01's**:

```
POST /api/tasks/:id/transition   body { to: Status, reason?: string }
```

Column → status map (board columns are the canonical working statuses):

| Column | `to` status |
|---|---|
| To-do | `todo` |
| In progress | `in_progress` |
| Blocked | `blocked` |
| Done | `done` |

- A drop that maps to a transition the state machine rejects returns **409 `INVALID_TRANSITION`** (P4-01) —
  the card snaps back and an error surfaces. The board does not invent its own legality rules; the server
  is the source of truth (the column is droppable, but an illegal drop is rejected and rolled back).

---

## Acceptance Criteria

1. **Cards are draggable, columns are droppable.** `BoardView` is wrapped in `DndContext`; each
   `BoardCard` registers as draggable; each column registers as droppable. Dragging shows a drag overlay
   (tokens §3 — transform-only motion, no opacity-to-hidden).
2. **Drop transitions the task.** Dropping a `todo` card onto the In-progress column calls
   `transitionTask(id, 'in_progress')`; on success the card lives in In-progress and a re-read confirms
   `status==='in_progress'`.
3. **Optimistic + rollback.** The card moves instantly on drop (optimistic); if the transition is rejected
   (e.g. 409 from P4-01), the card snaps back to its origin column and a visible error surfaces. No
   permanent optimistic state on failure (overview §5).
4. **Illegal drop is rejected, not silently applied.** Dropping a `done` card onto a column whose
   transition the state machine forbids yields a 409 → rollback + error. The board never shows a status the
   server rejected.
5. **Keyboard / a11y works.** A board card is focusable; space/enter picks it up; arrow keys move it
   between columns; space/enter drops (firing the same transition). dnd-kit `announcements` provide
   screen-reader feedback. (Falsifiable: keyboard-only move of a card changes its status.)
6. **Done-column "Complete all" is present.** The Done column header shows the "Complete all" control
   (P4-02). Clicking it triggers P4-02's batch-close mutation. (If P4-02 hasn't merged, the control is
   wired to a stub the P4-02 build replaces — but the chrome exists here.)
7. **Gates pass.** `npm run type-check` (strict, no `any`) and `npm run build` succeed; `@dnd-kit` is a
   declared dependency.

---

## Build steps

1. **Add `@dnd-kit` + DndContext shell.** Install `@dnd-kit/core` (record in `package.json`). Wrap the
   `BoardView` column grid (`BoardView.tsx:58-88`) in `<DndContext>` with `PointerSensor` +
   `KeyboardSensor`. Add a `DragOverlay` rendering the dragged card. **Test:** RTL/type — board renders
   inside `DndContext`; type-check passes with the new dep.
2. **Make cards draggable, columns droppable.** Give `BoardCard` (`BoardCard.tsx`) a `useDraggable`
   (id = task id); give each column a `useDroppable` (id = column status). Preserve the existing
   click-to-open-panel behaviour (drag vs click disambiguation via dnd-kit activation constraint).
   **Test:** RTL — a card exposes draggable attributes; a click (no drag) still opens the panel.
3. **Drop → transition mutation.** On `onDragEnd`, map the over-column to its status and fire a
   `transitionTask` mutation (optimistic move, `onError` rollback, invalidate `['tasks']`/`['today']`).
   Map P4-01's 409 to a snap-back + visible error. **Test:** RTL — simulated drop fires
   `transitionTask(id, status)`; a rejected promise rolls the card back and shows an error.
4. **Keyboard sensor + announcements.** Configure `KeyboardSensor` and dnd-kit `announcements` so a
   keyboard-only user can pick up, move across columns, and drop a card (same transition path). **Test:**
   RTL — keyboard interaction moves a card to a new column and fires the transition.
5. **Done-column "Complete all" chrome.** Add the Done column header control hosting P4-02's "Complete
   all". If P4-02's `closeBatch` mutation exists, wire to it; else expose a typed hook P4-02 fills.
   Coordinate ownership so the chrome isn't built twice. **Test:** RTL — the Done column header renders the
   control; clicking invokes the (stub or real) close-batch handler.

---

## Test notes

- **Unit (UI, RTL):** dnd-kit interactions are testable via `@dnd-kit`'s test utilities / fireEvent
  drag simulation. Cover drop→transition (AC 2), rollback (AC 3), illegal-drop 409 (AC 4), keyboard move
  (AC 5). Mock `transitionTask`.
- **No new server tests** — the transition route is P4-01's; this spec adds no endpoint.
- **Gate:** `npm run type-check` + `npm test` green before PR.

---

## Failure modes

- **Drag vs click conflict.** Without an activation constraint, every click starts a drag and the panel
  never opens. Use dnd-kit's `activationConstraint` (distance/delay) so a plain click still opens the peek
  (B4 / P4-05 dependency — coordinate so both work).
- **Optimistic state stuck on 409.** A rejected transition MUST roll the card back; a missing `onError`
  leaves the card in the wrong column while the server says otherwise (the audit §0 swallowed-error class).
- **Double-owning Done-column chrome.** P4-02 and P4-03 both touch the Done column header — agree one owner
  to avoid a merge conflict / duplicate control.

---

## Open questions

1. **Intra-column reordering.** Default: cross-column only (no persisted order). If card order within a
   column should persist, add `@dnd-kit/sortable` + a server-side order field — flag, not in scope now.
2. **Column-set source.** Columns are the working statuses (`todo|in_progress|blocked|done`). Confirm the
   board excludes `closed` (P4-02) — closed tasks live in the Completed tab, not a board column.
