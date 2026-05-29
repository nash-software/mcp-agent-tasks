# P1-10 — Command Palette (`Cmd+K`)

**Type:** Feature
**Phase:** 1 (Reskin)
**Epic:** MCPAT-022 — Life OS UI Reskin
**Size:** M

> Shared tokens, data shapes, and client conventions live in
> [`00-epic-overview.md`](./00-epic-overview.md). This spec references §3 (motion / `--ease-spring`),
> §4 (Task / Artifact shapes), and §5 (query keys, `cmdkOpen` / `selectedTaskId` client state) — it
> does not repeat them. Handoff §6.8 is the visual reference.

---

## Description

There is currently **no command palette** and **no `Cmd+K` handler** anywhere in `src/ui/src/`
(verified — epic §2 lists it MISSING). This spec adds a **Raycast-style, keyboard-first command
palette** so the user can do anything — act on the focused task, create, navigate, jump to a task or
artifact — without leaving the keyboard or hunting through chrome.

**Why a palette (the WHY):** the Life OS shell is deliberately quiet (nav is ~30–40% visual weight,
§9), which trades discoverability for calm. The palette is the escape hatch that keeps the surface
calm *and* fast: one shortcut surfaces every action and every task/artifact by name, fuzzy-ranked, so
power use never requires reaching for a mouse or memorising where a button lives. It is the single
fast index over the whole app.

This adds two new files: `components/CommandPalette.tsx` (the overlay) and `lib/fuzzy.ts` (the
scoring + highlight primitives). `lib/fuzzy.ts` is **shared infrastructure** — Brain search and the
P2-01 filter actions reuse the exact same `fuzzy()` / `highlight()` functions, so it is ported as a
standalone, framework-light module rather than inlined into the palette.

`Cmd+K` (and `Ctrl+K` on Windows/Linux) is owned by the **App keyboard layer (P1-02)** — that layer
toggles the App-level `cmdkOpen` state; this component is a controlled overlay that renders when
`cmdkOpen` is true and calls `onClose` to clear it.

---

## Acceptance Criteria

1. **`Cmd/Ctrl+K` toggles a centered overlay.** When `cmdkOpen` is true, a scrim (`rgba(0,0,0,0.55)`,
   `position: fixed; inset: 0`) renders with the palette card centered horizontally and **`14vh` from
   the top**, **600px** wide (max `92vw`), `surface-1` background, 12px radius, with a spring-in
   transform (`translateY(-8px) scale(0.99)` → rest, ~180ms on `--ease-spring`). The search input
   auto-focuses on open. Clicking the scrim, or `Esc`, closes it (calls `onClose`).
2. **Never opens empty.** With an empty query the palette shows the full contextual command list
   (recent/contextual commands) — it is **never** blank on open (epic anti-pattern §9: "❌ Empty
   command palette on open"). The empty-*results* state (a non-empty query that matches nothing) shows
   only the "No commands match …" message — that is distinct from open-empty.
3. **Categories render in this exact order, grouped with labels:** **Selected task** (only when a task
   is focused) → **Create** → **Navigate** → **Filter** → **Tasks** → **Artifacts**. Group order is
   preserved as the source command order even after fuzzy re-ranking is applied within the flat list
   (ranking reorders rows; grouping re-buckets them under their category label in first-seen order).
4. **Selected-task actions appear only when a task is focused.** When `selectedTaskId` resolves to a
   task, the **Selected task** group lists: **Mark done**, **Commit to today / Remove from today**
   (label reflects `scheduled_for`), **Sign off to Hermes** (disabled stub in Phase 1), **Dispatch to
   ACR** (disabled stub in Phase 1), **Open detail**. When no task is focused the group is **absent
   entirely** (no empty header).
5. **Fuzzy match with word-start bonus; matched chars highlighted in accent.** Typing filters the
   command list via subsequence fuzzy scoring (algorithm below); non-matching commands drop, matches
   sort by descending score. Matched characters in each row's label render wrapped in `<mark>` styled
   `color: var(--accent); font-weight: 600; background: transparent` — i.e. **highlighted in the
   accent colour**, not a highlight block.
6. **Keyboard navigation: `↑`/`↓` move, `Enter` runs, `Esc` closes.** `↓`/`↑` move the selection
   (clamped to `[0, items.length-1]`), `Enter` runs the selected command's `run()` then closes,
   `Esc` closes without running. Mouse hover also sets the selection; click runs + closes. Selection
   resets to index 0 whenever the query changes. The footer shows `↑ ↓ navigate · ↵ run`.
7. **Commands wire to real data and reuse existing mutations.** Tasks come from the `['tasks']` query
   cache, artifacts from `['artifacts']`, navigation targets are the static view list, and the
   selected-task **Mark done** / **Commit** actions invoke the **same optimistic mutations** defined
   in P1-03/P1-04 (no palette-local mutation logic). Running a command never desyncs the cache.

---

## Technical Notes

### Target files (real paths)
- `C:\code\mcp-agent-tasks\src\ui\src\components\CommandPalette.tsx` — the overlay component.
- `C:\code\mcp-agent-tasks\src\ui\src\lib\fuzzy.ts` — `fuzzy()` + `highlight()` (new shared module).

### `lib/fuzzy.ts` — exact algorithm (ported verbatim from `reference/shared.jsx`)

Port these two functions **exactly**; this is the canonical scoring used by the palette, Brain search,
and P2-01 filter actions, so it must not drift.

```ts
export interface FuzzyMatch { score: number; ranges: number[]; }

// subsequence match: +1 per matched char, +1.5*streak consecutive bonus,
// +4 word-start bonus (index 0 or preceding char is a space). null = no match.
export function fuzzy(query: string, text: string): FuzzyMatch | null {
  if (!query) return { score: 0, ranges: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0, ti = 0, score = 0, streak = 0;
  const ranges: number[] = [];
  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      ranges.push(ti);
      streak++; score += 1 + streak * 1.5;
      if (ti === 0 || t[ti - 1] === ' ') score += 4;
      qi++;
    } else {
      streak = 0;
    }
    ti++;
  }
  return qi === q.length ? { score, ranges } : null;
}
```

- **Scoring contract (must be preserved exactly):** base **+1 per matched char**; **+1.5 × streak**
  consecutive-run bonus (streak increments on each consecutive match, resets to 0 on a miss);
  **+4 word-start bonus** when the match index is `0` or the preceding char is a space.
- **Return:** `{ score, ranges }` where `ranges` are the matched char indices into `text`, or `null`
  when the query is not a subsequence of the text. Empty query returns `{ score: 0, ranges: [] }`.
- **`highlight(text, ranges)`** returns a React node array, splitting `text` into plain runs and
  `<mark>` runs at the `ranges` indices (port the prototype's run-buffering loop; in TSX use JSX
  `<mark>` elements with stable keys instead of `React.createElement`). When `ranges` is empty it
  returns `text` unchanged.

### Command model + how the palette reads caches
- The palette is **controlled**: props `{ open, onClose, commands, onRun }` where `open === cmdkOpen`.
  A command is `{ id, cat, label, sub?, icon?, kbd?, run: () => void }` (mirror the prototype's
  `buildCommands` shape; `cat` is the category label used for grouping).
- **`buildCommands` lives in `App.tsx` (P1-02)**, not in this component — App is where `cmdkOpen`,
  `selectedTaskId`, the query hooks, and the mutations already live, so command closures capture the
  right state. The palette only filters/ranks/renders the list it is handed and calls `onRun(cmd)`.
- **Data sources:** read `tasks` from the `['tasks']` query (`useQuery(['tasks'])`), artifacts from
  `['artifacts']`, navigation targets from the static view registry (the same `NAV` list driving the
  P1-02 nav). Selected-task commands resolve the task by `selectedTaskId` against the `['tasks']`
  cache.
- **Categories built in order:** Selected task (guarded by a resolved selected task) → Create
  (Quick capture → focuses the P1-06 capture bar; Open Brain Dump → `setView('braindump')`) →
  Navigate (one "Go to <view>" per nav entry, plus "Enter/Exit focus mode") → Filter (Phase-1 stub,
  see Out of Scope) → Tasks (one row per task, `label = title`, `sub = id`, icon = status dot, run =
  navigate to task / open its panel) → Artifacts (one row per artifact, `label = name`, `sub =
  project`, run = `setView('artifacts')`).
- **Filtering/ranking inside the palette:** with a non-empty trimmed query, map each command through
  `fuzzy(q, label + ' ' + (sub ?? ''))`, drop `null`s, keep `{...cmd, _m, _score}`, sort by
  `_score` descending. Then group the surviving items by `cat` in first-seen order to render group
  labels (`section-label`). Highlight the label with `highlight(label, _m.ranges.filter(r => r <
  label.length))` so only label-range indices mark (sub-string matches still contribute to score but
  are not highlighted in the label).

### Selected-task actions reuse P1-03 / P1-04 optimistic mutations
- **Mark done** and **Commit / Remove from today** call the **same** optimistic TanStack Query
  mutations already defined for Today task rows (P1-03) and the task panel (P1-04) — `markDone` and
  `schedule({ date })` against `POST /api/tasks/:id/schedule`. Do **not** add palette-local mutation
  logic; the closures in `buildCommands` invoke the shared hooks so cache + rollback stay unified.
- **Open detail** opens the P1-04 panel in `mode: 'detail'` for the selected task (sets App `panel`).

### `Cmd+K` wiring (from P1-02)
- The global `Cmd/Ctrl+K` listener is part of the **App keyboard layer (P1-02)** and toggles
  `cmdkOpen`. When the palette is open, App's other global shortcuts (`1`–`7`, `J/K`, `.`) are
  suppressed (P1-02 already early-returns `if (cmdkOpen) return;`). The palette installs its **own**
  capture-phase `keydown` listener for `↑/↓/Enter/Esc` while open and removes it on close, so its keys
  never leak to the underlying view.

### Motion / styling
- Reuse the prototype CSS contract (`.cmdk-overlay`, `.cmdk`, `.cmdk-row`, `.cmdk-row.sel`,
  `.cmdk-row mark`, `.cmdk-foot`) realised in the §3 token system (`surface-1`/`surface-3`,
  `--accent`, `--ease-spring`). The scrim may fade in (≤120ms); the card uses a **transform** spring-in
  only — do not animate the card's content opacity to a hidden state (§3 / anti-pattern §9).

---

## Failure Modes

- **No tasks loaded yet (`['tasks']` empty / loading).** The Tasks group is simply empty (no rows) —
  the palette still opens with Create + Navigate (+ Selected task if applicable). Never block opening
  on a pending query; never throw on `undefined` cache data — treat as `[]`.
- **No artifacts loaded yet (`['artifacts']` empty / offline).** Same as above — the Artifacts group
  is omitted/empty; the palette remains fully usable. Artifacts failing to load must not error the
  palette.
- **No selected task.** The **Selected task** category is omitted entirely (no empty header, no
  disabled placeholder rows). If `selectedTaskId` points at a task no longer in the `['tasks']` cache,
  resolve to `undefined` and treat as "no selected task".
- **Query matches nothing.** Show the single "No commands match …" empty-results line — this is the
  only legitimate empty state, and only ever appears with a non-empty query (open-empty shows the full
  list per AC2).

---

## Out of Scope

- **Filter category actions are P2-01.** In Phase 1 the **Filter** group is a **stub/placeholder**
  (either omitted or a single disabled "Filters (coming soon)" affordance). The real per-project /
  clear-filter commands and the actual filtering behaviour land in **P2-01** (which reuses this same
  `lib/fuzzy.ts`).
- **Hermes sign-off and ACR dispatch execution** — rendered as disabled stubs in the Selected-task
  group; wiring is Phase 2 (P2-05 / P2-06).
- **Recent-command history / frequency ranking, multi-step palette flows, command aliases.**
- **Brain search UI itself** — P1-05 owns it; this spec only ships the shared `fuzzy()`/`highlight()`
  it consumes.

---

## Dependencies

- **P1-01** — design-system foundation (tokens, `--accent`, surfaces, `--ease-spring`).
- **P1-02** — App shell owns `cmdkOpen` + the global `Cmd/Ctrl+K` toggle and `buildCommands`, and
  suppresses other shortcuts while the palette is open.
- **P1-04** — task panel; the **Open detail** command opens a task in detail mode.

**Reused by (forward):** **P1-05** (Brain search) and **P2-01** (filter actions) import
`lib/fuzzy.ts`.

---

## Testing

- **`fuzzy()` unit tests (vitest, on `lib/fuzzy.ts`):**
  - **Subsequence match:** `fuzzy('tdy', 'go to today')` returns a non-null `{score, ranges}` with
    `ranges` mapping to the matched `t`,`d`,`y` indices in order.
  - **No-match returns `null`:** `fuzzy('zzz', 'go to today')` returns `null`; a query whose chars are
    present but out of order (not a subsequence) also returns `null`.
  - **Word-start bonus:** a query matching at a word boundary scores **higher** than the same query
    matching mid-word — e.g. `fuzzy('b', 'open brain dump').score > fuzzy('b', 'subtask').score`
    (assert the `+4` word-start contribution dominates), and a leading-char match (index 0) also
    receives the bonus.
  - **Consecutive-run bonus:** a fully consecutive match (`fuzzy('today','today')`) scores higher than
    the same chars matched non-consecutively, validating the `+1.5*streak` accumulation.
  - **Empty query:** `fuzzy('', 'x')` returns `{ score: 0, ranges: [] }`.
  - **`highlight(text, ranges)`** wraps exactly the `ranges` indices in `<mark>` and leaves other
    chars plain; empty `ranges` returns the text unchanged.
- **Component (React Testing Library):**
  - Open with empty query renders a non-empty grouped list (AC2); groups appear in the AC3 order.
  - Selected-task group present only when a selected task is supplied; absent otherwise (AC4).
  - Typing a query filters + reorders rows and renders `<mark>` (accent) on matched label chars (AC5).
  - `↓`/`↑` move selection (clamped), `Enter` invokes the selected command's `run` and `onClose`,
    `Esc` closes without running (AC6).
  - Empty `['tasks']`/`['artifacts']` caches still open the palette without throwing (Failure Modes).
- **Type-check + build:** `npm run type-check` (strict, no `any`) and `npm run build` pass; no `any`
  in the command model or fuzzy types.

---

## Open Questions

- **"Open task" target:** should a Tasks-group command open the P1-04 **peek** or **detail** panel
  (vs. just selecting the row)? Default: select the row and open **detail** (consistent with the
  Selected-task "Open detail" action); confirm against `panels.jsx` navigation during build.
- **Quick-capture invocation:** the prototype fires a `captureFocusRef` to focus the capture bar.
  Confirm P1-06 exposes an imperative focus handle (ref/callback) vs. the palette dispatching the same
  `Ctrl+Space` toggle App already owns.
- **`Cmd+K` toggle vs. open-only:** does a second `Cmd+K` while open **close** the palette (toggle) or
  no-op? Default: toggle (close), matching App's `cmdkOpen` boolean flip in P1-02 — verify P1-02's
  handler is a toggle, not a one-way open.
```