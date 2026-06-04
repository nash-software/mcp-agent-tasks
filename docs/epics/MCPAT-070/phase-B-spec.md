# Spec: MCPAT-070 Phase B — Sidebar regroup + footer (M)

**Epic:** MCPAT-070 Life OS Phase 3 UI Reskin · **Branch:** `feat/MCPAT-070-p3b-sidebar-groups`
**Pipeline:** `/run-pipeline docs/epics/MCPAT-070/phase-B-spec.md --phase B --auto`
**Depends on:** Phase A merged (shares `App.tsx`; you branch from fresh `origin/main` which already contains A).
**Reference appendix:** `docs/epics/MCPAT-070/phase3-lifeos-picture.md` §NAV_GROUPS · prototype `design_handoff/reference/app.jsx` (nav + footer) · `styles.css` (`.nav-group*`, `.nav-foot*`, `.nav-density`, `.nd-btn`, `.nav-status`, `.ns-item`, `.nav-pinned`) · visual target `08-advisor.png` (full sidebar).

## Scope boundary — ONLY these files

UI root is `src/ui/src/`. Touch **only**:
- `components/Nav.tsx`
- `lib/nav.ts`
- `App.tsx` (nav wiring only — capture region belongs to A, sort region to C; do not edit those)
- `index.css` (append `.nav-*` Phase-3 selectors + `balanced`/`airy` density token values)

## Shared contracts (authoritative)

- **NAV order/kbd:** Today=1 Board=2 Braindump=3 Notes=4 Advisor=5 Hermes/agent=6 Artifacts=7 Roadmap=8 Activity=9 Completed=0 (`0`→index 9). Number shortcuts `1`–`9` map indices 0–8.
- **NAV_GROUPS:** Workspace[today,board,braindump,notes] · Assistants[advisor,agent] · Library[artifacts,roadmap,activity,completed].
- Flat `NAV`/`NAV_BY_ID` remains the source of truth for shortcuts/counts; `NAV_GROUPS` only drives render order/labels (keep both in sync).
- Density: labels Compact/Cozy/Spacious set `[data-density]` to `compact`/`balanced`/`airy`. `cozy`/`spacious` are **retired** in favour of `balanced`/`airy`. Cozy (`balanced`) is default. Add `balanced` + `airy` density token values to CSS (currently only `compact`/`cozy`/`spacious` exist).
- Count keys: today, board, agent, artifacts, notes, completed, advisor(=#client-suggestions). Items without a count show their kbd hint.

## Acceptance Criteria

- [ ] Nav renders 3 labelled groups (Workspace / Assistants / Library) per NAV_GROUPS; flat NAV stays source of truth.
- [ ] Number shortcuts `1`–`9` → indices 0–8, `0` → index 9 (Completed).
- [ ] Per-item count badges shown when defined; items without a count show their kbd hint.
- [ ] Footer (`.nav-foot`): New task primary button (`focusCapture('task')` — call the entry from Phase A), Search button (opens palette, `⌘K` right-aligned), density switch, ACR+Brain status dots with tooltips.
- [ ] Density switch labels Compact/Cozy/Spacious set `[data-density]` to `compact`/`balanced`/`airy`; add `balanced` + `airy` density token values to CSS. Cozy (`balanced`) is default.
- [ ] Favourites group preserved, re-spaced per `.nav-pinned` styles.

## Tests

- [ ] Unit: NAV_GROUPS membership + index/kbd mapping (`0`→9), count-vs-kbd display rule — follow existing `lib/nav` / Nav test patterns.
- [ ] Run the FULL vitest suite before PR.

## Gate

- [ ] Root `npm run type-check` (`tsc -b`). No `any`; functions <50 lines; components <200 lines.

## Notes

- Do not regress existing favourites persistence or shortcut behaviour. `advisor` count = number of client-side suggestions (Phase D computes them; until D ships, a 0/absent count is acceptable — show kbd hint when undefined).
