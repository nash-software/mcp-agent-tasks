# P1-02 — App shell, navigation & global keyboard

**Type:** Feature
**Phase:** 1 (Reskin)
**Epic:** [Life OS — UI Reskin + Agent Layer (MCPAT-022)](./00-epic-overview.md)
**Size:** L

> Read [`00-epic-overview.md`](./00-epic-overview.md) first — §3 tokens, §4 data shapes, §5 client
> conventions, §9 anti-patterns apply here and are **not** repeated. This spec owns the **shell**:
> the layout grid, the left nav, the global keyboard layer, view routing, and focus mode. It does
> **not** own what renders inside `main` or the side columns — those are owned by P1-03..P1-10.

---

## Description (WHY)

The current `App.tsx` is a vertical flex column (`Header → FilterBar → main → detail panel → capture
overlay`) with `useState<TabId>` routing, no localStorage persistence, and only a single global key
handler (`Ctrl+Space`) buried in `useCaptureOverlay.ts`. The handoff target is a **three-column CSS
grid** with a spanning capture bar, a deliberately-dimmed left nav, a right ambient rail, and a
keyboard-first interaction model lifted from `reference/app.jsx` (§4–§5 of the handoff README).

The shell is the load-bearing dependency for the whole Phase-1 reskin: P1-03 (Today + J/K selection),
P1-04 (peek/detail panels), P1-05 (ambient rail), P1-06 (capture bar), and P1-10 (command palette)
all read **App-level client state** and receive **App-level handlers** as props. If the state model
and key dispatcher aren't pinned down here, every downstream spec re-invents them and they drift.

This spec therefore does two things: (1) restructures `App.tsx` into the grid + nav + focus-mode +
keyboard layer, and (2) **defines the canonical App-level client-state model** that downstream specs
consume. The slots for Today, panels, ambient, capture, and palette are rendered as placeholders /
existing components here; their internals land in their own specs.

---

## Acceptance Criteria

1. **Grid shell.** `App.tsx` renders a full-viewport (`100vh`, `overflow: hidden`) CSS grid with
   `grid-template-columns: 216px 1fr 296px`, `grid-template-rows: 52px 1fr`, and
   `grid-template-areas: "capture capture capture" "nav main ambient"`. All three columns set
   `min-width: 0`. `main` is the **only** scroll region (`overflow-y: auto; overflow-x: hidden;
   scrollbar-gutter: stable`); `main-inner` is `max-width: 860px; margin: 0 auto; padding: 24px`.
   No phantom horizontal scrollbar appears at any width (verify `overflow-x` is pinned `hidden`, not
   left to promote to `auto`).
2. **Left nav order, weight & shortcuts.** Nav items render in order **Today(1) · Board(2) ·
   Hermes(3) · Brain dump(4) · Artifacts(5) · Roadmap(6) · Activity(7)**, each showing its number-key
   shortcut (or open-count where available). Nav is visually dimmed (~30–40% weight: `muted`/`text-2`
   text on `bg`); the active item uses a `surface-2` background. Icons are `lucide-react` (no
   hand-rolled SVGs). A **Favourites** group placeholder sits below the nav (full behaviour is P2-02).
3. **Nav footer.** The nav footer shows ACR and Brain online status dots (`green` when online,
   `muted-2` when offline — graceful, never an error) plus a **"Search ⌘K"** button that opens the
   command palette (palette UI itself is P1-10; this button only flips `cmdkOpen`).
4. **Focus mode.** Pressing `.` (outside an input) toggles focus mode: nav and ambient columns
   collapse to width 0 via **transform + `pointer-events: none`** (NOT opacity→hidden — per epic
   anti-pattern §9, offscreen panels must never animate opacity to a hidden state), the grid resolves
   to `0 1fr 0`, and `main` gets full width. Toggling again restores the three columns. The transition
   uses `--ease-spring`, ≤220ms.
5. **View routing + persistence.** View is a single string state
   (`'today' | 'board' | 'hermes' | 'braindump' | 'artifacts' | 'roadmap' | 'activity'`), persisted to
   `localStorage('lifeos-view')` on change and restored on mount (with a guard: an unknown stored
   value falls back to `'today'`). Hermes (`3`) routes to a **placeholder panel** ("Hermes — coming
   in Phase 2") until P2-05 replaces it.
6. **Global keyboard layer.** A single `App`-level `keydown` listener implements the README §5 table:
   `Ctrl+Space` (focus capture — works while typing), `Cmd/Ctrl+K` (toggle palette), `1`–`7` (nav),
   `J`/`K`/`↑`/`↓` (Today selection), `Space` (peek), `Enter` (detail), `Esc` (close panel → exit
   focus), `D`/`P`/`T` (done / cycle priority / toggle-committed on selected), `.` (focus). While
   focus is in an `input`/`textarea`/`contentEditable`, all keys are ignored **except** `Esc` (blurs
   the field) and the always-global keys (`Ctrl+Space`, `Cmd/Ctrl+K`). When the palette is open, only
   palette keys pass (the rest are swallowed).
7. **App-level client-state model is exported/owned here.** `App` owns `view`, `selectedTaskId`,
   `panel` (`{ mode: 'peek' | 'detail'; taskId: string } | null`), `cmdkOpen`, and `focusMode`, and
   passes the relevant slices + handlers down to the Today slot, panel slot, ambient slot, capture
   slot, and palette slot. The shapes match epic §5 / handoff §9 exactly so P1-03..P1-10 can consume
   them without redefinition.
8. **Responsive.** ≥1200px renders the full 3-column grid. 768–1199px collapses the ambient column
   into a bottom drawer and renders the nav **icon-only with tooltips** (Tailwind breakpoints,
   desktop-first). <768px (phone) is out of scope per epic §10. `npm run type-check` and
   `npm run build` pass with no `any` and no new console errors.

---

## Technical Notes

### Files

| File | Action |
|---|---|
| `src/ui/src/App.tsx` | **Rewrite.** Grid shell, nav, focus mode, keyboard layer, state model, view routing. |
| `src/ui/src/components/Header.tsx` | **Remove from shell** (its tab bar is superseded by the nav; status counts move to nav footer / nav items). Delete or reduce to nothing rendered by `App`. Verify no other importer. |
| `src/ui/src/components/Nav.tsx` | **New.** Left-rail nav (items, Favourites placeholder, footer dots + Search button). |
| `src/ui/src/hooks/useGlobalKeyboard.ts` | **New.** Encapsulates the `keydown` dispatcher; takes the state setters + selected-task handlers, returns nothing (side-effect hook). |
| `src/ui/src/lib/nav.ts` | **New.** `NAV` constant (id, label, lucide icon, kbd) — single source of truth for order + shortcuts, consumed by `Nav` and the palette (P1-10). |
| `src/ui/src/types.ts` | **Extend.** Add `ViewId`, `PanelState` (`{ mode: 'peek' \| 'detail'; taskId: string }`) shared types. |
| `src/ui/src/main.tsx`, `queryClient.ts` | Unchanged by this spec (mutation/query tuning is per-view). |
| `package.json` | Add `lucide-react` dependency. |

Move the existing `Ctrl+Space` capture-focus handling **out** of `useCaptureOverlay.ts` and into the
unified `useGlobalKeyboard` dispatcher so there is exactly one global key listener. The capture
overlay still owns its own internal field keys (the `#project` autocomplete, `Shift+Enter` handoff)
— those are P1-06, not here.

### Layout grid CSS

The grid is the contract of this spec. Express it via a Tailwind arbitrary-value utility or a small
`index.css` `.app-shell` rule (P1-01 owns `index.css`; if adding a rule there, keep it shell-only):

```css
.app-shell {
  display: grid;
  height: 100vh;
  overflow: hidden;
  grid-template-columns: 216px 1fr 296px;   /* nav | main | ambient */
  grid-template-rows: 52px 1fr;             /* capture bar spans all cols */
  grid-template-areas:
    "capture capture capture"
    "nav     main    ambient";
  transition: grid-template-columns 200ms var(--ease-spring);
}
.app-shell > .capture { grid-area: capture; min-width: 0; }
.app-shell > .nav     { grid-area: nav;     min-width: 0; }
.app-shell > .main    { grid-area: main;    min-width: 0;
  overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; }
.app-shell > .ambient { grid-area: ambient; min-width: 0; }
.main-inner { max-width: 860px; margin: 0 auto; padding: 24px; }

/* focus mode — collapse side columns to zero width, transform not opacity */
.app-shell[data-focus="true"] { grid-template-columns: 0 1fr 0; }
.app-shell[data-focus="true"] > .nav,
.app-shell[data-focus="true"] > .ambient {
  transform: translateX(-8px);
  pointer-events: none;
  overflow: hidden;
}

/* tablet: 768–1199 — ambient becomes a bottom drawer, nav icon-only */
@media (max-width: 1199px) {
  .app-shell {
    grid-template-columns: 56px 1fr;
    grid-template-rows: 52px 1fr auto;
    grid-template-areas:
      "capture capture"
      "nav     main"
      "ambient ambient";
  }
}
```

Set `data-focus` on the shell root (mirrors the prototype's `data-focus` attribute on `.app`).

### Keyboard dispatch design

One `keydown` listener registered at `App` level inside `useGlobalKeyboard`, attached on
`window`. The dispatch order matters and follows the prototype (`app.jsx` lines 434–467) precisely:

1. **Always-global first:** `Ctrl+Space` → focus capture; `Cmd/Ctrl+K` → toggle `cmdkOpen`.
   These fire even while typing.
2. **Palette-open guard:** if `cmdkOpen`, return (palette owns its own keys).
3. **Typing guard:** if `document.activeElement` is `INPUT`/`TEXTAREA`/`contentEditable`, handle only
   `Esc` (blur) then return.
4. **View + global:** `1`–`7` → `setView(NAV[n-1].id); setPanel(null)`; `Esc` → close panel else exit
   focus; `.` → toggle focus.
5. **Today-only:** if `view !== 'today'` return; else `J/K/↑/↓` move `selectedTaskId` over the visible
   ordered id list (the **list itself is computed and owned by P1-03 / TodayView** — this spec only
   wires the keys to a `moveSelection(dir)` callback the Today slot provides, or to a shared
   `visibleIds` ref passed up). `Space`/`Enter` set `panel`; `D`/`P`/`T` invoke the selected-task
   handlers.

The hook receives a `deps` object so its closure is fresh:
`{ view, selectedTaskId, panel, focusMode, cmdkOpen, visibleIds, handlers }`. `useEffect` re-binds the
listener when these change (matching the prototype dep array). `handlers` is
`{ moveSelection, peek, detail, markDone, cyclePriority, toggleCommitted }` — the **implementations**
of `markDone`/`cyclePriority`/`toggleCommitted` are optimistic mutations defined in P1-03/P1-04; this
spec passes through whatever the Today/panel layer supplies and may stub them with `console.warn`
no-ops until those specs land (note the stub explicitly so reviewers know it's intentional).

### App-level state model (canonical — downstream specs depend on this)

```ts
type ViewId = 'today' | 'board' | 'hermes' | 'braindump' | 'artifacts' | 'roadmap' | 'activity';
interface PanelState { mode: 'peek' | 'detail'; taskId: string }

// in App():
const [view, setView]           = useState<ViewId>(() => readStoredView());      // lifeos-view
const [selectedTaskId, setSel]  = useState<string | null>(null);
const [panel, setPanel]         = useState<PanelState | null>(null);
const [cmdkOpen, setCmdkOpen]   = useState(false);
const [focusMode, setFocusMode] = useState(false);

useEffect(() => { localStorage.setItem('lifeos-view', view); }, [view]);
```

- `selectedTaskId` and `panel.taskId` are kept loosely in sync by the keyboard layer (J/K updates
  `panel.taskId` only **if** a panel is already open — matching prototype lines 457–458). Selection is
  a string id, not a Task object, so it survives query refetch/reorder.
- `setView` always clears `panel` (`setPanel(null)`) so a stale panel doesn't bleed across views.
- The capture focus function is held in a `useRef<() => void>` registered by the capture slot
  (`registerFocus` pattern from prototype line 75 / 507) — App does not reach into the capture
  component's internals.
- `filter`, `favorites`, `target` and the agent state from the prototype are **deliberately not
  introduced here** — they belong to P2-01 / P2-02 / P1-03. Only the five shell-state atoms above are
  owned by this spec.

### Wiring slots (placeholders this spec renders)

- `capture` area → existing `CaptureOverlay`/capture bar slot (real bar is P1-06; render the current
  component or a stub bar so the row isn't empty).
- `main` area → switch on `view`, rendering existing views where present (`BoardView`, `BrainDumpView`,
  `ArtifactsView`, `RoadmapView`, `ActivityView`, `TodayView`) and a placeholder for `hermes`.
- `ambient` area → existing `LiveFeedSection`/ambient slot (real rail is P1-05; stub acceptable).
- panel slot → existing `TaskDetailPanel` driven by `panel`/`selectedTaskId` (real peek/detail is P1-04).
- palette → no UI yet (P1-10); `cmdkOpen` just gates the keyboard layer.

---

## Failure Modes

- **Phantom horizontal scrollbar.** Setting only `overflow-y: auto` on `main` promotes `overflow-x`
  to `auto`. Pin `overflow-x: hidden` explicitly (AC-1). Likewise a child that ignores `min-width: 0`
  will widen the grid — every column must set `min-width: 0`.
- **Opacity-collapse blanks panels.** If focus mode (or tablet drawer) animates `opacity` to a hidden
  state instead of transform/width, offscreen content freezes at frame 0 and renders blank when
  restored (epic §9). Use transform + `pointer-events`/`width`, never `opacity → 0` for hide.
- **Stale keyboard closure.** A `useEffect` with `[]` deps captures the first render's `view`/
  `selectedTaskId` and keys stop tracking state. Re-bind the listener on the full dep array (prototype
  line 467).
- **Double key handling.** Leaving the old `Ctrl+Space` handler in `useCaptureOverlay.ts` while adding
  the new dispatcher fires capture focus twice. Remove the old one (single listener invariant).
- **`Cmd+K` browser conflict / IME.** `preventDefault()` on the palette toggle; guard `1`–`7` with
  `!e.metaKey && !e.ctrlKey` so `Cmd+1` (browser tab switch) isn't hijacked.
- **Unknown persisted view.** A `lifeos-view` value left by a prior build (e.g. `inbox`) must not
  render a missing view — guard against the `ViewId` union and fall back to `today`.
- **Selected id points at a refetched/removed task.** Selection is an id; resolve to a Task at render
  and no-op handlers if the task is gone, rather than holding a stale object.

---

## Out of Scope

- **Individual view internals** — Today hero/capacity/rows/candidate ordering (P1-03), peek & detail
  panel content (P1-04), ambient rail sections (P1-05), capture bar behaviour incl. `#project` AC and
  `Shift+Enter` handoff (P1-06), Brain Dump (P1-07), Artifacts (P1-08), Board/Roadmap/Activity reskin
  (P1-09).
- **Command-palette UI, fuzzy search, and command list** — P1-10. This spec only wires `cmdkOpen` and
  the toggle key.
- **J/K selection *rendering*** (highlighted-row styling, scroll-into-view, the `visibleIds`
  computation) — P1-03. This spec only dispatches the keys to a callback/ref the Today layer owns.
- **Optimistic mutation implementations** (`markDone`, `cyclePriority`, `toggleCommitted`, `schedule`)
  — owned by P1-03/P1-04; passed through as handlers here.
- **Filter, favourites (real behaviour), accent/density settings, Hermes view** — Phase 2 / P1-01.
- **Design tokens, Geist font, `tailwind.config.js`/`index.css` base layer** — P1-01.
- **Phone/<768px layout** — epic §10.

---

## Dependencies

- **P1-01** (Design-system foundation) — tokens (`bg`, `surface-1/2/3`, `muted`, `--ease-spring`,
  `--accent`), Geist font, and the `index.css` base layer must exist; the shell styles reference them.
- `lucide-react` added to `package.json`.

---

## Testing

- **Type/build gate:** `npm run type-check` (strict, no `any`) and `npm run build` pass.
- **Grid render:** shell mounts with the three regions in DOM order capture → nav → main → ambient;
  `main` is the only scroll container (assert computed `overflow-y: auto`, `overflow-x: hidden`).
- **No horizontal scroll:** with a very long task title in `main`, `document.documentElement.scrollWidth
  === clientWidth` (no overflow). Visual check at 1280/1024/800px.
- **Keyboard unit tests** (React Testing Library + `fireEvent.keyDown` on `window`):
  - `1`–`7` switch `view` and clear `panel`.
  - `.` toggles `data-focus` on the shell root.
  - `Cmd/Ctrl+K` toggles `cmdkOpen`; `Ctrl+Space` calls the registered capture-focus fn even when an
    input is focused.
  - Typing in an `<input>`: letter keys do **not** trigger nav/actions; `Esc` blurs.
  - `Esc` closes an open panel before exiting focus mode.
  - `J`/`K` invoke `moveSelection`; `Space`/`Enter` set `panel.mode` to `peek`/`detail` (with a stub
    visibleIds list).
- **Persistence:** set `view`, reload (re-mount) → restored; a bogus `lifeos-view` falls back to
  `today`.
- **Responsive:** at 1000px the ambient region is the bottom drawer and nav is icon-only (snapshot or
  computed-grid assertion); at 1280px the full 3-col grid is present.
- **Manual:** ACR/Brain offline → footer dots render `muted-2`, no error thrown.

---

## Open Questions

- **InboxView fate — RESOLVED (decision).** Drop `InboxView` from the shell; it is **not** in the
  target nav (epic §2 / §11). Its draft-promote queue overlaps the Brain Dump / GEN-inbox candidate
  flow (P1-07), which is the canonical "review captured items before they become tasks" surface.
  **Recommendation: fold draft-review into Brain Dump / GEN inbox** rather than keep a hidden route —
  a hidden, unreachable route is dead weight that drifts and confuses the next reader. Concretely:
  remove the `inbox` `TabId`, stop rendering `InboxView` in `App`, and file a follow-up note for P1-07
  to absorb any draft-promote affordance the GEN inbox doesn't already cover. If P1-07 finds a
  draft-review need it can't serve, re-open as its own nav item then — but do not ship a hidden tab.
  *(Rationale: matches the prototype's 7-view nav exactly; avoids an 8th orphaned route; keeps "review
  before commit" in one place.)*
- **Router vs view-string state — RESOLVED (decision).** **Keep simple `view`-string state +
  `localStorage('lifeos-view')`** — no router library. Rationale: the prototype is a single-window,
  single-user localhost dashboard with seven flat views and no deep-linking, route params, or back/
  forward requirements; a router (react-router) adds a dependency, a provider, and URL-sync ceremony
  for zero benefit and would diverge from the reference behaviour. Persisting the last view to
  localStorage already satisfies the one stated requirement ("a new tab restores it", README §4). If a
  future need for shareable URLs or browser-history navigation appears, revisit then.
- **`visibleIds` ownership (defer to P1-03).** This spec wires keys to a `moveSelection`/`visibleIds`
  contract but does not compute the ordered list. P1-03 must decide whether to lift `visibleIds` to a
  ref read by the keyboard hook or expose a `moveSelection(dir)` callback. Recommendation: expose
  `moveSelection(dir)` from TodayView so the ordering logic stays with the view that renders it.
