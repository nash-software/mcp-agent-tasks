# P5-09 — Daily-use bug sweep: open-detail everywhere, Today bucket exclusivity, GEN filter, Ctrl+K

**Type:** Bug (bundle)
**Phase:** Phase 5 — Close the daily-use gaps + harden the gate
**Epic:** MCPAT-050 (Life OS — Phase 5)
**Task:** MCPAT-059
**Size:** S
**Depends on:** P5-03 (merged). Independent of P5-04…08.
**Owners:** ui-specialist (TodayView/Nav) · api-specialist (`/api/projects`)

> Inserted ahead of P5-04 per user call — these are daily-use papercuts found while exercising the
> Today view. Four small, independent fixes. No new patterns; mirror existing conventions.

---

## Why

Exercising the Today view surfaced four concrete defects:

1. **Detail panel only opens from "Committed Today".** The "Needs your call" and "Unscheduled
   candidates" rows wire `onClick` to `onSelectTask(id)` only and never call `handleOpenDetail(task)`
   (`TodayView.tsx:360,397`), so you cannot pop out the detail card from those sections — only from
   committed (`TodayView.tsx:319-322`).
2. **A task appears in two buckets → both rows highlight when selected.** Selection is correctly keyed
   by unique `task.id` (`TodayView.tsx:318`), but a `draft` task `scheduled_for` today is returned by
   **both** `getTasksByScheduledDate(today)` (→ "Committed Today") and the all-drafts query (→ "Needs
   your call", `TodayView.tsx:103-107`). The same id renders in two sections, so selecting it lights up
   both. (Root cause of the user's "duplicate is also selected, even in different states".)
3. **"General" (GEN) is missing from the project filter.** The filter options are the union of
   task-derived prefixes + `/api/projects` (`App.tsx:173-180`). `/api/projects`
   (`server-ui.ts:1110-1113`) returns only `config.projects`, which excludes the auto-initialised global
   **GEN** project (it lives in `projectIndexes` but not config). So GEN never appears unless a loaded
   task happens to carry `project: 'GEN'`.
4. **"Search CtrlK" missing its separator.** `Nav.tsx:197` renders `Search {MOD}K` — no `+`.

These are also a partial answer to the design questions raised: tasks are **never** name-deduplicated —
every task is a distinct ticket with a unique `PREFIX-NNN` id; the look-alike "Spec:"/"Plan:" rows are
auto-captured tasks with near-empty titles (a separate follow-up). Bucket definitions:
**Committed Today** = `scheduled_for === today`; **Needs your call** = `draft` (triage); **Unscheduled**
= `todo` + no `scheduled_for`.

---

## Scope

**In scope** — the four fixes above, each mirroring existing conventions.
**Out of scope** (separate specs, already agreed): richer status transitions + a Block button (Bundle B);
full project names + a projects/settings management cog (Bundle C); improving auto-captured task titles;
switching "Needs your call" to the server's `triage_note`-filtered `needs_review` set.

---

## Acceptance Criteria

1. **Detail opens from every Today section.** Clicking a row in "Needs your call" **and** "Unscheduled
   candidates" opens the detail/peek panel (same as "Committed Today") — `onClick` calls both
   `onSelectTask(task.id)` and `handleOpenDetail(task)`.
2. **Buckets are mutually exclusive.** A `draft` task scheduled for today renders in exactly one Today
   section. The "Committed Today" list excludes `draft` tasks (they belong to "Needs your call"), so no
   task id renders in two sections and selecting it highlights exactly one row.
3. **GEN appears as a filter project.** `GET /api/projects` includes the GEN global project when its
   index exists, so "GEN" is selectable in the project filter.
4. **Search hint reads "Ctrl+K".** `Nav.tsx` renders `Search {MOD}+K` (e.g. "Search Ctrl+K" on Windows).
5. **Gates pass.** `npm run type-check` (`tsc -b` green) + full `npm test` + `npm run build`.

---

## Build steps

1. **TodayView open-detail (AC1).** In `TodayView.tsx`, change the "Needs your call" (≈line 360) and
   "Unscheduled candidates" (≈line 397) `TaskCard` `onClick` to `() => { onSelectTask?.(task.id);
   handleOpenDetail(task) }`, matching the committed section.
2. **TodayView bucket exclusivity (AC2).** In the `committedList` derivation (`TodayView.tsx:126-130`),
   add `.filter(t => t.status !== 'draft')` so drafts surface only under "Needs your call".
3. **`/api/projects` includes GEN (AC3).** In `server-ui.ts:1110-1113`, after mapping `config.projects`,
   append `{ prefix: 'GEN', path: <gen tasksDir> }` if `projectIndexes` has a GEN entry not already in
   the list.
4. **Ctrl+K (AC4).** `Nav.tsx:197` `Search {MOD}K` → `Search {MOD}+K`.

---

## Tests

- **Integration:** `/api/projects` includes GEN when a GEN index is present (or, if GEN can't be staged
  in the test harness, assert the handler builds from `projectIndexes` not just `config.projects`).
- **Source-inspection (existing brittle suite):** assert both candidate sections call `handleOpenDetail`
  in `TodayView.tsx`; assert the `status !== 'draft'` exclusion on `committedList`; assert `Nav.tsx`
  contains `{MOD}+K`.
- **Gate:** `npm run type-check` (`tsc -b`) + full `npx vitest run` before PR.
