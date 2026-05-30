# P4-05 — UI bug batch (B1–B5)

**Type:** Bug
**Phase:** Phase 4 — Make the read-only UI usable
**Epic:** MCPAT-041 (Life OS — Phase 4: Usability)
**Task:** MCPAT-046
**Size:** M
**Depends on:** none (independent of P4-01). B4 coordinates with P4-03's drag-vs-click constraint.
**Owners:** ui-specialist

> Read `docs/life-os/specs/00-epic-overview.md` first — §3 (tokens). Root causes + fix points for all five
> bugs are **already diagnosed** in the audit (`docs/life-os/audit/2026-05-30-functional-audit.md` §B) —
> **do NOT re-investigate.** This spec turns those diagnoses into fixes with falsifiable ACs. Each bug is a
> cheap, localized fix; they batch into one PR.

---

## Why

Five discrete UI bugs make the dashboard feel broken (audit §B). All have known root causes and fix points.
Batching them keeps the PR focused on cosmetics/interaction polish, separate from the mutation work (P4-01)
and lifecycle work (P4-02).

---

## Scope

**In scope** — exactly the five audited bugs:

| # | Bug | Root cause (audit §B) | Fix |
|---|-----|----------------------|-----|
| **B1** | Mac `⌘` shown on Windows | Hardcoded `⌘` literal, no platform detection | `MOD = isMac ? '⌘' : 'Ctrl'` helper, used at `Nav.tsx:191`, `BrainDumpView.tsx:360,398` |
| **B2** | Today margins ignore density; focus mode doesn't fill | `'today'` not in `FULL_WIDTH_VIEWS` (only `'board'`) → `.main-inner` keeps `max-width:840px`; density only sets `--page-pad`; focus mode only collapses side columns | Drive `.main-inner` width from focus mode: `App.tsx:42`, `index.css:81-85` (`data-width="full"` when focusMode) |
| **B3** | 3-dots menu renders behind content + no click-away | menu is `absolute z-50` inside clipping `overflow` ancestor + per-row stacking contexts; `menuOpen` is toggle-only, no document/Esc listener | Portal the menu out of the clipping ancestor + add outside-click/Esc dismiss: `TaskCard.tsx:164,72-79,162` |
| **B4** | Clicking a committed item doesn't open peek | Row `onClick` → `onSelectTask` (selection only), not `onOpenDetail`/`setPanel` | Make row click open the peek/detail panel: `TodayView.tsx:280` |
| **B5** | Rows merge / status-history font tiny | Committed list `<div className="group">` has no `space-y`/`divide`; status history `space-y-2`/`text-xs` | Add row separation + bump font: `TodayView.tsx:273`, `TaskPanel.tsx:298-300` |

**Out of scope**
- Any mutation/transition logic — **P4-01**.
- The Done-column action / DnD — **P4-02/P4-03**.
- Re-diagnosing root causes — the audit §B fix points are authoritative; just apply them.

---

## Data shapes / API contract

None — this is pure front-end (rendering, event handling, CSS). No endpoints touched.

---

## Acceptance Criteria

1. **B1 — platform-correct modifier key.** On Windows the command-palette / shortcut hints render `Ctrl`
   (not `⌘`); on macOS they render `⌘`. A single `isMac`-based `MOD` helper drives `Nav.tsx:191` and
   `BrainDumpView.tsx:360,398` — no remaining hardcoded `⌘` literal in those spots. (Falsifiable: with
   `navigator.platform`/`userAgent` mocked non-Mac, the rendered hint reads `Ctrl`.)
2. **B2 — Today respects density + focus mode fills width.** In focus mode, the Today view's `.main-inner`
   uses full width (no `max-width:840px` cap) — `'today'` participates in the full-width path the way
   `'board'` does, driven by focus mode (`data-width="full"`). Density changes affect Today's effective
   width/padding. (Falsifiable: toggling focus mode on Today removes the 840px cap; the content widens.)
3. **B3 — menu renders above content + dismisses.** The 3-dots menu is portalled so it is **not** clipped
   by the `overflow` ancestor (renders above sibling rows/content). Clicking outside it or pressing `Esc`
   closes it. (Falsifiable: open the menu, click elsewhere → menu closes; press Esc → menu closes; the menu
   is visually above adjacent rows.)
4. **B4 — row click opens peek.** Clicking a committed task row in `TodayView` opens the detail/peek panel
   (`setPanel`/`onOpenDetail`), not merely selecting the row. (Falsifiable: clicking a committed row opens
   the panel showing that task's Why/links/git/tags — which surfaces the content noted in audit §B's
   "no linked docs" note.)
5. **B5 — rows separated + readable status history.** The committed list has visible row separation
   (`space-y`/`divide`, matching the candidate list's `space-y-3`) so rows no longer merge; the status
   history in `TaskPanel` uses a larger-than-`text-xs` font with adequate spacing. (Falsifiable: committed
   rows have non-zero vertical gap; status-history text is no longer `text-xs`.)
6. **No regressions.** Tokens §3 respected (no opacity-to-hidden panel animation, no new gradients/shadows);
   existing keyboard nav (`J/K`, Enter) still works after B4's click change.
7. **Gates pass.** `npm run type-check` (strict, no `any`) and `npm run build` succeed.

---

## Build steps

1. **B1 — `MOD` helper.** Add a small `lib/platform.ts` `isMac` + `MOD` (`'⌘'`/`'Ctrl'`) helper; replace
   the hardcoded `⌘` at `Nav.tsx:191` and `BrainDumpView.tsx:360,398`. **Test:** unit — `MOD` is `'Ctrl'`
   when `isMac` is false, `'⌘'` when true.
2. **B2 — Today full-width in focus mode.** Add `'today'` to the full-width path (`App.tsx:42`
   `FULL_WIDTH_VIEWS` or a focus-driven `data-width="full"`), and update `index.css:81-85` so `.main-inner`
   drops the `max-width` cap when focus mode / full-width is active. **Test:** RTL — with focus mode on,
   Today's container has the full-width attribute/class (no 840px cap).
3. **B3 — portal + dismiss the menu.** Render the `TaskCard` 3-dots menu via a portal (out of the clipping
   `overflow` ancestor); add a `useEffect` document `click`/`keydown(Esc)` listener that closes it
   (`TaskCard.tsx:72-79,162,164`). **Test:** RTL — outside click closes the menu; Esc closes it; menu is
   portalled (not nested in the clipped row container).
4. **B4 — row click opens peek.** Change the `TodayView` committed-row `onClick` (`:280`) to call the
   panel-open handler (`onOpenDetail`/`setPanel`, per `App.tsx:495-496`) instead of selection-only.
   Coordinate with P4-03's drag activation constraint so a plain click still opens the panel. **Test:**
   RTL — clicking a committed row invokes the open-detail handler with the task.
5. **B5 — row separation + history font.** Add `space-y`/`divide` to the committed list container
   (`TodayView.tsx:273`, match candidate list `space-y-3`); bump the status-history font above `text-xs`
   and adjust spacing (`TaskPanel.tsx:298-300`). **Test:** RTL/snapshot — committed list has the spacing
   class; status-history text class is not `text-xs`.

---

## Test notes

- **Unit (UI, RTL):** one focused test per bug (B1 helper, B2 width attribute, B3 portal+dismiss, B4
  click→open, B5 spacing/font classes). Mock platform for B1.
- **No server tests** — front-end only.
- **Gate:** `npm run type-check` + `npm test` green before PR.

---

## Failure modes

- **B3 portal + event listener leak.** The outside-click/Esc `useEffect` must clean up its listeners on
  unmount/close (overview anti-patterns — missing cleanup). A portalled menu that never removes its
  document listener leaks.
- **B4 vs P4-03 drag.** If P4-03 ships drag on the same rows, the click handler must coexist with the drag
  activation constraint (a plain click opens the panel; a drag moves the card). Coordinate.
- **B2 width regression on other views.** Only `today` (+ existing `board`) should be full-width in focus
  mode — verify non-full-width views keep their cap.

---

## Open questions

None — all five fixes are fully specified by audit §B. (If B4's click change conflicts with P4-03's drag,
resolve via dnd-kit's `activationConstraint` as noted in P4-03.)
