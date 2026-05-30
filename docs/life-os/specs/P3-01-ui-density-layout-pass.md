# P3-01 — UI polish pass: card readability, content width & a real density switcher

**Type:** Chore (UI refinement) · **Epic:** MCPAT-022 (Life OS) · **Size:** M–L
**Surfaces:** all views; primary fixes in Board + the shell width system + a new density control.

> A "once-over" pass after Phase 1/2 shipped. Driven by a visual QA of the live build
> (`agent-tasks serve-ui`) against the handoff mockups in `design_handoff_life_os/screenshots/`.
> Screenshots captured: `scratchpads/.ui-qa/today-current.png`, `board-current.png`.

---

## Visual QA findings (current build vs mockup)

| # | Finding | Evidence | Mockup expectation |
|---|---|---|---|
| **A** | **Board is unreadable.** Cards are thin 40px single-line rows with titles truncated to ~6 chars ("Phase…", "Fix…", "Mo…"). 4 columns are crammed into the 860px `.main-inner` cap, leaving dead space on the right. | `board-current.png`; `BoardView.tsx:72` renders the shared single-line `TaskCard`; `.main-inner { max-width:860px }` (`index.css:61`) wraps it. | `03-board.png` — multi-line **cards**: prefix badge + priority header, title wrapping 2–3 lines (not truncated), footer with area dot / estimate / "today" badge. Columns span the full main width. |
| **B** | **Excess margin / double width-constraint.** Content is squeezed: the shell caps `.main-inner` at 860px **and** `TodayView` re-wraps in `max-w-3xl` (768px). Board inherits the 860px cap so its kanban can't breathe. | `index.css:61`; `TodayView.tsx:185,208`; `App.tsx:447` (`.main-inner` wraps every view). | Mockup Today reads in a comfortable column; mockup Board uses the **full** main width. Width should be **per-view**, not one blanket cap. |
| **C** | **Density is dead.** `[data-density]` sets `--row-h` (34/40/46) but nothing consumes it — `TaskCard` hardcodes `height:40` (`TaskCard.tsx:83`) and `TodayView` hardcodes `height:40` (`TodayView.tsx:238`). There is **no UI** to switch density and no `lifeos-density` persistence. | grep: only definitions of `--row-h`, never `var(--row-h)`; `height: 40` hardcoded in 2 places. | A working compact / cozy / spacious switcher affecting **all pages** (user request). |
| **D** | **Wasted vertical space.** The empty in-progress hero is a ~190px dashed box; section gaps (`space-y-5`) and the capacity/empty-committed blocks are loose, "compacting" the useful content. | `today-current.png`; `TodayView.tsx` hero empty-state + `space-y-5`. | Tighter, density-aware spacing; a compact empty-hero. |
| **E** | **Row readability.** On wide rows the `flex-1` title pushes the meta cluster far right, opening a large title→meta gulf; the `…` menu is `opacity-0` until hover. | `TaskCard.tsx` (`flex-1` title, no max; `…` hover-only). | Meta sits nearer the title; done rows dim; actions discoverable. |

---

## Domain / approach

Introduce **two orthogonal layout primitives** and consume them everywhere:

1. **A density scale** on the shell root (`[data-density]` on `.app-shell`) exposing a set of CSS
   custom properties that *every* row/card/section reads. One switch, global effect.
2. **A per-view content-width mode** (`column` vs `full`) so reading views get a comfortable column
   and the Board (kanban) gets the full width.

Plus a dedicated **Board card** component (the single biggest readability win).

---

## Acceptance criteria

### Board cards (priority — fixes the unreadable kanban)
1. **`components/BoardCard.tsx`** (new) renders a multi-line card per `03-board.png`:
   header row = `PrefixBadge` (left) + priority tag (right, only critical/high); **title wraps to
   up to 3 lines, never truncated to a few chars** (`line-clamp-3`, not `truncate`); footer row =
   status/area dot · estimate · `today` badge when `scheduled_for===today` · agent badge (robot)
   when `agent_status` set. `bg-surface-1`, 1px `surface-3` border, `rounded-card`, padding from the
   density var. Click → detail panel (existing `onOpenPanel`).
2. `BoardView` renders `BoardCard` (not the 40px `TaskCard`) in its 4 columns; column count/grid
   unchanged (`repeat(4, minmax(0,1fr))`).
3. With the Board at `full` width, each column is wide enough that representative real titles
   (≥40 chars) render on ≤3 lines without mid-word truncation. Verified against the live data.

### Content width (margins)
4. `.main-inner` no longer hard-caps every view at 860px. The shell applies a width mode per view:
   **column** (Today, Brain Dump, Artifacts, Roadmap, Activity, Hermes) keeps a readable centred
   column (≈ `780–860px`, density-independent); **full** (Board) uses the full main width with only
   the page padding. Implement via a data attribute / class the shell sets from the active view
   (e.g. `.main-inner[data-width="full"] { max-width:none }`).
5. The redundant `max-w-3xl` wrapper in `TodayView` is removed — the shell owns content width
   (no double constraint). Other views audited for the same redundancy.

### Density switcher (global, all pages)
6. A **density control** (segmented `Compact · Cozy · Spacious`) lives in the left-nav footer (near
   the ACR/Brain dots / Search) — small, low-weight. Selecting one sets `data-density` on
   `.app-shell` and persists to `localStorage('lifeos-density')`; **Cozy** is the default; an unknown
   stored value falls back to Cozy. It is also exposed as command-palette actions
   ("Density: Compact/Cozy/Spacious").
7. The density attribute drives a set of consumed CSS vars (define in `index.css`, read everywhere):
   `--row-h` (34/40/46), `--row-px` (row horizontal padding), `--card-pad` (card padding),
   `--section-gap` (vertical gap between sections), `--font-row` (row title size, e.g. 13/14/15px).
8. **Remove the hardcoded `height:40`** in `TaskCard.tsx` and `TodayView.tsx`; rows use
   `height: var(--row-h)`. `TaskCard`/`BoardCard` padding, the Today section gaps, and row font-size
   read the density vars. Switching density visibly re-flows **every** view (Today rows, Board cards,
   Brain Dump, Artifacts list, Roadmap, Activity, Hermes), not just one.

### Spacing & row polish
9. The empty in-progress hero collapses to a compact one-line state (no ~190px dashed block);
   populated hero unchanged.
10. Row readability: cap the title's growth so the meta cluster sits adjacent (not flung to the far
    right) — e.g. title `max-width` + a modest gap rather than `flex-1` filling the whole row; done
    rows keep the dimmed treatment; the `…` actions menu is reachable (visible on row hover/focus,
    and on touch).

### View chrome & filter — match the mockups ("the little things")
11. **Consistent view header on every view**, matching the screenshots — currently `TodayView` (and
    most views) render no header while `HermesView` has its own; unify them. Add a small shared
    `ViewHeader` (title 19px/600 `-0.02em` tracking, optional subtitle in `ink-2`, optional
    right-aligned meta) used by all views:
    - Today → `Today` + weekday (e.g. "Friday") · right: date (mono, `2026-05-29`) + the focus-mode
      toggle icon — per `01-today.png`.
    - Board → `Board` + "All tasks across every project" (`03-board.png`).
    - Hermes → keep its existing title/subtitle, routed through `ViewHeader` for consistency.
    - Brain dump / Artifacts / Roadmap / Activity → title + the subtitle/meta shown in `04`–`07.png`
      (e.g. Artifacts "last 30 days · N files · M unvisited").
12. **FilterBar visual match** to `01-today.png`: favourite quick-chips are rounded pills (★ + mono
    prefix + count), the **Filter** button is an outlined `surface-1` pill with the filter glyph,
    active-filter chips are removable, all on a hairline-bottomed bar. Match chip height/padding/
    radius, the star colour (`area-client` amber), and the muted count styling to the mockup.
13. **General fidelity sweep** against `screenshots/01`–`07.png`: section labels (11px/600, muted,
    uppercase, `0.07em` tracking), hairline dividers, status/area chips, badge styling, the
    "commit to today" affordance, and inter-section spacing should read like the mockups. Where a
    secondary element visibly diverges (chip shape, label weight, spacing, divider), bring it into
    line. Polish sweep, not a redesign — no new components beyond `ViewHeader` / `BoardCard`.

---

## Technical notes
- Density vars belong on `.app-shell[data-density="…"]` in `index.css` (alongside the existing
  `--row-h` block at lines 8–37). Keep the existing token names; add the new ones.
- The width mode is cleanest as a small map in `App.tsx` (`FULL_WIDTH_VIEWS = new Set(['board'])`)
  → set `data-width` on the `.main-inner` element.
- `BoardCard` should reuse `atoms.tsx` (`PrefixBadge`, `StatusDot`, `AreaDot`) and `lib/format`
  (`fmtEst`) — do not duplicate. Consider a shared `<TodayBadge/agent badge>` helper if not present.
- Keep all motion transform-only (epic §9); no opacity-to-hidden.
- Do **not** restructure the 3-column app shell, nav, panels, or any data/query layer — this is a
  styling/layout pass only.

## Failure modes
- `line-clamp` needs the Tailwind line-clamp utility (built into Tailwind ≥3.3) — verify it's
  available; if not, add the `-webkit-line-clamp` CSS directly.
- Stored `lifeos-density` from a future/garbage value → guarded fallback to Cozy.

## Out of scope
- Drag-and-drop on the Board, WIP limits, new columns.
- Any new data, endpoints, or view behaviour. No changes to Hermes logic, triage, filters, or the
  sign-off gate — visual only.
- A full settings panel (accent/font theming) — only the density control ships here.

## Verification (must include a visual check)
- `npm run type-check` (gate) + `npm run build` clean; full `vitest` suite green.
- Re-capture `today` and `board` at 1440×900 via `agent-tasks serve-ui` and confirm against
  `screenshots/01-today.png` / `03-board.png`: Board titles readable (≤3 lines, no micro-truncation),
  columns full-width; Today column comfortable; density switch re-flows all views.

## Decisions (confirmed)
- **Hermes width = `column`.** Only Board is `full`; every other view uses the readable centred column.
- **Density default = Cozy (40px).** Compact (34) and Spacious (46) are the other two stops.
- **Fix the "natural" margins.** The readable column must look intentional, not cramped: centred,
  comfortable gutter, page padding from the density `--page-pad` — not the current double-constraint
  (860px shell cap **and** a 768px `max-w-3xl`). Pick one comfortable column width (≈800–860px),
  centre it, and let the side gutters breathe; Board fills the full main width with only `--page-pad`.
