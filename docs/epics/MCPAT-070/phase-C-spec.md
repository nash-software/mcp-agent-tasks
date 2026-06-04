# Spec: MCPAT-070 Phase C — Today filter+sort toolbar (M)

**Epic:** MCPAT-070 Life OS Phase 3 UI Reskin · **Branch:** `feat/MCPAT-070-p3c-today-toolbar`
**Pipeline:** `/run-pipeline docs/epics/MCPAT-070/phase-C-spec.md --phase C --auto`
**Depends on:** Phase B merged (shares `App.tsx`; branch from fresh `origin/main` which contains A+B).
**Reference appendix:** `phase3-lifeos-picture.md` §Sort · prototype `design_handoff/reference/today.jsx` + `filters.jsx` · `styles.css` (`.today-toolbar`, `.sort-*`) · visual target `01-today.png` toolbar region (Phase-3 toolbar layered on Today).

## Scope boundary — ONLY these files

UI root is `src/ui/src/`. Touch **only**:
- `views/TodayView.tsx`
- `components/FilterBar.tsx` (layout only — **no behaviour change**; loses its own bottom margin)
- `components/SortControl.tsx`
- `lib/sort.ts`
- `App.tsx` (Today toolbar wiring only)
- `index.css` (append `.today-toolbar` + `.sort-*` selectors)

## Shared contracts (authoritative)

- `SortKey = 'priority' | 'area' | 'estimate' | 'project'` (discriminated). Persisted `localStorage('lifeos-sort')`, default `'priority'`. Corrupt/unavailable → default `'priority'`.
- `PRI_RANK = {critical:0,high:1,medium:2,low:3}`. `AREA_ORDER = {client:0,personal:1,internal:2,outsource:3}`.
- `taskCmp(sortBy)`: area uses `AREA_ORDER`; estimate **descending**; project A→Z by ID prefix; **priority is always the tiebreaker** (area/estimate/project all tiebreak on priority). Null-guard estimate/area.

## D4 — SortControl scope (resolve from code FIRST)

Before editing, **read `App.tsx` SortControl usage**:
- If `SortControl` is **shared** across other filterable views (Board/Artifacts/etc.): keep their existing sort keys intact and render the 4 Phase-3 keys (Priority/Area/Estimate/Project) **only on the Today toolbar**. Do not change sorting on any other view.
- If `SortControl` is **Today-only**: swap the keys freely.
- Either way: **no regression** to non-Today views. The Created/Updated/Scheduled/Title/Complexity sorts elsewhere stay.

## Acceptance Criteria

- [ ] `.today-toolbar` row wraps FilterBar (`flex:1`) + Sort control (pinned right). FilterBar loses its own bottom margin.
- [ ] SortMenu options exactly **Priority / Area / Estimate / Project**; persisted `localStorage('lifeos-sort')`; button reads `↕ Sort: <b>{label}</b> ⌄`; right-aligned popover, selected row accent check, closes on outside-click.
- [ ] D4 honoured (see above) — no sort-behaviour change on non-Today views.
- [ ] `taskCmp(sortBy)` implemented per contract: area→AREA_ORDER, estimate descending, project A→Z prefix; priority always tiebreaker.
- [ ] Applied to committed list (with `done` sinking to bottom first) and within each candidate area-group; candidate area-grouping is structural and preserved.
- [ ] Hero + capacity gauge are NOT sort/filter-scoped.

## Tests

- [ ] Unit: `lib/sort.ts` `taskCmp` for all 4 keys incl. tiebreak + estimate-desc + done-sink (follow existing `sortTasks` test patterns).
- [ ] Run the FULL vitest suite before PR.

## Gate

- [ ] Root `npm run type-check` (`tsc -b`). No `any`; discriminated `SortKey`; functions <50 lines; components <200 lines.
