# P2-02 — Favourites (pinned projects)

**Type:** Feature
**Phase:** 2 (Additive)
**Epic:** MCPAT-022 — Life OS UI Reskin + Agent Layer
**Size:** S

> Shared tokens, data shapes, and client conventions live in
> [`00-epic-overview.md`](./00-epic-overview.md) — §3 (area-dot colours), §4 (`Project`/`Task` shapes),
> §5 (`['tasks']`/`['projects']` queries, `favorites` client state, `localStorage('lifeos-favs')`).
> The global filter, `Filter` shape, `matchFilter`, and the FilterBar popover are owned by
> [`P2-01`](./P2-01-global-filter.md); this spec only adds the **star toggle**, the **nav Favourites
> group**, and the **favourite quick-chips** on top of it. The nav already renders a Favourites
> *placeholder* — see [`P1-02`](./P1-02-app-shell-navigation-keyboard.md) §AC + `Nav.tsx`. This spec
> fills it in. None of the above is repeated here.

---

## Description (WHY)

A power user lives across ~6 active projects but at any moment cares about 2–3. The global filter
(P2-01) already lets them scope the whole app to a project, but reaching it means opening the Filter
popover and hunting through the full project list every time. Favourites makes the frequent pivot a
**one-tap** action from two always-visible surfaces: a pinned group in the left nav, and quick-chips
at the front of every FilterBar.

Starring a project (from the P2-01 Filter popover) pins it. A pinned project then shows up as (1) a
nav entry under a **Favourites** group — prefix, area dot, live open-task count — and (2) a quick
quick-filter chip in every FilterBar. Clicking either toggles that project in the **global filter**,
so the same gesture scopes the entire app. On Today that doubles as an instant per-project peek of
the committed list + candidate queue (the hero and capacity stay global, per P2-01).

The state is tiny — `favorites: string[]` of project prefixes — and persists exactly like the
prototype (`localStorage('lifeos-favs')`, reuse the key verbatim per §5).

---

## Acceptance Criteria

1. **Star toggle persists.** Each project row in the P2-01 Filter popover has a star toggle
   (`Star` / `StarFill` from `lucide-react`). Clicking it (a) flips membership in App-level
   `favorites: string[]` without toggling the row's filter checkbox (`e.stopPropagation()`), and
   (b) writes `favorites` to `localStorage('lifeos-favs')`. Reloading the page restores the exact
   pinned set. The starred state is reflected immediately in both the nav group and the FilterBar
   chips.

2. **Nav Favourites group.** When `favorites.length > 0`, the left nav renders a **Favourites**
   group label below the main nav items (replacing the P1-02 placeholder). Each pinned project shows,
   in order: an **area dot** coloured per §3 (`areaOfProject(prefix)`), the **project prefix**, and a
   **live open-task count** (tasks whose status is not `done`/`cancelled`). When `favorites` is empty
   the group is not rendered (no empty header).

3. **Pinned nav item toggles global filter.** Clicking a pinned nav item calls the P2-01
   `toggleFilterProject(prefix)` — it does **not** navigate views. The item shows an active treatment
   (`surface-2` background per §3) iff `filter.projects.includes(prefix)`. Tooltip: `<name> — click to
   filter everywhere`.

4. **FilterBar quick-chips.** Every FilterBar (P2-01) renders a leading row of favourite chips —
   one per pinned project, each with a `StarFill` glyph (amber), the prefix, and the open-task count.
   Clicking a chip calls `toggleFilterProject(prefix)` (same global-filter toggle as the nav item);
   the chip shows an active treatment when that project is in `filter.projects`. A 1px hairline
   divider separates the chips from the Filter button. Chips render only when `favorites.length > 0`.

5. **App-level state + single source of truth.** `App.tsx` owns `favorites` and a single
   `toggleFav(prefix)` handler, both threaded into `Nav` and every `FilterBar` (alongside the P2-01
   `filter` / `toggleFilterProject`). There is exactly one `favorites` array and one persistence
   effect; no component holds a private copy.

6. **Open-task counts are shared, not recomputed per surface.** The per-project open-task count map
   is derived **once** (App-level `useMemo` over the `['tasks']` query) and passed to both the nav
   group and the FilterBar chips, so the two surfaces never disagree.

---

## Technical Notes

**State shape (App.tsx, mirrors `reference/app.jsx:192–209`):**

```ts
// favorites = array of project prefixes, e.g. ['MCPAT', 'COND']
const [favorites, setFavorites] = useState<string[]>(() => {
  try {
    const raw = localStorage.getItem('lifeos-favs')
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
})

useEffect(() => {
  localStorage.setItem('lifeos-favs', JSON.stringify(favorites))
}, [favorites])

const toggleFav = (prefix: string): void =>
  setFavorites((fs) => (fs.includes(prefix) ? fs.filter((x) => x !== prefix) : [...fs, prefix]))
```

- **Default value.** The prototype seeds `['MCPAT', 'COND']`; in production seed **`[]`** (empty) so
  a fresh install shows no pinned group until the user stars something. Pruning (see Failure Modes)
  also keeps it honest.

**Open-task count source (the `['tasks']` query, §5):**

```ts
// derived ONCE at App level, passed down to Nav + FilterBar
const projectCounts: Record<string, number> = useMemo(() => {
  const m: Record<string, number> = {}
  for (const t of tasks) {
    if (t.status !== 'done' && t.status !== 'cancelled') {
      m[t.project] = (m[t.project] ?? 0) + 1
    }
  }
  return m
}, [tasks])
```

This is the prototype's `projectCounts` (`reference/app.jsx:228–233`) wired to the real
`['tasks']` query instead of the mock store. Do not add a backend endpoint for counts — derive
client-side from tasks already loaded.

**Integration points:**

- **P2-01 FilterBar** (`src/ui/src/components/FilterBar.tsx`) — the popover-row star toggle
  (`reference/filters.jsx:76–80`) and the leading favourite chips (`reference/filters.jsx:44–57`).
  FilterBar already receives `filter` + `toggleFilterProject` from P2-01; this spec adds
  `favorites`, `projectCounts`, and `onToggleFav` to its props (the prototype's `filterProps`
  bundle, `reference/app.jsx:235–239`).
- **P1-02 nav** (`src/ui/src/components/Nav.tsx`) — fills the Favourites placeholder
  (`P1-02` §AC, line 48 / 89). Render pattern: `reference/app.jsx:525–540` (`nav-pinned` →
  group label → `pin-item` per fav with `pin-dot` / `pin-prefix` / `pin-count`). Port the inline
  styles to Tailwind tokens (area dot via §3 area colours; active = `bg-surface-2`).
- **`areaOfProject(prefix)`** — area dots derive from the project's area. The P2-01 `lib/filter.ts`
  helper is the canonical resolver; reuse it, do not reimplement. **Watch:** the live
  `GET /api/projects` endpoint currently returns only `{ prefix, path }` (`src/server-ui.ts:460–462`)
  — no `area` or `name`. P2-01 must supply the project→area mapping (config-driven or a derived
  `areaOfProject`); this spec consumes whatever P2-01 settles on and adds no endpoint of its own.
- Icons: `Star`, `StarFill` (use `lucide-react` `Star` filled vs outline — no hand-rolled SVGs,
  epic §6 / §9).

---

## Failure Modes

- **Favourited project no longer exists.** A pinned prefix may reference a project that has been
  removed from config (or never resolves via `areaOfProject`). Both surfaces must **skip-render** a
  pin whose project can't be resolved (prototype guards this: `if (!proj) return null`,
  `reference/app.jsx:529`). Additionally, **prune** stale prefixes from `favorites` once the projects
  list has loaded — on `['projects']` load, drop any favourite not present in the known set and
  persist the pruned array. Never crash or show a blank pin.
- **Open-task count still loading.** Before the `['tasks']` query resolves, `projectCounts` is empty.
  Render the pin/chip **without** a count badge (count is conditional — only shown when `> 0`, per
  prototype `projectCounts[pref] ? … : null`). Do not show `0` or a spinner in the badge slot.
- **Empty favourites.** No pinned projects → no nav group header and no chip row (AC-2, AC-4). Do not
  render an empty "Favourites" label or a dangling divider.
- **localStorage unavailable / corrupt JSON.** The lazy initialiser is wrapped in try/catch and falls
  back to `[]` (matches §5 graceful-degradation posture); a write failure must not throw into render.

---

## Out of Scope

- **Drag-reorder of favourites** — pins render in insertion order; no manual reordering, no drag
  handles. (Deferred; see Open Questions.)
- Multi-select / bulk-pin from the popover, favourite folders/groups, or per-favourite colour
  overrides.
- A favourites/quick-filter affordance inside the command palette beyond the P2-01 "Filter by X"
  actions (those are owned by P1-10 / P2-01).
- Any backend endpoint for favourites or open-task counts — counts derive from the existing
  `['tasks']` query (unless the config-endpoint option in Open Questions is later adopted).
- Pinning anything other than a project (no pinned tasks, artifacts, or saved filters).

---

## Dependencies

- **P2-01 — Global filter + FilterBar** (hard): provides `filter`, `toggleFilterProject`,
  `matchFilter`, `areaOfProject`/project→area mapping, and the FilterBar popover this spec adds the
  star toggle and chips to. Cannot start before P2-01's FilterBar exists.
- **P1-02 — App shell, navigation & global keyboard** (hard): provides `Nav.tsx` with the Favourites
  group placeholder and the App-level client-state model that `favorites` slots into.

---

## Testing

- **Unit — `toggleFav`.** Toggling an unpinned prefix adds it; toggling a pinned prefix removes it;
  order is preserved on add.
- **Unit — `projectCounts`.** Counts exclude `done` and `cancelled`; a project with zero open tasks
  produces no key (so the badge is omitted).
- **Unit — pruning.** Given `favorites = ['MCPAT', 'GONE']` and a projects set lacking `GONE`, after
  load `favorites` is pruned to `['MCPAT']` and persisted.
- **Component — star toggle.** Clicking the popover star flips `favorites` and does **not** toggle the
  row's filter checkbox (`stopPropagation` verified).
- **Component — nav group.** With `favorites = ['MCPAT']` and a matching project, the nav renders the
  Favourites label, an area dot of the correct colour, the prefix, and the count when `> 0`. Empty
  `favorites` renders no group. Clicking a pin calls `toggleFilterProject` and does not change `view`.
- **Component — FilterBar chips.** Chips render one per favourite with the open-count; clicking a chip
  calls `toggleFilterProject`; the active chip reflects `filter.projects` membership; no chips render
  when `favorites` is empty.
- **Persistence — round-trip.** Pin two projects, reload (re-mount with the same `localStorage`),
  assert both surfaces restore the pinned set.
- `npm run type-check` (strict, no `any`) and `npm run build` pass.

---

## Open Questions

- **localStorage vs config endpoint.** The prototype and §5 use `localStorage('lifeos-favs')`
  (client-only, per-browser). Should favourites instead be promoted to a server user-setting (e.g.
  `GET/PUT /api/config`, mirroring the capacity-target question in the epic §11) so they sync across
  devices/tabs? **Default for this spec: localStorage**, matching P2-01's `lifeos-filter`. Revisit
  only if cross-device sync becomes a requirement; if adopted, it becomes a small P2-04-style backend
  addition, not a change to this spec's UI contract.
- **Drag-reorder.** Out of scope here. If users want control over pin order beyond insertion order,
  spec it as a follow-up (likely `@dnd-kit` or an up/down control) rather than expanding this ticket.
