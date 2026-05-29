# P1-09 — Board · Roadmap · Activity Reskin

**Type:** Feature
**Phase:** 1 (Reskin)
**Epic:** MCPAT-022 — Life OS UI Reskin
**Size:** M

> Shared tokens, data shapes, and client conventions live in
> [`00-epic-overview.md`](./00-epic-overview.md). This spec references §3 (colours, status dots,
> motion), §4 (Task / Milestone / Activity shapes), §6 (component map → `board.jsx`), and the §6
> enum-drift note (`todo` vs `queued`) — it does not repeat them.

---

## Description

Three secondary surfaces let the user step out of the Today-centric flow and see the work in
aggregate: **Board** (where is everything, by status), **Roadmap** (what are the medium-term
commitments, by milestone), and **Activity** (what just changed, newest first). They are not the
primary daily driver — Today is — but they are the reach-for views when the user needs breadth
instead of focus. Today they exist (`views/BoardView.tsx`, `RoadmapView.tsx`, `ActivityView.tsx`) but
are visually plain: hardcoded `slate/violet` utilities, no design-token layer, no Geist, and they
diverge from the canonical status union in two places that currently fail silently.

This ticket reskins all three to the Life OS tokens (§3), consumes the consolidated `TaskCard`
(P1-03) on the Board, and fixes two pre-existing correctness bugs surfaced in the epic baseline:

1. **Board column / Activity dot enum drift.** `BoardView` columns key on `todo` (correct) but the
   prototype labels the first column **"Queued"**; we keep the canonical `todo` *value* and render the
   *label* "Queued". `ActivityView`'s `STATUS_COLOR` map keys on `queued`, which never matches the
   real `to_status` (`todo`), so every `todo` transition falls through to the default gray. Per epic
   §6, **the real-store union wins** — reconcile both surfaces to `todo` so no status falls to the
   default gray.
2. **Dead "New Milestone" button.** `RoadmapView` declares `const mutation = useMutation({ mutationFn:
   createMilestone })` but never invokes it — the button has no `onClick`. Resolve per Open Questions
   (recommend: wire a minimal inline create against `POST /api/milestones`, which already exists and
   `createMilestone()` in `api.ts` already calls).

No backend work. All endpoints (`GET /api/tasks`, `GET /api/milestones` + `POST`, `GET /api/activity`)
already exist (epic §2).

---

## Acceptance Criteria

1. **Board renders exactly four columns** in order Queued / In progress / Blocked / Done, laid out
   with `grid-template-columns: repeat(4, minmax(0,1fr))` (single row, no wrap at desktop width). The
   "Queued" column is populated by tasks whose `status === 'todo'` — the canonical value is `todo`, the
   *label* shown is "Queued". A `todo` task appears under "Queued" and nowhere else.
2. **Board cards are clickable and open the detail panel.** Clicking a card invokes `onTaskClick(task)`
   which routes to the P1-04 panel in **detail** mode (Board click is always detail, never peek, per
   P1-04). Each card shows: mono task ID + priority tag (top row), title, and a footer with the area
   dot (§3 area colours), estimate (when `estimate_hours != null`), and a "today" badge when
   `scheduled_for === todayISO()`.
3. **Roadmap milestone cards** render from `GET /api/milestones`: project badge, title, due date in
   mono (`due_date`, when present), an **accent** progress bar, and the computed `done/total` + percent
   label. Progress is computed client-side from `useTasks` (`done` count over related tasks where
   `t.milestone === ms.id`); the bar width equals that percent and uses `--accent`, not violet.
4. **The "New Milestone" button is no longer dead** — it is either wired to a working create flow
   (invokes the existing `createMilestone` mutation and invalidates `['milestones']` on success) or
   removed entirely. There is no declared-but-unused mutation left in the file.
5. **Activity is a vertical timeline** from `GET /api/activity`, newest first, each row showing a
   status-coloured node, the task title, and "→ `to_status` · `Nm ago`". Clicking a row opens the
   referenced task (sets `App` `selectedTask` and shows the detail panel) via `entry.task_id`.
6. **Enum reconciliation — no status falls to the default gray.** Activity node/transition colours and
   Board column dots key on the canonical union (`todo`, `in_progress`, `blocked`, `done`). A
   transition to `todo` renders with the Queued/muted token, not the accidental default. Verifiable: no
   `queued` key remains in any colour map in these three files; a `to_status: 'todo'` activity row is
   visibly coloured, not gray-by-fallthrough.
7. All three views use Life OS tokens only (surface-1/2/3, text/text-2/muted, status colours, accent)
   and `font-mono` with `tabular-nums` for IDs, due dates, percentages, and "ago" timestamps — no
   `slate-*` / `violet-*` / `indigo-*` utilities remain.

---

## Technical Notes

**Files (real paths):**
- `src/ui/src/views/BoardView.tsx` — reskin columns + cards; reuse consolidated `TaskCard`.
- `src/ui/src/views/RoadmapView.tsx` — reskin milestone cards; fix dead button.
- `src/ui/src/views/ActivityView.tsx` — reskin timeline; fix `STATUS_COLOR` enum drift.
- `src/ui/src/components/TaskCard.tsx` — consolidated card from P1-03; **reuse, do not re-implement**.
- `src/ui/src/hooks/useTasks.ts`, `useMilestones.ts`, `useActivity.ts` — existing query hooks; no
  signature changes needed.
- `src/ui/src/types.ts` — canonical unions (`TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked'
  | ...`); the source of truth for the enum reconciliation.
- Reference: `design_handoff_life_os/reference/board.jsx` (BoardView / RoadmapView / ActivityView),
  screenshots `03-board.png`, `06-roadmap.png`, `07-activity.png`.

**Status-label mapping (Board):** keep the canonical `status` *value* `todo`; render the *label*
"Queued". Define the column list as `{ status: 'todo', label: 'Queued' }, { status: 'in_progress',
label: 'In progress' }, { status: 'blocked', label: 'Blocked' }, { status: 'done', label: 'Done' }`.
Do **not** introduce a `queued` value anywhere — that is the prototype's name, not the store's.

**Reuse the consolidated `TaskCard` (P1-03)** for Board cards rather than the inline `board-card`
markup from the prototype, as long as the consolidated card supports the Board footer (ID + priority +
area dot + estimate + "today" badge). If `TaskCard` is row-shaped (40px) and unsuitable as a kanban
card, the Board may use a thin card variant — but the area-dot / estimate / "today"-badge / priority
formatting must come from the shared `lib/format.ts` helpers, never re-derived locally.

**`ActivityView` enum fix (real shape):** the real `ActivityEntry` is `{ task_id, title, from_status,
to_status, at, reason }` — **not** the prototype's `{ id, title, to, ago }`. The current
`STATUS_COLOR` map keys on `queued`; change that key to `todo`. The "ago" string is computed from `at`
via the existing `relativeTime()` in `lib/time.ts` (the prototype's pre-baked `ago` field does not
exist on the real endpoint). The dot colour should map `to_status` → §3 status colour
(`done`→green, `in_progress`→blue, `blocked`→red, `todo`→muted).

**`RoadmapView` real shape:** the real `Milestone` is `{ id, title, status, due_date }` — it has **no**
`project`, `progress`, or `items` fields (those are prototype-only). Progress is computed from
`useTasks` (`t.milestone === ms.id`). The project badge derives from related tasks' `project`, or omit
the badge if not resolvable. Do not assume the prototype's `m.progress` / `m.items` exist.

**Dead-button fix:** `createMilestone(data)` in `api.ts` requires `{ id, title, project }`. A minimal
inline create needs at least those three fields. On success, `queryClient.invalidateQueries({ queryKey:
['milestones'] })`. If the inline form is judged out of scope for a reskin ticket, remove the button +
unused `useMutation` import and record the decision under Open Questions.

**Global filter:** all three views currently take `filters` props (Board, Roadmap) or none (Activity).
When **P2-01** lands the global filter, these views consume it — **note only, do not build the global
filter here.** Keep the existing `filters`-prop wiring intact so P2-01 can swap the source.

**Motion:** view-enter `fade-up` per §3; nothing >250ms on interactive elements; no opacity-from-hidden
on any panel these views open (P1-04 owns the panel motion).

---

## Failure Modes

- **Empty Board column** — a status with zero tasks renders the column header with a `(0)` count and a
  quiet "No tasks" placeholder (muted text), not a blank gap. All four columns always render.
- **No milestones** — Roadmap shows "No milestones found." (muted), and the create affordance (if
  kept) remains usable so the user can add the first one.
- **Empty activity** — Activity shows "No activity yet." (muted), not an empty `<ol>`.
- **Loading / error** — preserve the existing skeleton-pulse loading states (retokenised to surface-2)
  and the error branch; never crash on a null/`undefined` query result (hooks already default to `[]`).
- **Unknown status value** — if an out-of-union status ever arrives, it must still render with a
  defined muted token, never an undefined/blank colour (the whole point of AC-6).

---

## Out of Scope

- **Global filter / FilterBar** — built in **P2-01**; here we only keep the prop wiring intact.
- **Agent badge** on Board cards (the prototype's `board-agent-badge` / `agent_status`) — **Phase 2**.
- **Drag-and-drop** between Board columns and **WIP limits** — not in the prototype's Phase-1 scope.
- **Task store / endpoint changes** — all three endpoints already exist; no backend work.
- Peek mode from Board (Board click is always **detail**, per P1-04).

---

## Dependencies

- **P1-01** — design-system foundation (tokens, Geist, status colours, accent). Hard prerequisite.
- **P1-03** — consolidated `TaskCard` + `lib/format.ts` (consumed by the Board).
- **P1-04** — task detail panel (Board card click and Activity row click both open it).

---

## Testing

- **Board column mapping:** with a `todo` task in the fixture, assert it renders under the "Queued"
  column and that the column header label reads "Queued" while the underlying status value is `todo`.
- **Board grid:** assert four columns render even when some are empty (`(0)` + placeholder).
- **Card click → detail:** clicking a Board card calls `onTaskClick` with the task and opens the
  detail panel (P1-04 integration / smoke).
- **Roadmap progress:** with N related tasks, M done, assert the bar width and percent label equal
  `round(M/N*100)` and the bar uses the accent token.
- **Dead-button:** assert there is no declared-but-unused mutation; if wired, a click triggers
  `createMilestone` and invalidates `['milestones']`.
- **Activity enum:** assert a `to_status: 'todo'` row is not gray-by-fallthrough and renders the muted
  status token; assert clicking a row opens the task by `task_id`. Assert no `queued` key remains in
  any colour map across the three files (grep-style guard acceptable).
- `npm run type-check` (strict, no `any`) and `npm run build` pass.

---

## Open Questions

- **"New Milestone" button fate** — wire a minimal inline create (project + title + optional due date),
  or remove the button entirely until a dedicated milestone-create flow is specced? **Recommendation:
  wire it** — `POST /api/milestones` and `createMilestone()` already exist, so the cost is a small
  inline form, and a Roadmap with no way to add a milestone is a dead end. Fallback: remove the button
  and the unused `useMutation` to eliminate the dead code, deferring create to a later ticket. Decide
  before implementation and record the choice in the PR.
