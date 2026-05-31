# P5-07 — Mobile board: `TouchSensor` + responsive grid

**Type:** Feature
**Phase:** Phase 5 — Close the daily-use gaps + harden the gate
**Epic:** MCPAT-050 (Life OS — Phase 5)
**Task:** MCPAT-057
**Size:** S
**Depends on:** P5-01 (real gate). Builds on P4-03 (`@dnd-kit` board DnD).
**Owners:** ui-specialist (sensors + responsive grid)

> Read `docs/life-os/specs/00-epic-overview.md` first — §3 (tokens, spacing). Read **P4-03**
> (`P4-03-board-drag-and-drop.md`) — it built the `@dnd-kit` board with `PointerSensor` and the inline
> grid. Evidence: audit §D1, §F1 (`BoardView.tsx:121-128` PointerSensor-only;
> `index.css:297-306` + `BoardView.tsx:257,172` inline `gridTemplateColumns:'repeat(4,...)'`) — **do NOT
> re-investigate.** Note: the epic's §10 lists "mobile layout" as broadly out of scope, but Phase 5
> scopes a **targeted board-only** mobile pass (the board is the worst offender: DnD competes with scroll
> and the 4-col grid can't reflow).

---

## Why

The board is **desktop-only** in two ways (audit §D1, §F1):
1. **DnD uses `PointerSensor` only** (`BoardView.tsx:121-128`) — on phones, pointer-drag competes with
   scroll, so the board is unusable touch.
2. **The grid is an inline `gridTemplateColumns:'repeat(4,...)'`** (`BoardView.tsx:257,172`,
   `index.css:297-306`) — inline styles can't be overridden by media queries, so 4 columns never reflow
   on a narrow screen.

This spec adds a `TouchSensor` with a delay-activation constraint (so drag and scroll coexist) and
replaces the inline grid with a responsive Tailwind class so the board reflows on phones.

---

## Scope

**In scope**
- Add **`TouchSensor`** to the board's `@dnd-kit` sensors (`BoardView.tsx:121-128`) with a
  **delay activation constraint** (press-and-hold to drag; short touches scroll). Keep the existing
  `PointerSensor` for desktop. Coexist with P4-05's peek-on-click (activation constraint, like P4-03/B4).
- Replace the inline `gridTemplateColumns:'repeat(4,...)'` (`BoardView.tsx:257,172`,
  `index.css:297-306`) with a **responsive Tailwind grid class**
  (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`) so columns reflow by viewport.
- A **sub-768px consideration**: ensure the board is usable below 768px (single/two-column stack,
  readable rows, drag works by long-press). No full app-wide mobile layout — board surface only.

**Out of scope**
- App-wide mobile layout / nav reflow / panel behaviour on phones — epic §10 (desktop-first); only the
  **board** surface is in scope here.
- Adding `draft`/`approved` board columns (audit §D2 — deferred design decision).
- Changing the transition/DnD-drop logic (P4-03) — sensors + layout only.

---

## Data shapes / API contract

No API change. UI/interaction only.

`@dnd-kit` sensor config (shape — values at builder's discretion, tuned for touch vs scroll):

```ts
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), // existing — desktop + peek-on-click coexistence (P4-05/B4)
  useSensor(TouchSensor,   { activationConstraint: { delay: 200, tolerance: 8 } }), // NEW — long-press to drag, short touch scrolls
)
```

Grid: replace inline `style={{ gridTemplateColumns: 'repeat(4, …)' }}` with
`className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 …"` (Tailwind v3 breakpoints: `sm`=640px,
`lg`=1024px). Remove the now-dead inline grid rule in `index.css:297-306` if it only served the board.

---

## Acceptance Criteria

1. **TouchSensor added.** The board's `useSensors` includes a `TouchSensor` with a **delay** activation
   constraint, alongside the existing `PointerSensor` (`BoardView.tsx:121-128`). (Falsifiable: the sensor
   list includes `TouchSensor` with a `delay` constraint.)
2. **Touch drag vs scroll coexist.** A short touch on a card **scrolls** the board; a press-and-hold
   **initiates a drag** (the delay constraint disambiguates). (Falsifiable: RTL/interaction — a touch
   below the delay does not start a drag; a held touch does.)
3. **Peek-on-click still works.** A tap/click that does not exceed the activation constraint still opens
   the task peek (P4-05/B4 coexistence preserved). (Falsifiable: a click opens the panel; it does not
   accidentally start a drag.)
4. **Responsive grid.** The 4-column inline grid is replaced with `grid-cols-1 sm:grid-cols-2
   lg:grid-cols-4`; at narrow widths the board reflows to fewer columns. (Falsifiable: grep — no inline
   `gridTemplateColumns:'repeat(4` in `BoardView.tsx`; the responsive class is present; resizing the
   viewport changes the column count.)
5. **Sub-768px usable.** Below 768px the board renders a single- or two-column stack with readable rows
   and working long-press drag — not a clipped 4-column grid. (Falsifiable: at a 375px-wide viewport the
   board shows 1 column and rows are not overflowing.)
6. **Desktop unchanged.** At `lg`+ the board still shows 4 columns and desktop pointer-drag behaves as
   before (P4-03). (Falsifiable: at ≥1024px the board is the original 4-column layout.)
7. **Gates pass.** `npm run type-check` (`tsc -b` green) + `npm run build` succeed; `npm test` green.

---

## Build steps

1. **Add `TouchSensor` (`BoardView.tsx:121-128`).** Import `TouchSensor` from `@dnd-kit/core`; add it to
   `useSensors` with a `delay`+`tolerance` activation constraint. Keep `PointerSensor` with its existing
   constraint so peek-on-click (P4-05/B4) still works. **Test:** RTL/interaction — sensor list includes
   TouchSensor; a held touch starts a drag, a short touch does not.
2. **Responsive grid class (`BoardView.tsx:257,172`).** Replace the inline
   `gridTemplateColumns:'repeat(4,...)'` with `className="grid grid-cols-1 sm:grid-cols-2
   lg:grid-cols-4 …"`. Remove/clean the dead inline grid rule in `index.css:297-306` if board-only.
   Keep the column gap/spacing per tokens (§3). **Test:** grep — no inline `repeat(4` remains;
   the responsive class is present; column count changes across breakpoints.
3. **Sub-768px pass.** Verify the board (rows, drag, column stack) is usable at ~375px; adjust row/card
   spacing or column count breakpoints if it overflows. **Test:** visual/RTL at a narrow viewport — 1
   column, no horizontal overflow, long-press drag works.
4. **Run gates.** `npm run type-check` + `npm run build` + `npm test`.

---

## Test notes

- **Unit (UI, RTL):** sensor list includes `TouchSensor` with a delay constraint (AC1); peek-on-click
  still fires on a non-drag tap (AC3); the responsive grid class replaces the inline style (AC4).
- **Interaction/visual:** touch drag vs scroll disambiguation (AC2); sub-768px single-column reflow (ACs
  5, 6) — Playwright MCP for a mobile-viewport screenshot is acceptable as the falsifiable check.
- **Gate:** `npm run type-check` (`tsc -b`) + `npm test` before PR.

---

## Failure modes

- **No delay on TouchSensor.** A zero-delay touch sensor hijacks every touch as a drag, breaking scroll.
  The delay/tolerance constraint is what lets scroll and drag coexist.
- **Inline grid left in place.** Media queries / responsive classes cannot override an inline
  `style` grid (audit §F1) — the column count must move to a className.
- **Breaking peek-on-click.** If the pointer/touch activation constraints are too loose, taps start drags
  and the panel never opens (P4-05/B4 regression). Tune the constraints so a tap is a click.
- **Over-reaching into app-wide mobile.** Scope is board-only; don't reflow nav/panels (epic §10).

---

## Implementation note (deviation from the example config)

The §"Data shapes" example keeps `PointerSensor` alongside `TouchSensor`. **The implementation uses
`MouseSensor` + `TouchSensor` instead** (PointerSensor dropped). Reason: `PointerSensor` listens to
*pointer* events, which fire for touch too — so its `distance` activation would race the `TouchSensor`
`delay` and hijack scroll on phones (the exact bug this spec fixes). Splitting by modality —
`MouseSensor` (desktop, `distance: 8`, identical to the old PointerSensor behaviour for mouse) +
`TouchSensor` (touch, `delay: 200, tolerance: 8`) — gives each input its own activation path, so
tap-to-peek + long-press-drag coexist correctly. Desktop behaviour (AC6) is unchanged: `MouseSensor`
with `distance: 8` activates a mouse drag exactly as the prior `PointerSensor` did, and a plain click
still opens the peek.

## Open questions

1. **`sm` breakpoint column count.** `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` vs adding `md:grid-cols-3`.
   Default: the 1/2/4 ladder (simplest); add `md:3` only if 2→4 feels abrupt on tablets. Confirm visually.
2. **TouchSensor delay value.** 200ms long-press is a common default; too long feels laggy, too short
   hijacks scroll. Default: **200ms / 8px tolerance**; tune on a real device.
3. **`index.css:297-306` ownership.** Confirm the inline grid rule there is board-only before removing it
   (it may be shared). Default: remove only if board-scoped; otherwise leave and just stop applying it.
