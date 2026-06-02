# MCPAT-068 — Surface captured-but-unrendered task fields in TaskPanel (dependencies, references, subtasks, files, complexity)

**Status:** approved
**Type:** feature
**Phase:** Phase 5+ — daily-use gap closing
**Branch:** `feat/MCPAT-068-panel-field-surfacing`
**Size:** S–M

> Read `docs/life-os/specs/00-epic-overview.md` §3 (tokens), §4 (data shapes) and **P1-04**
> (`P1-04-task-panels.md`) — this spec extends the `TaskPanel` that P1-04 built and P5-03 made
> partially editable. The `Section` / `FileRow` helpers, `STATUS_DOT` token map, and the peek-vs-detail
> (`isPeek`) convention are established there — **do NOT re-investigate them.** Evidence cited inline
> with `file:line` (confirmed 2026-06-02). Reading those files again is wasted budget.

---

## Description

The store captures five task fields that the dashboard **never renders**. The data model
(`src/types/task.ts:64-104`) carries `dependencies: string[]`, `references?: TaskReference[]`
(`TaskReference = { type: 'closes' | 'blocks' | 'related'; id }`, `task.ts:7-10`),
`subtasks: SubtaskEntry[]` (`{ id, title, status }`, `task.ts:51-55`), `files: string[]`, and
`complexity: number` (1–10). The agent layer writes these (a builder linking dependencies, an
architect splitting a task into Level-2 subtasks, the post-commit hook recording touched files), but a
human opening the task in `TaskPanel.tsx` sees none of them. This is a **display-only** gap: the work
exists, it is just invisible.

This spec adds five read-only sections/badges to `src/ui/src/components/TaskPanel.tsx`, reusing the
existing `Section` helper (`TaskPanel.tsx:31-38`), `FileRow` helper (`TaskPanel.tsx:40-50`),
`STATUS_DOT` token map (`tokens.ts`, imported at `TaskPanel.tsx:22`), and the design tokens
(`text-ink-faint`, `bg-surface-2`, mono badges) — matching the existing Tags / Dates / Status-history
section style (`TaskPanel.tsx:836-889`):

1. **Dependencies** — `task.dependencies[]`, rendered as mono task-ID badges ("must be done first").
2. **References** — `task.references[]`, each a `type` label (closes / blocks / related) + a mono ID badge.
3. **Subtasks** — `task.subtasks[]`, a read-only checklist with a `STATUS_DOT` per row and a
   **done / total** progress count in the section header.
4. **Files touched** — `task.files[]`, one `FileRow` per relative path.
5. **Complexity** — `task.complexity` (1–10), a badge in the existing metadata cluster next to
   priority / status / estimate (`TaskPanel.tsx:574-632`).

**The one backend touch (verified, not assumed).** The API serves raw index rows
(`server-ui.ts:1347` `/api/tasks`, `server-ui.ts:1624` `/api/today` — both `sendJson` the
`SqliteIndex` rows). The row→task mapping (`sqlite-index.ts:194-299`) reconstitutes
`dependencies` (`:202-204`), `subtasks` (`:194-200`), and `references` (`:288-297`) from child tables,
and `complexity` is a direct column (`:255`) — **all four reach the client today.** But
**`files` is hardcoded `files: []` at `sqlite-index.ts:270`**: there is no `files` column or child
table, and `upsertTask` (`:328-441`) never persists it. So `task.files` is **always empty** at the API
boundary regardless of what the markdown holds. This spec therefore includes the index change to store
and return `files` (AC-6) — without it, the Files section can never render and the feature is half-built.

---

## Acceptance Criteria

- [ ] **AC-1 — UI types extended.** `src/ui/src/types.ts` `Task` interface gains optional
      `dependencies?: string[]`, `references?: TaskReference[]`, `subtasks?: Subtask[]`,
      `files?: string[]`. New UI types `TaskReference` (`{ type: 'closes' | 'blocks' | 'related'; id: string }`)
      and `Subtask` (`{ id: string; title: string; status: TaskStatus }`) are added (mirroring
      `src/types/task.ts:7-10,51-55`). `complexity?` already exists (`types.ts:43`) — unchanged. No `any`.
- [ ] **AC-2 — Dependencies section.** When `task.dependencies?.length`, a `Section title="Dependencies"`
      renders one mono ID badge per entry (`font-mono text-ink-2 bg-surface-2 px-1.5 py-0.5 rounded`,
      matching `FileRow`'s badge style). When the array is absent or empty the section is **omitted**
      entirely (matches the Dates guard at `TaskPanel.tsx:840`). IDs are display-only — no navigation.
- [ ] **AC-3 — References section.** When `task.references?.length`, a `Section title="References"`
      renders one row per ref: a `type` label (`closes` / `blocks` / `related`) in `text-ink-faint` +
      the `id` as a mono badge. Empty / absent → section omitted.
- [ ] **AC-4 — Subtasks checklist.** When `task.subtasks?.length`, a `Section` whose title carries a
      **done / total** count (e.g. `Subtasks · 2/5`, where done = entries with `status === 'done'`)
      renders a read-only checklist: each row a `STATUS_DOT[s.status]` dot + the title, with a
      strikethrough/`text-ink-faint` treatment on done rows. No checkbox is interactive (display-only).
      Empty / absent → section omitted.
- [ ] **AC-5 — Files section.** When `task.files?.length`, a `Section title="Files touched"` renders one
      `FileRow` per path (label = the path's directory or index, `path` = the relative path; `FileRow`
      already truncates to the filename with the full path on `title` hover, `TaskPanel.tsx:40-50`).
      Empty / absent → section omitted.
- [ ] **AC-6 — `files` round-trips through the index (backend).** `SqliteIndex` persists and returns
      `task.files`: `sqlite-index.ts:270`'s hardcoded `files: []` is replaced with the stored array, a
      `files` storage mechanism is added (a `files` child table mirroring `dependencies`, or a JSON
      column), `upsertTask` writes it, and the delete/re-insert + `deleteTask` paths clear it (mirror
      `dependencies` at `:399,:411-412,:455`). **Falsifiable:** a task whose markdown lists `files:`
      returns those paths from `getTask` / `listTasks` (not `[]`).
- [ ] **AC-7 — Complexity badge.** A complexity badge (`{n}/10` or a "Complexity {n}" pill) renders in
      the metadata cluster alongside priority / status / estimate (`TaskPanel.tsx:574-632`), styled like
      the sibling badges (`bg-surface-2 text-ink-2 text-xs rounded px-1.5 py-0.5`). Omitted when
      `complexity` is absent or `0`/`1` is treated as "unset" per the existing default (`sqlite-index.ts:255`
      defaults `complexity` to `1`) — **decide and document the threshold in Open Questions**; default:
      render whenever `complexity != null`.
- [ ] **AC-8 — Peek vs detail placement documented.** Dependencies, References, Subtasks, and Files
      sections are **detail-only** (gated on `!isPeek`, matching Status-history at `TaskPanel.tsx:864`),
      keeping the 380px peek pane uncluttered; the **complexity badge** shows in **both** peek and detail
      (it lives in the always-visible metadata cluster). This split is asserted in the RTL test (AC-9).
- [ ] **AC-9 — Render correctness.** Tests assert: each section renders its entries when the array is
      populated; each section is **absent** when the array is empty/undefined; the subtasks count equals
      done/total; the four list sections render only under `mode='detail'` (not `peek`); the complexity
      badge renders in both modes.
      > **Test-strategy note (codex review, MCPAT-068):** the repo's vitest env is `node` with **no jsdom**
      > — every UI test in this codebase is *source-inspection* (read the `.tsx`, assert on structure), not
      > a true RTL mount (see the header of `tests/unit/ui-task-panel.test.ts`). These tests follow that
      > convention. A real `@testing-library/react` + jsdom harness that mounts components and asserts the
      > live DOM is a **project-wide follow-up** (it flips the global test environment), tracked separately —
      > not bolted on inside this feature. Runtime behaviour here is additionally backed by the mandatory
      > on-screen visual check (Testing, below).
- [ ] **AC-10 — Gates pass.** `npm run type-check` (strict, `tsc -b` green, no `any`), `npm run build`
      (Vite + tsup), and `npm test` all green. Plus the visual check in Testing below.

---

## Technical Notes

**Files touched (current state confirmed 2026-06-02):**
- `src/ui/src/types.ts` — add `TaskReference` + `Subtask` UI types and the four optional `Task` fields
  (AC-1). `complexity?` already present at `:43`.
- `src/ui/src/components/TaskPanel.tsx` — add four detail-only `Section`s after the Tags/Dates block
  (after `:836`, before or after Status-history `:863`) and a complexity badge in the metadata cluster
  (`:574-632`). Reuse `Section` (`:31`), `FileRow` (`:40`), `STATUS_DOT`/`PRIORITY_COLOR`/`AREA_DOT`
  imports (`:22`), `relativeTime`/`absoluteTime` not needed here. Guard every section on a non-empty
  array (mirror `:840`).
- `src/store/sqlite-index.ts` — **backend (AC-6 only).** Replace `files: []` (`:270`) with the stored
  array; add a `files` storage mechanism + write path in `upsertTask` (`:328-441`) and clear it in the
  delete paths (`:397-404`, `:454-461`). Mirror the `dependencies` child-table pattern exactly
  (`:202-204` read, `:399,:411-412` write/clear) — a `files (task_id, path, sort_order)` table is the
  lowest-risk option and keeps the "child-array caps" philosophy from the handbook critical-rules.
- **No change to `server-ui.ts`** — `/api/tasks` (`:1347`) and `/api/today` (`:1624`) already
  `sendJson` the full index rows; once the index returns `files`, the client receives it. (Confirm at
  implementation time that no intermediate projection strips it.)

**Reuse, do not reinvent:**
- `Section` (`TaskPanel.tsx:31-38`): `<h3>` uppercase label + children. Subtasks count goes in the
  `title` prop string (`Subtasks · {done}/{total}`).
- `FileRow` (`TaskPanel.tsx:40-50`): already does filename truncation + full-path `title` tooltip —
  use it verbatim for the Files section.
- Mono ID badge for dependencies/references: copy `FileRow`'s inner span class
  (`font-mono text-ink-2 bg-surface-2 px-1.5 py-0.5 rounded`).
- `STATUS_DOT[status]` for subtask dots — same map the Status-history rows use (`:870-876`).

**Backend storage decision (AC-6):** prefer a `files` child table (`task_id, path, sort_order`) over a
JSON column — it matches the existing `dependencies` / `subtasks` / `task_references` shape, keeps the
delete-and-reinsert transaction symmetric (`:397-437`), and respects the array-cap philosophy. Apply the
same `MAX_*`-style cap the other child arrays use to prevent index bloat (handbook: "SqliteIndex —
child-array caps"). The markdown remains the source of truth (`files` is already in
`TaskFrontmatter`, `task.ts:103`); the index is the rebuildable projection — a `rebuild-index` after the
schema add re-populates `files` from markdown.

---

## Failure Modes

- **Forgetting AC-6 (the `files: []` hardcode).** Shipping only the UI section leaves Files permanently
  empty — the markdown holds paths but the API returns `[]`. The index change is **not optional**; it is
  the single backend touch this spec exists to call out. Falsifiable test required (AC-6).
- **Schema add without a migration path.** Adding a `files` table on an existing `.index.db` must not
  crash on boot. Follow the existing `CREATE TABLE IF NOT EXISTS` + body_hash migration pattern
  (`sqlite-index.ts:179`); a `rebuild-index` re-derives `files` from markdown. Verify an existing db
  opens cleanly.
- **Rendering empty sections.** A `Section` with a zero-length array renders an empty header band — every
  section must guard on `task.X?.length` (mirror `:840`), not just `task.X`.
- **Subtask count off-by-one / wrong predicate.** `done` must count `status === 'done'` only (not
  `closed`/`archived`) unless documented otherwise — assert in the RTL test.
- **Peek-pane clutter.** Putting the four list sections in peek (380px) breaks the at-a-glance design —
  they must be `!isPeek`-gated (AC-8). The complexity badge is the only field shown in peek.
- **`any` leakage.** The new UI `TaskReference`/`Subtask` types must be explicit and exhaustive over the
  unions; no `as any` on `task.references` / `task.subtasks`.

---

## Out of Scope

- **Editing any of these fields.** Adding/removing dependencies, references, subtasks, or files, and
  editing complexity, are all **future tasks** — this spec is display-only. No PATCH-route changes, no
  `VALID_PATCH_FIELDS` additions (contrast P5-03, which was the editing spec).
- **Navigation from dependency/reference IDs.** Clicking a dependency/reference ID to open that task is
  deferred — render as a static mono badge only (see Open Questions).
- **Subtask interactivity.** The checklist is read-only; toggling a subtask's status (which would go
  through the store's subtask-promotion/transition machinery) is out of scope.
- **`complexity_manual` surfacing or recomputation.** The auto-vs-manual complexity flag
  (`task.ts:74`) is not displayed or edited here.
- **Body / markdown rendering changes.** Only the structured frontmatter fields above; the task body
  pane is untouched.

---

## Dependencies

- **P1-04** (`P1-04-task-panels.md`) — built `TaskPanel`, the `Section`/`FileRow` helpers, and the
  peek/detail mode split this spec extends.
- **P1-01** (`P1-01-design-system-foundation.md`) — the `tokens.ts` `STATUS_DOT` / design tokens reused
  here.
- Soft: **P5-03** (`P5-03-task-field-editing.md`) — established the editable metadata-cluster
  conventions; this spec adds a **read-only** badge to the same cluster, so the two must not collide on
  layout. No hard ordering dependency.

---

## Testing

- **`npm run type-check`** — strict, `tsc -b` green, no `any`; the new `TaskReference`/`Subtask` UI types
  are exhaustive over the unions (AC-1, AC-10).
- **`npm run build`** — Vite (UI) + tsup (server) succeed with the index schema change (AC-10).
- **`npm test`** — green, including:
  - **RTL (UI)** — each section renders when populated / is absent when empty; subtasks count = done/total;
    the four list sections are absent in `mode='peek'` and present in `mode='detail'`; complexity badge
    present in both (AC-9, AC-8).
  - **Integration (store)** — a task whose markdown lists `files:` returns those paths from `getTask` /
    `listTasks` (not `[]`); `deleteTask` leaves no orphan `files` rows; `rebuild-index` re-populates
    `files` from markdown (AC-6).
- **Visual check (mandatory)** — run the dashboard (`agent-tasks serve-ui` on **:4242**), open a task that
  has **dependencies + subtasks populated** (e.g. seed a fixture task or pick a real one with subtasks),
  and confirm in-browser: the Dependencies, References, Subtasks (with the `done/total` count), and Files
  sections render in the **detail** pane; the complexity badge appears in the metadata cluster in **both**
  peek and detail; and an empty task shows **none** of the four list sections. Per project memory
  ("Verify UI bugs visually, not just tests/API") this on-screen confirmation is required, not optional.

---

## Open Questions

1. **Dependency/reference ID navigation.** Render IDs as static mono badges (default, in scope) vs. make
   them clickable to open that task's panel? Default: **static** — navigation is a follow-up task; flag
   it if the user wants click-through now.
2. **Complexity "unset" threshold.** `sqlite-index.ts:255` defaults `complexity` to `1`, so `1` may mean
   "genuinely trivial" or "never set". Default: render the badge whenever `complexity != null` (so `1`
   shows). Confirm whether `1` should be suppressed as "unset" — risks hiding a legitimately trivial task.
3. **`files` storage: child table vs JSON column.** Default: a `files (task_id, path, sort_order)` child
   table to match the `dependencies` pattern and the array-cap philosophy. Confirm at implementation —
   a JSON column is simpler but breaks the established child-table symmetry and per-path query ability.
4. **Files-section row label.** `FileRow` takes a `label` + `path`; for a flat `files: string[]` there is
   no natural label. Default: use the path's parent directory (or an index `#1, #2`) as the label.
   Confirm the preferred label scheme against the existing single-file `FileRow` usages.
