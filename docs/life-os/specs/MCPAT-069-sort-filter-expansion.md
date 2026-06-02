# MCPAT-069 — Sort & Filter Expansion (`lib/filter.ts` + new `lib/sort.ts` + `FilterBar` / Sort control)

**Type:** Feature
**Phase:** 6 (Daily-use refinements)
**Epic:** MCPAT-022 — Life OS UI Reskin
**Size:** L
**Status:** approved

> Shared tokens, data shapes, and client conventions live in
> [`00-epic-overview.md`](./00-epic-overview.md). This spec **extends** the global filter shipped by
> [`P2-01-global-filter.md`](./P2-01-global-filter.md) — read that spec first; the `Filter` type,
> `matchFilter` purity contract, `localStorage('lifeos-filter')` persistence, and AND-across /
> OR-within semantics are the baseline this spec builds on. The §3 token system
> ([`P1-01-design-system-foundation.md`](./P1-01-design-system-foundation.md)) and the canonical
> enum→class maps in `src/ui/src/lib/tokens.ts` are reused; no new palette entries are added.

---

## Description

P2-01 gave Life OS **one shared filter across all five views**, but it is intentionally minimal —
only **projects + areas** (`Filter = { projects: string[], areas: Area[] }`, `src/ui/src/lib/filter.ts`).
In daily use that is no longer enough. The user cannot say "show me only the blocked + draft work
that needs attention", "only critical/high priority", "only this milestone (roadmap) slice", "only
what's scheduled today or overdue", and **cannot reorder any view** — every view hardcodes its order
(TodayView sorts committed + candidates by `PRI_RANK`; BoardView lays tasks out by status column;
ArtifactsView sorts by `staleDays` desc). There is no sort control anywhere in the app.

**Why expand here (the WHY):** the filter is the user's single lens over *all* their work
(P2-01 §Description). As the task corpus grows across projects, two-dimensional filtering forces the
user to eyeball the rest. Adding **type / status / priority / milestone / "needs attention"** filter
dimensions, a **sort control**, and **date-preset filters** turns the one calm surface into a tool
that can answer a real daily question ("what's the most urgent client work that's overdue?") without
leaving the dashboard or dropping to the CLI. Crucially this stays **client-side** — every view
already fetches the full task set into the `['tasks']` query cache, so filtering and sorting are
instant, in-memory, and keep `matchFilter` / the new `sortTasks` **pure and unit-testable**.

This is **three phases in one spec**, each with its own AC group and each independently shippable:

- **Phase B — Filter dimensions.** Extend `Filter` + `matchFilter` with `types`, `statuses`,
  `priorities`, `milestones` (the roadmap filter), and an `attention` boolean predicate. FilterBar
  gains a section per dimension (re-laid-out so the popover doesn't become a wall), and active chips.
- **Phase C — Sort control.** New pure `src/ui/src/lib/sort.ts` (`sortTasks(tasks, key, dir)`), a Sort
  dropdown matching the FilterBar button style, persisted sort state, applied per-view (Today lists,
  Board within columns), with Roadmap / Activity keeping their intrinsic order.
- **Phase D — Date-preset filters.** Add `scheduled`, `createdWithin`, `updatedWithin` preset
  dimensions to `Filter`, extend `matchFilter` with date math (clock injected as an arg for
  testability). **Presets only** — no free date-range picker.

See for context (do not duplicate — cite):
- `src/ui/src/lib/filter.ts` (current `Filter`, `matchFilter`, `filterActive`, `EMPTY_FILTER`,
  `areaOfProject`, `projectOfId` — all pure, area map passed explicitly).
- `src/ui/src/lib/filter.test.ts` (the existing matcher test suite this spec **extends**).
- `src/ui/src/App.tsx` (`readStoredFilter()` ~L64–86, `toggleProject`/`toggleArea` ~L191–209,
  `areaMap`/`projectCounts` useMemos ~L159–189, persistence effect L124, command palette ~L405–468,
  FilterBar wiring ~L502–530, view wiring L539–551).
- `src/ui/src/components/FilterBar.tsx` (popover structure, area chips, active chips, Clear).
- `src/ui/src/views/TodayView.tsx` (`sortCommitted` L41, candidate sort L55, `matchFilter` call sites
  L132/L136), `src/ui/src/views/BoardView.tsx` (`matchFilter` L69, column layout via `BOARD_STATUSES`).
- `src/ui/src/types.ts` (`TaskStatus`, `TaskType`, `TaskPriority`, `TaskArea`, `Task` fields).
- `src/ui/src/lib/format.ts` (`PRI_RANK` — reuse for the priority sort key).

---

## Domain Model

### Phase B — extended `Filter`

```ts
import type { Area } from '../types' // TaskArea: 'client'|'personal'|'outsource'|'internal'
import type { TaskType, TaskStatus, TaskPriority } from '../types'

export interface Filter {
  // P2-01 (unchanged)
  projects: string[]
  areas: Area[]
  // MCPAT-069 Phase B
  types: TaskType[]          // OR within
  statuses: TaskStatus[]     // OR within
  priorities: TaskPriority[] // OR within
  milestones: string[]       // OR within — milestone ids (the "roadmap" filter)
  attention: boolean         // boolean predicate (see "needs attention" below)
  // MCPAT-069 Phase D
  scheduled: 'today' | 'week' | 'overdue' | 'none' | null
  createdWithin: '24h' | '7d' | '30d' | null
  updatedWithin: '24h' | '7d' | '30d' | null
}

export const EMPTY_FILTER: Filter = {
  projects: [], areas: [], types: [], statuses: [], priorities: [], milestones: [],
  attention: false, scheduled: null, createdWithin: null, updatedWithin: null,
}
```

**"Needs attention" — precise definition.** A task needs attention when **any** of:
1. `status === 'blocked'`, OR
2. `status === 'draft' && (task.triage_note set OR task.block_reason set)` — a draft that has been
   flagged but not yet promoted, OR
3. **stale**: `last_activity` (fallback `updated`, fallback `created`) is older than `STALE_DAYS`
   relative to the injected `now`.

> **`STALE_DAYS` source (RESOLVED — product decision: 7 days).** There is **no client-side
> `STALE_DAYS` constant today** — confirmed by grep. `ArtifactsView.tsx` defines
> `STALE_FRESH_MAX_DAYS = 7` / `STALE_MID_MAX_DAYS = 21` but those are artifact-staleness color
> thresholds, not task staleness. The backend `task_stale` tool / stats `stale_count`
> (`src/store/sqlite-index.ts:582`) define stale as `in_progress` past `claim_ttl_hours`, which is a
> *different, claim-based* notion and is **not** reused here. This spec introduces a **new exported
> constant `STALE_DAYS = 7`** in `src/ui/src/lib/filter.ts` for the "needs attention" task-staleness
> threshold (the product owner fixed this at **7 days**).

> **`triage_note` IS added to the client `Task` (RESOLVED — product decision: include it).** The
> field is added to the `Task` interface in `src/ui/src/types.ts` (`triage_note?: string`) and the
> "needs attention" flagged-draft clause uses `triage_note` as the primary signal, with
> `block_reason` as an additional OR signal. **The backend already emits it end-to-end** — verified:
> `src/store/sqlite-index.ts` carries the `triage_note` column (migration L162, upsert L339/L349) and
> `rowToTask` already maps it onto the returned task object (L282), so `getTask` / `listTasks` /
> `getTasksByScheduledDate` all include it, and `/api/tasks` (L1361) + `/api/today` (L1641/L1668)
> serialize those full task objects straight to JSON. **No backend or index change is required** — the
> only gap was the client `Task` type, which this spec closes.

### Phase C — `sortTasks`

```ts
// src/ui/src/lib/sort.ts — new, pure, no React import
export type SortKey =
  | 'priority' | 'created' | 'updated' | 'scheduled' | 'title' | 'complexity' | 'estimate'
export type SortDir = 'asc' | 'desc'

export function sortTasks(tasks: Task[], key: SortKey, dir: SortDir): Task[]
```

- **Stable**, non-mutating (`[...tasks].sort(...)`).
- `priority` uses `PRI_RANK` (`lib/format.ts`) so `asc` = critical-first.
- Missing values (`scheduled_for == null`, `complexity == null`, `estimate_hours == null`) sort
  **last regardless of `dir`** (nulls-last), then by id ascending as the final tie-breaker.
- `title` is `localeCompare` (case-insensitive). `created`/`updated`/`scheduled` compare ISO strings
  (lexicographic == chronological for ISO-8601; `scheduled` uses `scheduled_for`).

### Phase D — date math in `matchFilter`

`matchFilter` is currently **pure with no clock**. Phase D adds an explicit `now: number` (epoch ms)
**argument** rather than calling `Date.now()` inside — this keeps the function deterministic and
unit-testable (assert against a fixed `now`). Signature becomes:

```ts
export function matchFilter(
  filter: Filter,
  task: TaskLike,                 // see note: matcher now needs more task fields
  areaMap: Record<string, Area> = {},
  now: number = Date.now(),       // injected clock for date presets + attention staleness
): boolean
```

> **Signature change — `project, area?` → a task-shaped object.** The current matcher takes
> `(filter, project, area?, areaMap)`. Phase B/D need `type`, `status`, `priority`, `milestone`,
> `scheduled_for`, `created`, `updated`, `last_activity`, and `triage_note` too. Define a narrow
> `TaskLike` interface (the subset of `Task` fields the matcher reads, all optional except `project`)
> and update **every call site** (TodayView L132/L136, BoardView L69, ArtifactsView, RoadmapView,
> ActivityView). Non-task surfaces (artifacts/activity) pass a partial object
> (`{ project }` / `{ project: projectOfId(id) }`); those surfaces only meaningfully use the
> project/area/milestone dimensions — type/status/priority/date dimensions simply don't constrain a
> record that lacks the field (empty dimension semantics from P2-01: a missing field under an active
> dimension **fails** that dimension, consistent with the existing `area == null` guard). Document
> this per-surface behavior in Failure Modes.

Date presets (all relative to injected `now`, local-day boundaries via `lib/format.ts:localToday`):
- `scheduled: 'today'` → `scheduled_for` is the local today; `'week'` → within the next 7 days
  (today..+7); `'overdue'` → `scheduled_for < today`; `'none'` → `scheduled_for == null`.
- `createdWithin`/`updatedWithin`: `'24h'`/`'7d'`/`'30d'` → field within that window back from `now`.

---

## Acceptance Criteria

### Phase B — Filter dimensions

- [ ] **B1 — `Filter` is extended with `types`, `statuses`, `priorities`, `milestones`, `attention`,
      all defaulted in `EMPTY_FILTER`.** The interface compiles strict (no `any`); arrays default to
      `[]` and `attention` to `false`. `filterActive(filter)` returns `true` when **any** of the new
      dimensions is non-empty / `attention === true` (not just the P2-01 projects/areas).
- [ ] **B2 — `matchFilter` enforces AND-across / OR-within for every new array dimension.** Given a
      task, it passes only if it satisfies `projects` AND `areas` AND `types` AND `statuses` AND
      `priorities` AND `milestones` (each OR-within, empty = no constraint). A task whose `type` is
      not in a non-empty `filter.types` is excluded; same for `statuses`, `priorities`, `milestones`
      (matched on `task.milestone`). `EMPTY_FILTER` still matches everything.
- [ ] **B3 — the `attention` predicate matches blocked OR flagged-draft OR stale, per the precise
      definition.** With `attention: true`: a `blocked` task matches; a `draft` task with
      `triage_note` (or `block_reason`) matches; a task whose `last_activity` is older than
      `STALE_DAYS` relative to the injected `now` matches; an `in_progress` task touched today does
      **not**. `attention: false` imposes no constraint. The matcher reads the clock from its `now`
      argument, never `Date.now()` internally.
- [ ] **B4 — `STALE_DAYS` is a single exported constant** in `lib/filter.ts` (value `7`), consumed by
      the attention predicate. No magic number inline. Not conflated with the artifact thresholds in
      `ArtifactsView.tsx` or the backend claim-TTL staleness.
- [ ] **B5 — FilterBar exposes a section + active chips for each new dimension without becoming a
      wall.** The popover is re-laid-out: Projects + Areas stay as the primary sections; **Type,
      Status, Priority, Milestone, and the "Needs attention" toggle live under a collapsible
      "More filters" disclosure** (collapsed by default, remembers open/closed within the session).
      Each multi-select renders chips (Type/Status/Priority via the canonical `tokens.ts` colors;
      Milestone from `useMilestones()`); "Needs attention" is a single toggle chip. Selecting any adds
      a **removable active chip** in the bar (reusing the `filter-chip` pattern) and increments the
      Filter button badge (`activeCount` now sums all dimensions + 1 when `attention`).
- [ ] **B6 — milestone options come from `useMilestones()` / `/api/milestones`**, not a hardcoded
      list; an unknown / since-closed milestone id already in a persisted filter is tolerated (still
      filters, just may show its raw id) and does not crash the popover.
- [ ] **B7 — all new dimensions persist to `localStorage('lifeos-filter')` and hydrate
      backward-compatibly.** `readStoredFilter()` (App.tsx ~L64) is extended so an **old persisted
      shape `{ projects, areas }`** (no new keys) hydrates to a full `Filter` with the new fields
      defaulted (`types:[]`, …, `attention:false`, `scheduled:null`, `createdWithin:null`,
      `updatedWithin:null`) — never `undefined`. Corrupt / partial JSON still falls back to
      `EMPTY_FILTER`. A reload restores the full filter exactly.
- [ ] **B8 — `triage_note?: string` is added to the client `Task` interface** in
      `src/ui/src/types.ts`. The backend already serializes it (verified — see Domain Model note), so
      no server/index change is needed; this AC only closes the client-type gap so the attention
      predicate can read `task.triage_note` without a cast.

### Phase C — Sort control

- [ ] **C1 — `src/ui/src/lib/sort.ts` exports a pure `sortTasks(tasks, key, dir)`** over the keys
      `priority | created | updated | scheduled | title | complexity | estimate`, with `SortKey` /
      `SortDir` types. It is non-mutating, stable, and imports no React. The `key` switch is
      exhaustive over `SortKey` so adding a key fails type-check until handled.
- [ ] **C2 — tie-breakers and null-handling are defined and tested.** Equal primary values fall back
      to `id` ascending (stable). `null`/missing `scheduled_for` / `complexity` / `estimate_hours`
      sort **last** in both `asc` and `desc`. `priority` uses `PRI_RANK` (critical-first on `asc`).
      `title` is case-insensitive `localeCompare`.
- [ ] **C3 — a Sort dropdown lives next to the FilterBar, styled to match the `filter-btn`.** It shows
      the active key + direction, lets the user pick a key and toggle `asc`/`desc`, and uses the §3
      tokens (no new palette). Sort state `{ key: SortKey, dir: SortDir }` is App-level and **persists
      to `localStorage('lifeos-sort')`** with a safe default (`{ key: 'priority', dir: 'asc' }`) on
      missing/corrupt JSON.
- [ ] **C4 — sort applies to the right surfaces and is documented per-view.** Today: applied to the
      **committed list and the candidate queue** (replacing / wrapping `sortCommitted`'s hardcoded
      `PRI_RANK` order — when sort key is `priority` the result equals today's behavior). Board: sorts
      **within each status column** (the column-by-status layout is unchanged; only intra-column order
      follows `sortTasks`). Roadmap and Activity **keep their intrinsic order** (milestone grouping /
      reverse-chronological). The Sort control is rendered **only on sortable views** (`SORTABLE_VIEWS` =
      today, board) and **hidden** on Roadmap/Activity/Artifacts — a shown-but-ignored control is itself
      the silent omission to avoid, so it is omitted rather than disabled. (Decision MCPAT-069-D2, revised
      from "shown but marked ignored" per the Codex review + product sign-off.) Today's hero + capacity
      remain computed over the unfiltered, unsorted set (P2-01 AC3 preserved).

### Phase D — Date-preset filters

- [ ] **D1 — `Filter` carries `scheduled`, `createdWithin`, `updatedWithin` preset dimensions**
      (single-select each: `scheduled ∈ {'today','week','overdue','none',null}`,
      `createdWithin`/`updatedWithin ∈ {'24h','7d','30d',null}`), defaulted to `null` in
      `EMPTY_FILTER`, persisted and backward-compat-hydrated (B7).
- [ ] **D2 — `matchFilter` evaluates the date presets against the injected `now`.** `scheduled:'today'`
      matches a task scheduled for the local today; `'week'` the next 7 days; `'overdue'`
      `scheduled_for` before today; `'none'` `scheduled_for == null`. `createdWithin`/`updatedWithin`
      windows are measured back from `now`. With every date dimension `null`, no date constraint is
      imposed. The function takes `now` as an argument — tests pass a fixed clock and assert exact
      boundary behavior (inclusive/exclusive documented).
- [ ] **D3 — date presets render as a FilterBar section (single-select chip groups) with active
      chips.** A "Scheduled" group (Today / This week / Overdue / Unscheduled), a "Created" group, and
      an "Updated" group, each radio-style (picking one clears the other in its group; picking the
      active one clears it). They live in the "More filters" disclosure (B5). Active selections show a
      removable chip and count toward the Filter button badge.
- [ ] **D4 — no free date-range picker.** Only the fixed presets above are offered. A custom
      from/to range is explicitly out of scope (noted in Out of Scope).

### Cross-cutting

- [ ] **X1 — filtering and sorting stay 100% client-side.** No new `/api/tasks` query params are
      introduced; views continue to consume the full `['tasks']` cache and narrow/order in-memory.
- [ ] **X2 — `npm run type-check` (strict, no `any`) and `npm run build` pass.** The `matchFilter`
      dimension checks and the `sortTasks` key switch are **exhaustive over the `src/ui/src/types.ts`
      unions** (`TaskType`, `TaskStatus`, `TaskPriority`, `SortKey`) — adding a new enum member fails
      type-check until handled.

---

## Technical Notes

### Target files (real paths, current state confirmed 2026-06-02)

- **Edited (core):** `C:\code\mcp-agent-tasks\src\ui\src\lib\filter.ts` — extend `Filter` +
  `EMPTY_FILTER`; add `STALE_DAYS` (= 7), the `attention` predicate helper, the `TaskLike` interface,
  the `now` arg, and the date-preset logic; extend `filterActive` to cover all dimensions. Stays pure
  / React-free.
- **New:** `C:\code\mcp-agent-tasks\src\ui\src\lib\sort.ts` — `SortKey`, `SortDir`, `sortTasks`. Pure,
  imports `PRI_RANK` from `lib/format.ts` and `Task` from `types`.
- **New:** `C:\code\mcp-agent-tasks\src\ui\src\lib\sort.test.ts` — vitest unit suite (Phase C).
- **Edited:** `C:\code\mcp-agent-tasks\src\ui\src\lib\filter.test.ts` — extend with Phase B + D cases
  (new dimensions, attention predicate with fixed `now`, date presets).
- **Edited:** `C:\code\mcp-agent-tasks\src\ui\src\components\FilterBar.tsx` — add the "More filters"
  disclosure with Type/Status/Priority/Milestone/attention sections + date-preset groups; render new
  active chips; thread new toggle props.
- **New (optional split):** `C:\code\mcp-agent-tasks\src\ui\src\components\SortControl.tsx` — the Sort
  dropdown (or inline in the bar; keep components <200 lines per code-quality limits).
- **Edited:** `C:\code\mcp-agent-tasks\src\ui\src\App.tsx` — extend `readStoredFilter()` (backward-compat
  hydration), add per-dimension toggle handlers + setters, add `sort` state +
  `localStorage('lifeos-sort')` persistence + `readStoredSort()`, pass `now`/sort into views, extend
  the command palette Filter group only if cheap (Open Question), wire new FilterBar/SortControl props.
- **Edited (consumers — pass new matcher signature + sort):**
  `views/TodayView.tsx` (committed + candidate lists), `views/BoardView.tsx` (within-column sort),
  `views/RoadmapView.tsx`, `views/ArtifactsView.tsx`, `views/ActivityView.tsx`. Update every
  `matchFilter(filter, project, area, areaMap)` call to the new `(filter, taskLike, areaMap, now)` form.
- **Edited:** `C:\code\mcp-agent-tasks\src\ui\src\types.ts` — add `triage_note?: string` to `Task`
  (B8). The backend already emits it (verified via `sqlite-index.ts:282` `rowToTask` → `/api/tasks`
  L1361 + `/api/today` L1641/L1668); this is a client-type-only change.
- **Edited (styles):** `C:\code\mcp-agent-tasks\src\ui\src\index.css` — classes for the disclosure,
  the new chip groups, and the sort dropdown, realised in the §3 token system (mirror existing
  `filter-pop` / `fp-area-chip` patterns; no new Tailwind palette).

### Matcher refactor sequencing (do this first, in Phase B)

1. Introduce `TaskLike` and change `matchFilter`'s second param from `project: string` to
   `task: TaskLike` (keep `areaMap` 3rd, add `now` 4th). Update **all five view call sites** + the
   artifact/activity partial-object call sites in the same commit so the tree compiles.
2. Update `src/ui/src/lib/filter.test.ts` call sites to the new signature **before** adding new cases.
3. Add the new dimension checks + attention predicate, then Phase D date logic, each with tests.

This ordering avoids a half-migrated signature that fails type-check across the views.

### FilterBar layout — the "wall" risk (B5)

The popover today holds **2** sections (Projects, Areas). Adding 5 more dimensions + 3 date groups
would make it unusable. Required layout:
- **Primary (always visible):** Projects, Areas (unchanged from P2-01).
- **"More filters" disclosure (collapsed by default):** Type · Status · Priority chip groups in a
  **two-column grid** to stay compact; Milestone as a scrollable chip list; "Needs attention" toggle;
  then the three date-preset radio groups. Disclosure open/closed is session UI state (a
  `useState`, not persisted) — do not add another localStorage key for it.
- Reuse the existing chip atoms/classes (`fp-area-chip`, `filter-chip`, `Checkbox`) and `tokens.ts`
  colors for status/priority/type dots — do not hardcode hex.

### Sort control UI (C3)

- Mirror the `filter-btn` style. A compact dropdown: a button showing "Sort: Priority ↓" that opens a
  small menu of the 7 keys + an asc/desc toggle. Outside-click closes (reuse the FilterBar
  `mousedown` pattern). Place it in the same bar row, right of the Filter button.

### Backward-compat hydration (B7) — the migration trap

`readStoredFilter()` currently validates only `projects`/`areas` arrays. Extend it to **spread defaults
first, then overlay validated persisted values**:
```ts
return { ...EMPTY_FILTER, projects: validStrings(p.projects), areas: validAreas(p.areas),
         types: validTypes(p.types), /* …each new dim validated, missing → default */ }
```
Validate each new array element against the `src/ui/src/types.ts` unions (same pattern as the existing
`areas` guard at L78). `attention` → boolean coercion. `scheduled`/`createdWithin`/`updatedWithin` →
validate against their literal sets, else `null`. The old `{projects,areas}` shape must produce a
fully-formed `Filter`, never `undefined` fields (which would break exhaustive checks downstream).

---

## Failure Modes

- **Old persisted filter shape (`{projects,areas}` only).** Must hydrate to a full `Filter` with new
  dims defaulted — never leave `types`/`statuses`/etc. `undefined`. Covered by B7; a missing-key
  read must not throw and must not drop the user's persisted projects/areas.
- **Corrupt `localStorage('lifeos-filter')` / `localStorage('lifeos-sort')`.** `JSON.parse` failure or
  wrong-typed value → `EMPTY_FILTER` / default sort `{priority,asc}`, wrapped in try/catch. Never crash
  on read.
- **Unknown / closed milestone id in a persisted filter.** A milestone the popover no longer lists
  (closed, deleted) still filters by raw id and renders an active chip with the id — no crash, no
  popover break (B6). The user can remove the chip to recover.
- **Non-task surfaces under task-only dimensions.** Artifacts/Activity rows and Roadmap milestones have
  no `type`/`status`/`priority`/`scheduled_for`. They filter by **project + area ONLY**, via the
  dedicated `matchProjectArea()` matcher — task-level dimensions are N/A to these rows and are ignored,
  so an active task-level filter never blanks the whole surface. (Decision MCPAT-069-D1: revised from the
  original "exclude under task-only dims" after the Codex cross-model review flagged the empty-state as a
  regression — a status filter blanking the entire Roadmap is worse UX than showing project/area-relevant
  rows. RoadmapView additionally honours an explicit `milestones` filter against the milestone's own id.)
- **Missing sortable values.** `null`/absent `scheduled_for` / `complexity` / `estimate_hours` sort
  **last** (nulls-last) regardless of direction, never `NaN`-comparison garbage that destabilizes the
  sort. Tie-break by id to keep the order deterministic.
- **`triage_note` absent on a given task.** `triage_note` is optional (`triage_note?: string`) — only
  triaged-but-not-promoted drafts carry it. The attention flagged-draft clause is
  `triage_note set OR block_reason set`, so a draft with neither simply doesn't match the
  flagged-draft branch (it may still match via the stale branch). A task without `triage_note` reads
  as `undefined` and never matches that branch — correct, not a bug.
- **Empty result set.** Any combination that matches nothing must render the view's existing empty
  state, with the bar + Clear visible — same contract as P2-01. On Today the unfiltered hero +
  capacity still render (P2-01 AC3 / C4).
- **Clock drift in date presets.** Because `now` is injected, the matcher is deterministic; the App
  passes a single `now = Date.now()` captured per render so all rows compare against the same instant
  (no per-row clock skew within a render).

---

## Out of Scope

- **Server-side filtering / sorting.** `/api/tasks` already accepts some query params
  (status, milestone, label, project) but this spec does **not** move to server-side querying —
  everything stays client-side over the loaded cache (X1).
- **Free date-range picker.** Only the fixed presets in Phase D are offered; a custom from/to date
  range is explicitly out (D4).
- **Saved filter presets / named views.** Persisting *named* filter+sort combinations ("My client
  view") is a future concern — only the single current filter + sort persist.
- **New filter dimensions on non-task surfaces.** Artifacts/Activity gain no bespoke filtering beyond
  what project/area/milestone derivation already gives them.
- **Favourites / quick-chip changes (P2-02).** Untouched; the fav-chip row stays as-is.
- **Restyling the views themselves.** Only the bar, the new controls, and the matcher/sort logic
  change; view layouts are unchanged apart from consuming the new matcher signature + sort.
- **Backend/index changes for `triage_note`.** None — the field is already persisted and serialized
  end-to-end (verified). B8 is a client-type-only addition.

---

## Dependencies

- **P2-01 (Global Filter)** — the `Filter` type, `matchFilter` purity contract, `lifeos-filter`
  persistence, AND-across/OR-within semantics, and the `areaMap` plumbing this spec extends. Hard
  dependency; read it first.
- **P1-01 (Design System)** — `src/ui/src/lib/tokens.ts` enum→class/color maps reused for the new
  Type/Status/Priority chips; §3 tokens for the disclosure + sort dropdown. No new palette.
- **P1-09 (Board/Roadmap/Activity)** + **P1-03 (Today)** + **P1-08 (Artifacts)** — the views whose
  `matchFilter` call sites are migrated and whose order Phase C governs (Board within-column, Today
  lists). Their record shapes + empty states must exist.
- **`useMilestones()` / `/api/milestones`** — supplies the milestone filter options (B6).
- **`lib/format.ts`** (`PRI_RANK`, `localToday`) — reused for the priority sort key and local-day
  boundaries in date presets.

---

## Testing

- **`matchFilter` unit tests — extend `src/ui/src/lib/filter.test.ts` (Phase B + D):**
  - **Migrate existing call sites** to the new `(filter, taskLike, areaMap, now)` signature first;
    all current P2-01 cases (empty matches all, OR-within projects/areas, AND-across, area derivation,
    unknown prefix, `filterActive`, `projectOfId`) still pass.
  - **Types/statuses/priorities/milestones:** OR-within each, AND-across; a task whose field is not in
    a non-empty dimension is excluded; `EMPTY_FILTER` matches all; matching on `task.milestone`.
  - **`attention` predicate** (with a **fixed `now`**): blocked → match; draft + `triage_note` →
    match; draft + `block_reason` (no triage_note) → match; `last_activity` older than `STALE_DAYS`
    (7 days) → match; freshly-touched `in_progress` → no match; `attention:false` → no constraint.
    Assert the 7-day boundary explicitly (just-under-7-days → no match, just-over → match).
  - **Date presets** (fixed `now`): `scheduled` today/week/overdue/none boundaries (assert
    inclusive/exclusive at the day edge); `createdWithin`/`updatedWithin` 24h/7d/30d window boundaries;
    all-null → no constraint.
  - **Backward-compat hydration** of an old `{projects,areas}` JSON blob → full defaulted `Filter`.
- **`sortTasks` unit tests — new `src/ui/src/lib/sort.test.ts` (Phase C):**
  - Each key asc + desc produces the expected order on a fixture set.
  - `priority` asc = critical-first (matches `PRI_RANK`); `title` case-insensitive.
  - Nulls-last for `scheduled`/`complexity`/`estimate` in both directions.
  - Stability: equal primary values keep id-ascending order; input array is not mutated.
  - Exhaustiveness: the `SortKey` switch has no fallthrough (a TS compile guard).
- **Type-check + build:** `npm run type-check` (strict, no `any`; exhaustive enum/`SortKey` switches)
  and `npm run build` pass; no dangling old-signature `matchFilter` calls.
- **Visual / in-browser check (run `serve-ui` on :4242):**
  - Open the Filter popover → "More filters" discloses Type/Status/Priority/Milestone/attention + date
    groups without overflowing; selecting each adds a removable active chip and bumps the badge.
  - Toggle "Needs attention" → only blocked/flagged-draft/stale tasks remain across views.
  - Pick a milestone → roadmap-slice narrows; reload → filter + sort restore exactly.
  - Change the Sort control → Today lists and Board columns reorder; Roadmap/Activity order unchanged.
  - Set a date preset (Overdue / Created 7d) → list narrows correctly relative to today (2026-06-02).
  - Confirm an old persisted `{projects,areas}` value still loads (manually seed localStorage, reload).

---

## Open Questions

- **Sort scope on Today candidates.** C4 applies sort to both the committed list and the candidate
  queue. Should the candidate queue keep its own intrinsic ranking (it currently sorts by `PRI_RANK`
  and may have a scheduling heuristic in `useToday.ts`) and ignore the global sort, or follow it?
  Default: follow the global sort for consistency; flag if the candidate heuristic must be preserved.
- **Command-palette coverage of new dimensions.** P2-01 added "Filter by <PREFIX>" + "Clear all".
  Should the palette also expose "Filter by status: blocked", "Sort by …", etc.? Default: **defer** —
  adding every dimension to the palette risks a long, noisy Filter group; ship the bar UI first.
- **Per-group "clear" affordances.** With ~9 dimensions, should each section have its own clear, in
  addition to the global Clear? Default: rely on removable active chips + global Clear; revisit if the
  popover feels heavy in the visual check.
- **Should `attention` and the date presets compose with `none`/`overdue` intuitively?** e.g.
  `attention:true` + `scheduled:'overdue'` is AND (overdue *and* needs attention). Confirm AND-compose
  is the desired semantics (it is the P2-01 default and what this spec implements).

---

## Resolved Decisions

- **`STALE_DAYS` = 7 (product decision).** The "needs attention" task-staleness threshold is fixed at
  **7 days**, not 14. Single exported constant in `lib/filter.ts` (B4). Distinct from the artifact
  color thresholds (`ArtifactsView.tsx`) and the backend claim-TTL staleness.
- **`triage_note` is included (product decision).** `triage_note?: string` is added to the client
  `Task` type (B8) and is the primary signal in the attention flagged-draft clause (with
  `block_reason` as an additional OR signal). The backend already persists and serializes it
  end-to-end (`sqlite-index.ts` column + `rowToTask` L282 → `/api/tasks` + `/api/today`), so **no
  backend or index change is required** — verified.
