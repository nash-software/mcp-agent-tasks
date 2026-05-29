# P1-08 — Artifacts View Reskin

**Type:** Feature
**Phase:** 1 (Reskin)
**Epic:** MCPAT-022 — Life OS UI Reskin
**Size:** S

> Shared tokens, data shapes, and client conventions live in
> [`00-epic-overview.md`](./00-epic-overview.md). This spec references §3 (tokens/motion),
> §4 (`Artifact` shape), and §5 (`['artifacts']` query, task navigation) — it does not repeat them.

---

## Description

`ArtifactsView` is the passive memory surface: a list of every file Claude created or edited for the
user in the last 30 days, ordered **oldest-viewed first** so the things most likely to be forgotten
sit at the top. It is the one place that answers "what did I make and then never look at again?"

The current `views/ArtifactsView.tsx` is functionally correct but visually plain — hardcoded
`slate/indigo/emerald/amber/red` utilities, a `bg-slate-800` table header, no file-type icon, and a
plain "Copy path" text button. It also **relies on the API to return rows pre-sorted by staleness**
and does no client-side ordering of its own, so any change in server order silently breaks the
staleness-first invariant that is the whole point of the view.

**Why this matters (the WHY):** forgotten artifacts are invisible debt. A spec written three weeks ago
and never re-opened is exactly the thing the user has lost track of. Staleness-first ordering plus a
loud per-row staleness badge surfaces that debt without the user having to go looking. This reskin
brings the view to the prototype's look (`reference/artifacts.jsx`, `screenshots/05-artifacts.png`)
and hardens the ordering so the surface keeps its meaning regardless of API behaviour.

This is a **reskin** — it keeps the existing `useArtifacts` hook, `GET /api/artifacts`,
`POST /api/artifacts/opened`, and the `ArtifactEntry` type. No backend work.

---

## Acceptance Criteria

1. **Header.** Renders `Artifacts` as the view title with a muted sub-line
   `last 30 days · {N} files · {M} unvisited`, where `N` is the rendered row count and `M` is the count
   of rows whose `last_opened_at === null`. A short caption beneath (Clock icon + text) reads
   *"Sorted by staleness — oldest-viewed first. This is what you might be forgetting."*

2. **Explicit client sort by staleness, descending — enforced as a guard.** The view sorts a copy of
   the artifacts array by `staleDays` **descending** (oldest-viewed at top) *in the component*, and
   renders from the sorted copy — it does **not** rely on the order returned by `GET /api/artifacts`.
   A test feeds rows in scrambled order and asserts the rendered DOM order is strictly non-increasing
   by `staleDays`.

3. **Row layout + staleness badge thresholds.** Each row shows, left→right: a file-type icon colored
   by extension, the filename in **bold** (`basename(path)`), the full `path` in muted mono **truncated**
   with the complete path as the element `title` (hover tooltip), a project badge (`artifact.project`),
   and a **staleness badge** — a mono pill reading `{staleDays}d` colored by threshold:
   **green when `staleDays <= 7`**, **amber when `staleDays <= 21`**, **red when `staleDays > 21`**
   (i.e. `>7 && <=21` is amber; `>21` is red). Unvisited rows (`last_opened_at === null`) show a small
   "not yet viewed" dot next to the filename.

4. **Copy-path marks the artifact opened.** Each row has a copy-path icon button (no `file://` link —
   browsers block `file://` navigation, so copying the path is the correct action). On click it writes
   `artifact.path` to the clipboard via `navigator.clipboard.writeText`, shows a transient "copied"
   confirmation (~1.4s), fires a toast (`Copied path · {filename}`), and **then** calls
   `markArtifactOpened(artifact.path)` → `POST /api/artifacts/opened`. The opened POST is best-effort:
   the copy and toast must succeed even if the POST is skipped or fails.

5. **Linked-task navigation.** When `artifact.task_id` is set, the row shows a link icon button. Clicking
   it (and stopping row-click propagation) navigates to that task — it resolves the task and opens it in
   the App-owned detail panel (App `selectedTask` + `TaskDetailPanel`, per P1-02). When `task_id` is
   null the link button is absent.

6. **Empty state.** When the (post-sort) list is empty, render the empty state with a Files icon, a
   title, and the exact copy
   *"No artifacts yet. They'll appear here automatically whenever Claude creates or edits files for you."*
   No table header or rows render in the empty state.

---

## Technical Notes

- **Files:**
  - `C:\code\mcp-agent-tasks\src\ui\src\views\ArtifactsView.tsx` — reskin target.
  - `C:\code\mcp-agent-tasks\src\ui\src\hooks\useArtifacts.ts` — existing hook, keep
    (`queryKey: ['artifacts']`, `refetchInterval: 60_000`); no change required beyond what AC-2 needs
    (sort happens in the view, not the hook).
  - `C:\code\mcp-agent-tasks\src\ui\src\api.ts` — existing `getArtifacts()` (`GET /api/artifacts`) and
    `markArtifactOpened(path)` (`POST /api/artifacts/opened`, body `{ path }`). Reuse both as-is.
  - `C:\code\mcp-agent-tasks\src\ui\src\App.tsx` — owns `selectedTask` + `TaskDetailPanel`; the linked-task
    navigation flows through here (see Dependencies).
- **Canonical type (real store wins over prototype).** `ArtifactEntry` in `src/ui/src/types.ts`:
  `{ path, project, created_at, last_opened_at: string | null, task_id: string | null, staleDays: number }`.
  The prototype's `data.js` `Artifact` uses `name`/`ext`/`days`/`unvisited`; **map to the real fields**:
  - filename ← `basename(path)` (the existing helper splits on `/` and `\\`);
  - extension ← derived from `path` (last `.`-segment, lowercased);
  - `days` ← `staleDays`;
  - `unvisited` ← `last_opened_at === null`.
  Do **not** add `name`/`ext`/`days`/`unvisited` fields to the type — derive them in the component.
- **Extension → icon + color map.** Drive a single lookup keyed by lowercased extension. Use
  `lucide-react` icons (per epic §6, no hand-rolled SVGs) — e.g. `FileText` for `md`, `FileCode` for
  `ts`/`tsx`, `FileCode`/`Code` for `html`, `Braces`/`FileJson` for `json`, and a default `File` icon
  for anything else. Color tints per family (suggested): `md` text-2/neutral, `ts`/`tsx` blue,
  `html` amber, `json` green; unknown → muted. Keep this as a small typed `Record<string, …>` constant
  in the view (no magic strings scattered inline).
- **Staleness threshold constants.** Define named constants — `STALE_FRESH_MAX_DAYS = 7` and
  `STALE_MID_MAX_DAYS = 21` — and a `staleClass(staleDays)` / `staleColor(staleDays)` helper:
  `<= STALE_FRESH_MAX_DAYS` → green, `<= STALE_MID_MAX_DAYS` → amber, else red. No inline `7`/`21`
  literals in JSX. (Note: the *current* code uses `< 7` for the fresh branch; this spec standardizes on
  `<= 7` per the handoff §6.6 "green ≤7d".)
- **Sort guard (AC-2).** `const sorted = [...artifacts].sort((a, b) => b.staleDays - a.staleDays)`.
  Render `unvisited` count and rows from `sorted`. Stable enough for equal `staleDays` — ties keep input
  order, which is acceptable.
- **The opened POST.** `markArtifactOpened(artifact.path)` already exists and posts
  `{ path }` to `/api/artifacts/opened`. Call it after the clipboard write and toast, wrapped so a
  rejection is swallowed (see Failure Modes).
- **Tokens & motion (§3).** Replace all `slate/indigo/emerald/amber/red` literals with the §3 token
  surfaces and status colours: rows on `surface-1` with a `surface-3` 1px hairline divider, hover to
  `surface-2` over ~100ms, mono pills/path in Geist Mono with `tabular-nums`, project badge as the
  shared prefix badge. Staleness badge backgrounds use the status colour at ~13–16% soft fill. No
  gradients/shadows (§9). Filename hierarchy comes from weight + the icon, not color.

---

## Failure Modes

- **Clipboard API unavailable.** `navigator.clipboard` may be undefined (insecure context) or
  `writeText` may reject. Guard the call; on failure, skip the copy silently (or no-op the toast) and
  **do not throw** — the row must stay interactive. Do not attempt a `file://` link as a fallback
  (browser-blocked).
- **`markArtifactOpened` POST fails (non-blocking).** The opened POST is best-effort telemetry for the
  staleness clock. If it rejects (server offline, 500), swallow the error — the copy already succeeded
  and the user got their toast. A failed POST must never surface an error or block the copy. The row's
  staleness will simply refresh on the next `['artifacts']` refetch.
- **Empty list.** With zero artifacts (post-sort), render only the empty state (AC-6) — no header
  table, no toast region churn. Loading state renders a quiet "Loading…" line, not the empty copy.
- **Long/odd paths.** Very long paths must truncate (not wrap or overflow the row) with the full path in
  the `title`; rows with no extension fall back to the default file icon and muted color.

---

## Out of Scope

- **Global project/area filter** — the cross-view filter (FilterBar + `matchFilter`) is **P2-01**. This
  spec renders all artifacts the API returns; do **not** add a filter UI or `matchFilter` call here.
  (The prototype's `filterProps`/`filter` plumbing is Phase 2.)
- Pagination / infinite scroll, server-side sorting changes, or any change to `GET /api/artifacts`
  response shape.
- Opening files in an editor / OS-level reveal — copy-path is the deliberate action (`file://` is
  browser-blocked).
- Changing the 30-day window or the staleness computation (those live server-side).

---

## Dependencies

- **P1-01** — design-system foundation (tokens, surfaces, status/area colours, Geist Mono, motion).
- **P1-02** — App shell owns task navigation (`selectedTask` + `TaskDetailPanel`). The linked-task
  (`task_id`) action navigates via the App-owned selected-task path established in P1-02; this view
  receives an `onOpenTask(taskId)` callback (or equivalent) from App rather than owning panel state.

---

## Testing

- **Staleness sort (AC-2) — primary guard.** Feed `useArtifacts` (mocked) a scrambled array of
  `ArtifactEntry` (e.g. `staleDays` `[3, 30, 12, 1, 22]`) and assert the rendered row order is strictly
  non-increasing by `staleDays` (`[30, 22, 12, 3, 1]`). This proves the client sort, not API order.
- **Threshold colors (AC-3).** Parameterized: `staleDays` of `7` → green class, `8` → amber, `21` →
  amber, `22` → red. Asserts the `<=7` / `<=21` / `>21` boundaries against the named constants.
- **Header counts.** Assert sub-line shows correct `{N} files` and `{M} unvisited` where `M` counts
  `last_opened_at === null` rows.
- **Copy marks opened (AC-4).** Mock `navigator.clipboard.writeText` and `markArtifactOpened`; click
  copy → assert `writeText(path)` called, toast shown, then `markArtifactOpened(path)` called.
- **Opened POST failure is non-blocking.** Make `markArtifactOpened` reject → assert no throw, copy +
  toast still observed.
- **Clipboard unavailable.** With `navigator.clipboard` undefined, clicking copy does not throw and the
  row remains rendered.
- **Linked-task navigation (AC-5).** Row with `task_id` set → link button present; click fires the
  `onOpenTask(task_id)` callback. Row with `task_id === null` → no link button.
- **Empty state (AC-6).** Empty array → exact empty copy rendered, no table header.
- **Type-check + build:** `npm run type-check` (strict, no `any`) and `npm run build` pass; no
  remaining `slate/indigo/emerald` literals in the view.

---

## Open Questions

- **Toast channel.** The current view uses a local `copiedPath` banner; the prototype routes copy
  feedback through a global `onToast`. Default: use the shell-level toast (P1-02 `CaptureToast`/toast
  host) if exposed by build time, else keep a local transient confirmation. Confirm against P1-02.
- **`onOpenTask` resolution.** Does the view receive a resolved `Task` lookup or just the `task_id`
  string (App resolves it from the `['tasks']` cache)? Default: pass `task_id` up and let App resolve +
  open the panel, so this view holds no task cache. Confirm the App prop shape from P1-02.
- **Icon family granularity.** Is a 5-bucket ext map (md / ts+tsx / html / json / default) sufficient,
  or should `js`, `css`, `yaml`, `png` get distinct icons? Default: ship the 5 buckets named in the
  handoff; extend the map later without API change.
