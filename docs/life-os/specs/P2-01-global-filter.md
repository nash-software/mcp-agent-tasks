# P2-01 — Global Filter (`lib/filter.ts` + upgraded `FilterBar`)

**Type:** Feature
**Phase:** 2 (Additional Features)
**Epic:** MCPAT-022 — Life OS UI Reskin
**Size:** M

> Shared tokens, data shapes, and client conventions live in
> [`00-epic-overview.md`](./00-epic-overview.md). This spec references §4 (Task / Artifact shapes,
> `Area = 'client' | 'personal' | 'outsource' | 'internal'`, `area` denormalised on Task with
> `fallback = areaOfProject(project)`) and §5 (`filter` client state, `localStorage('lifeos-filter')`).
> Handoff §7.1 is the behavioural reference; `reference/filters.jsx` is the canonical logic source.

---

## Description

Today the app has **five filterable surfaces with no shared filter**: Board and Roadmap consume a
local `FilterState` (`{ project, status, milestone, label }`) via the legacy
`components/FilterBar.tsx` (three `<select>` dropdowns), while Today, Artifacts, and Activity are
**not filterable at all** (`App.tsx` hides the bar for them: `showFilterBar = activeTab !== 'activity'
&& activeTab !== 'today' && activeTab !== 'braindump' && activeTab !== 'artifacts'`). The filter
state is local to `App.tsx`, never persisted, and uses a shape the rest of Life OS does not speak.

**Why one shared filter (the WHY):** Life OS is a single calm surface over *all* the user's work
across projects and life-areas. "Show me only Conductor" or "show me only client work" is a
whole-app intent, not a per-view setting — switching from Board to Today to Activity while a filter
silently resets (or doesn't exist) breaks the mental model that the app is one lens over one body of
work. A single `Filter` lifted to App-level state, persisted to `localStorage('lifeos-filter')`,
applied uniformly across Today / Board / Roadmap / Artifacts / Activity, makes the filter a property
of *the user's current focus*, not of whichever view they happen to be on.

This spec adds one new module — **`lib/filter.ts`** (the `Filter` type + `matchFilter` /
`areaOfProject` / `projectOfId` helpers, ported verbatim from `reference/filters.jsx`) — and
**replaces** the legacy `components/FilterBar.tsx` with the Life OS bar (favourite quick-chips,
Filter popover, removable active-filter chips, Clear). It also wires the **Filter** command-palette
category that P1-10 shipped as a stub.

---

## Domain Model — `Filter` + `matchFilter`

The filter is **two dimensions**, both multi-select:

```ts
import type { Area } from '../types' // 'client' | 'personal' | 'outsource' | 'internal' (epic §4)

export interface Filter {
  projects: string[] // project prefixes, e.g. ['COND', 'HRLD']
  areas: Area[]      // life-areas, e.g. ['client']
}

export const EMPTY_FILTER: Filter = { projects: [], areas: [] }
```

**Match semantics — AND across dimensions, OR within each (ported exactly from
`reference/filters.jsx:8`):**

```ts
export function matchFilter(filter: Filter, project: string, area?: Area): boolean {
  if (filter.projects.length && !filter.projects.includes(project)) return false
  if (filter.areas.length) {
    const a = area ?? areaOfProject(project)
    if (a == null || !filter.areas.includes(a)) return false
  }
  return true
}

export function filterActive(filter: Filter): boolean {
  return filter.projects.length > 0 || filter.areas.length > 0
}
```

- **OR within a dimension:** a record passes the `projects` test if its project is in *any* selected
  project (`includes`); same for `areas`.
- **AND across dimensions:** a record must pass *both* the project test *and* the area test. With
  `{ projects: ['COND'], areas: ['client'] }`, a record shows only if it is COND **and** client.
- **Empty dimension = no constraint:** an empty `projects` array imposes no project filter (every
  record passes that test); same for `areas`. `EMPTY_FILTER` therefore matches everything.
- **Area derivation (the `area ?? areaOfProject(project)` branch):** Task records carry a
  denormalised `area` (epic §4) — pass it directly. Records *without* an `area` field
  (artifacts, milestones, activity) call with `area` omitted, and `matchFilter` derives it from the
  project via `areaOfProject`.

**Area derivation + project derivation (ported from `reference/filters.jsx:4-5`):**

```ts
// project prefix -> area, for records that don't carry their own `area`.
// Backed by the project registry (see Technical Notes), not the prototype's window.projById.
export function areaOfProject(prefix: string): Area | null { /* registry lookup, null if unknown */ }

// activity / commit rows expose a task id but no `project` field — derive the prefix.
export function projectOfId(id: string): string { return String(id).split('-')[0] }
```

---

## Acceptance Criteria

1. **One shared `Filter` lives in App-level state and persists to `localStorage('lifeos-filter')`.**
   `App.tsx` holds a single `filter: Filter` (replacing the local `FilterState` /
   `EMPTY_FILTERS`), initialised by reading `localStorage('lifeos-filter')` (falling back to
   `EMPTY_FILTER` on missing/corrupt JSON), and writes it back on every change. The same `filter`
   object is passed to **all five** filterable views (Today, Board, Roadmap, Artifacts, Activity);
   switching views never resets or loses the filter, and a reload restores it exactly.

2. **`matchFilter` enforces AND-across / OR-within with area derivation.** Given
   `{ projects: ['COND','HRLD'], areas: ['client'] }`: a COND-client record matches; an HRLD-client
   record matches; a COND-internal record does **not** (fails area); an ACR-client record does
   **not** (fails project). `EMPTY_FILTER` matches every record. A record passed with no `area`
   argument has its area resolved via `areaOfProject(project)`.

3. **Today filters the committed list + candidate queue ONLY — never the hero or capacity.** When a
   filter is active on Today, the committed-tasks list and the candidate queue are narrowed via
   `matchFilter`, but **the hero ("what I'm doing now") and the capacity gauge are computed over the
   unfiltered set**. *Reasoning (per handoff §7.1):* the hero is the single current focus and
   capacity is "my whole day's load" — both are intentionally **not** project-scoped, so filtering
   them would misrepresent the day. (Verified: capacity aggregates `estimate_hours` across the whole
   committed set — critical-rule "Capacity calculation".)

4. **Records without an `area` field derive it from the project.** Artifacts and Milestones call
   `matchFilter(filter, record.project)` (no `area` arg) → area resolved via `areaOfProject`.
   Activity rows expose a task **id** but no `project` field → derive the prefix with
   `projectOfId(row.id)` first, then `matchFilter(filter, projectOfId(row.id))`. An area selection
   therefore filters these non-task surfaces correctly.

5. **The FilterBar renders favourite quick-chips, a Filter popover, active-filter chips, and Clear.**
   At the top of each filterable view the bar shows: (a) one **quick-chip per favourited project**
   (P2-02 data) that toggles that project in the filter; (b) a **Filter** button opening a popover
   with a **Projects** section (one row per project: checkbox toggles the project, a star toggles
   favourite — P2-02) and an **Areas** section (a chip per `Area` that toggles it); (c) one
   **removable chip per active project and per active area** (click removes it); (d) a **Clear**
   button (shown only when `filterActive(filter)`) that resets to `EMPTY_FILTER`. The popover closes
   on outside-click.

6. **The command palette exposes Filter-by-project and Clear-all-filters actions.** The **Filter**
   category in `buildCommands` (P1-10 shipped it as a disabled stub) now lists **"Filter by
   <PREFIX>"** for each known project (toggles that prefix in the App filter) and **"Clear all
   filters"** (resets to `EMPTY_FILTER`, shown/enabled only when `filterActive(filter)`). Running a
   filter command updates the shared App state — every view re-filters and the FilterBar reflects it.

7. **Legacy `FilterState` and the three-select FilterBar are fully removed.** The old
   `FilterState` (`{ project, status, milestone, label }`), `EMPTY_FILTERS`, and the dropdown
   `FilterBar` no longer exist; Board/Roadmap consume `Filter` + `matchFilter` instead of the
   removed shape. `npm run type-check` (strict, no `any`) and `npm run build` pass with no dangling
   references to the old type.

---

## Technical Notes

### Target files (real paths)
- **New:** `C:\code\mcp-agent-tasks\src\ui\src\lib\filter.ts` — `Filter`, `EMPTY_FILTER`,
  `matchFilter`, `filterActive`, `areaOfProject`, `projectOfId` (ported from
  `reference/filters.jsx`). Framework-light, no React import — pure functions, unit-testable.
- **Replaced:** `C:\code\mcp-agent-tasks\src\ui\src\components\FilterBar.tsx` — currently the
  three-`<select>` dropdown bar (project / milestone / label) bound to `FilterState`; rewritten to
  the Life OS bar (quick-chips + popover + chips + Clear) bound to `Filter`.
- **Edited:** `C:\code\mcp-agent-tasks\src\ui\src\App.tsx` — replace `FilterState` /
  `EMPTY_FILTERS` (lines ~16–22) with `Filter` / `EMPTY_FILTER`, persist to
  `localStorage('lifeos-filter')`, drop the `showFilterBar` exclusions for `today`/`artifacts`/
  `activity`, pass `filter` to all filterable views, and add the Filter-category commands to
  `buildCommands` (P1-10).
- **Edited (consumers):** `views/TodayView.tsx` (committed list + candidate queue only — §AC3),
  `views/BoardView.tsx`, `views/RoadmapView.tsx`, `views/ArtifactsView.tsx`, and the Activity view
  (`views/ActivityView.tsx` / `P1-09`) — each takes `filter: Filter` and applies `matchFilter`.
- **Edited:** `src/ui/src/types.ts` — remove `FilterState`; ensure `Area` is exported for `Filter`.

### `lib/filter.ts` — exact port from `reference/filters.jsx`
- `matchFilter` and `filterActive` are the lines `8–16` of `reference/filters.jsx`, retyped with
  `Filter` / `Area` (the prototype's `area != null ? area : areaOfProject(project)` becomes
  `area ?? areaOfProject(project)`; **guard the `null` case** — see Failure Modes — since
  `areaOfProject` can return `null` for an unknown prefix, which the prototype's `includes` would
  silently reject anyway, but we make it explicit).
- `projectOfId(id) = String(id).split('-')[0]` — verbatim (prototype line 5). Handles `"COND-88"` →
  `"COND"`.

### `areaOfProject` — registry-backed, not `window.projById`
The prototype reads a global `window.projById` (`reference/filters.jsx:4`). In the real app the
project→area mapping comes from the **task data** (epic §4: every Task carries a denormalised
`area`) and the **project registry** behind `/api/projects` (already consumed by
`components/ActionButton.tsx:56` as `ProjectInfo[]`). Implementation:
- Build a `Record<string, Area>` prefix→area map once at App level by reducing the loaded `['tasks']`
  cache (`task.project → task.area`), since the area is denormalised onto every task. Inject it into
  the `lib/filter.ts` helpers (module-level `setAreaMap(map)` setter, or pass the map as an arg) so
  the pure functions stay testable without importing React/query state.
- `areaOfProject(prefix)` returns the mapped `Area` or **`null`** when the prefix is unknown
  (no task seen yet for that project) — exactly the prototype's `p ? p.area : null` contract.

### FilterBar — Life OS rewrite (port from `reference/filters.jsx:29-116`)
- Props: `{ filter, favorites, projectCounts, onToggleProject, onToggleArea, onToggleFav, onClear }`
  (the prototype's `FilterBar` signature). `favorites` + `onToggleFav` are **P2-02 data** — consume
  them; this spec does not own the favourites-persistence or sidebar-pinning (see Out of Scope).
- **Quick-chips:** `favorites`-filtered projects render as `fav-chip`s; clicking calls
  `onToggleProject(prefix)` (add/remove from `filter.projects`).
- **Popover:** outside-click closes (the prototype's `mousedown` listener on `ref`, lines 33–38).
  Projects section = checkbox row (`onToggleProject`) + star button (`onToggleFav`,
  `e.stopPropagation()`); Areas section = a chip per `Area` (`onToggleArea`).
- **Active chips:** one per `filter.projects` and one per `filter.areas`, each removable by
  re-invoking the matching toggle.
- **Clear:** rendered only when `filterActive(filter)`, calls `onClear` → App resets to
  `EMPTY_FILTER`.
- Realise the prototype's class contract (`filter-bar`, `fav-chip`, `filter-btn`, `filter-pop`,
  `filter-chip`, `filter-clear`, `fp-area-chip`) in the §3 token system, mirroring how P1-10
  re-realised the `cmdk-*` classes. `projectCounts` (open-task count per prefix) drives the chip
  badge — derive from the `['tasks']` cache at App level.

### App wiring
- Initialise: `useState<Filter>(() => readJSON('lifeos-filter') ?? EMPTY_FILTER)`; persist via an
  effect (`localStorage.setItem('lifeos-filter', JSON.stringify(filter))`) — mirror the existing
  `lifeos-view` persistence pattern (epic §5).
- Toggle handlers (`onToggleProject`, `onToggleArea`) flip membership in the respective array
  immutably; `onClear` sets `EMPTY_FILTER`.
- Remove the `today`/`artifacts`/`activity` exclusions from `showFilterBar` so the bar renders above
  all five filterable views (the bar may stay hidden on non-filterable views — Inbox, Brain Dump).
- `buildCommands` (P1-10 lives in `App.tsx`): replace the Filter stub with real commands
  (per-project "Filter by <PREFIX>" + "Clear all filters") whose `run()` closures call the same
  toggle/clear handlers.

---

## Failure Modes

- **Unknown project prefix (no area).** `areaOfProject('XYZ')` returns `null` when no task has been
  seen for that prefix. `matchFilter` must treat `null` as "fails any area filter" (the explicit
  `a == null || !filter.areas.includes(a)` guard) — a record whose area can't be derived is excluded
  while an area filter is active, and included when only a project filter is active. Never throw on
  an unknown prefix.
- **Empty result set.** A filter that matches nothing must render each view's **empty state** (e.g.
  "No tasks match this filter"), not a blank/broken layout or an error — and the FilterBar (with its
  active chips + Clear) stays visible so the user can recover. On Today, an empty *committed* list
  under a filter still shows the unfiltered hero + capacity (AC3), so the view is never fully blank.
- **Corrupt / legacy `localStorage('lifeos-filter')`.** `JSON.parse` failure, or a stored value of
  the old `FilterState` shape, falls back to `EMPTY_FILTER` (wrapped in try/catch) — never crash on
  read.
- **Tasks not loaded yet (area map empty).** Before `['tasks']` resolves, `areaOfProject` returns
  `null` for everything; area filtering is simply inert until tasks load (project filtering still
  works against the prefix directly). Don't block rendering on the area map.

---

## Out of Scope

- **Favourites starring UI, persistence, and sidebar pinning are P2-02.** This spec *consumes*
  `favorites` + `onToggleFav` (renders the star toggle and quick-chips), but the
  `localStorage('lifeos-favs')` persistence, the left-nav Favourites group, and the live open-count
  pinning are owned by **P2-02 (Favourites)**. If P2-02 is not yet merged, the star wires to a
  no-op/placeholder handler and quick-chips render from an empty `favorites` array.
- **Status / milestone / label filtering.** The legacy `FilterState` carried `status`, `milestone`,
  `label`; the Life OS `Filter` is intentionally **projects + areas only** (handoff §7.1). Any
  status/milestone filtering Board/Roadmap need beyond `Filter` is a separate concern (Board has its
  own column-by-status layout).
- **Server-side filtering.** Filtering is entirely client-side over already-loaded query caches; no
  new API parameters.

---

## Dependencies

- **All Phase 1 views** that this filter applies to — **P1-03** (Today: committed list + candidate
  queue), **P1-08** (Artifacts), **P1-09** (Board / Roadmap / Activity). Their record shapes and
  empty states must exist before the filter can narrow them.
- **P1-10** (Command Palette) — this spec fills the **Filter** category stub P1-10 shipped, and
  reuses the `buildCommands` location in `App.tsx`.
- **P1-02** (App shell) — owns the App-level client state (`filter`, `cmdkOpen`) and persistence
  pattern this filter plugs into.
- **Pairs with P2-02 (Favourites)** — bidirectional: FilterBar renders favourites; favourites toggle
  the filter. Build P2-01 to consume P2-02's data contract (`favorites: string[]`, `onToggleFav`).

---

## Testing

- **`matchFilter` unit tests (vitest, on `lib/filter.ts`):**
  - **Empty filter matches all:** `matchFilter(EMPTY_FILTER, 'COND')` and with any area → `true`.
  - **OR within projects:** `{ projects: ['COND','HRLD'] }` → `true` for `'COND'` and `'HRLD'`,
    `false` for `'ACR'`.
  - **OR within areas:** `{ areas: ['client'] }` → `true` for a `'client'` record, `false` for an
    `'internal'` record.
  - **AND across dimensions:** `{ projects: ['COND'], areas: ['client'] }` → `true` for COND+client,
    `false` for COND+internal (passes project, fails area) and `false` for HRLD+client (fails
    project).
  - **Area derivation:** with an area map `{ COND: 'client' }`, `matchFilter({ areas: ['client'] },
    'COND')` (no `area` arg) → `true` via `areaOfProject`; with `area` passed explicitly, the passed
    value wins.
  - **Unknown prefix:** `areaOfProject('XYZ')` → `null`; `matchFilter({ areas: ['client'] }, 'XYZ')`
    → `false` (never throws).
  - **`filterActive`:** `false` for `EMPTY_FILTER`, `true` when either array is non-empty.
  - **`projectOfId`:** `projectOfId('COND-88')` → `'COND'`; handles a bare id with no dash.
- **Component (React Testing Library) on `FilterBar`:**
  - Toggling a project checkbox / quick-chip / active chip adds then removes it from `filter`.
  - Toggling an area chip adds/removes it; Clear appears only when `filterActive` and resets all.
  - Outside-click closes the popover.
- **Integration:** filter set on Board persists across a view switch to Today and a reload
  (`localStorage('lifeos-filter')`); on Today the hero + capacity remain computed over the unfiltered
  set while the committed list narrows (AC3).
- **Type-check + build:** `npm run type-check` and `npm run build` pass; no `any`; no remaining
  references to `FilterState` / `EMPTY_FILTERS`.

---

## Open Questions

- **Area-map source — tasks cache vs. `/api/projects`.** Default: reduce the `['tasks']` cache
  (`project → area`) since `area` is denormalised on every Task (epic §4). Should `/api/projects`
  instead carry `area` (so projects with zero loaded tasks still resolve)? Confirm whether
  `ProjectInfo` should be extended during build; falling back to `null` for unseen prefixes is the
  safe default either way.
- **Quick-chip vs. active-chip duplication.** When a favourited project is also active, it shows as
  both a (highlighted) quick-chip and a removable active chip. Confirm this is intended (prototype
  renders both) vs. suppressing the active chip for favourites.
- **Filter-by-project palette command set.** Should "Filter by <PREFIX>" list **every** known
  project, or only favourites / recently-used, to keep the Filter group short? Default: every project
  from the area map, ranked by the existing fuzzy scorer.
- **Activity rows without a parseable id.** If an activity row's id lacks a `-` (no prefix),
  `projectOfId` returns the whole string and it won't match any real project filter — confirm such
  rows should be **hidden** under an active project filter vs. always shown.
