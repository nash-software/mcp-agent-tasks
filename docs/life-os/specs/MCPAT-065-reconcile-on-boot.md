# MCPAT-065 — Dashboard reconciles each project index on boot (durable fix for stale-index duplicates)

**Status:** approved
**Type:** bug
**Branch:** `feat/MCPAT-065-reconcile-on-boot`

## 1. Why
The Life OS dashboard renders ghost/duplicate-looking task rows when a project's SQLite `.index.db` has
diverged from its markdown source of truth. Root cause (diagnosed): `openProjectIndexes`
(`src/server-ui.ts:556-584`) opens each project's index with `idx.init()` only and **never reconciles it
against markdown** — it trusts whatever stale rows are on disk. The store invariant is "markdown is source
of truth; SQLite is a derived, rebuildable index", but the dashboard read path violates it.

Observed live: EXTR + COND indexes had drifted (and EXTR's couldn't even rebuild — a markdown file with
`priority: normal` crashed the reconcile via a SQLite CHECK constraint). A manual
`rebuild-index --prune-orphans` cleared both, but the dashboard must self-heal so it can't recur.

## 2. Scope (2 fixes)

### 2.1 Reconciler resilience — `src/store/reconciler.ts` (reconcile loop ~:103-110)
Today the per-file `catch` skips only `McpTasksError` code `SCHEMA_MISMATCH` and **rethrows everything else**
(`:109`), so a single poison record (bad enum value, constraint failure) aborts the entire project's
reconcile. Change it to **skip ANY failing file with a loud `console.error` naming the file + error, then
continue**. One bad task must not poison the other N. (Markdown stays source of truth; the bad file is
surfaced for a human to fix, e.g. via `rebuild-index` output.)

### 2.2 Reconcile-on-boot — `src/server-ui.ts` `openProjectIndexes` (:556-584)
After `idx.init()` for each project, run `new Reconciler(idx, tasksDir, prefix, milestoneRepo).reconcile()`
then `.pruneOrphans()` (same routine `agent-tasks rebuild-index --prune-orphans` uses). **Wrap per project
in try/catch** — if one project's reconcile throws, log a warning and keep that project's last-known index
rather than crashing the whole dashboard boot. Do this for the config projects AND the GEN project branch.
Pruning is required (not just reconcile) — orphan rows are what render as ghosts.

## 3. Acceptance criteria
1. Dashboard boot reconciles each project index from markdown and prunes orphans — a task present in
   markdown but missing from the index appears in `GET /api/tasks` after boot, with no server restart loop.
2. Orphan index rows (id with no markdown file) are gone from `GET /api/tasks` after boot.
3. A project containing a poison markdown file (e.g. invalid `priority`) does **not** crash the dashboard:
   the server still boots, that project's other tasks still index, and the bad file is logged.
4. The Reconciler skips a poison file and indexes the rest (returns a count of the good tasks; does not throw).
5. Gates pass.

## 4. Tests
- **Unit (`reconciler`)**: a temp tasksDir with 2 valid tasks + 1 poison file (invalid `priority`) →
  `reconcile()` returns 2, does not throw, the 2 valid tasks are indexed, the poison one is absent.
- **Integration (server, mirror `mutation-endpoints.test.ts`)**: seed a temp project's **markdown** (not the
  index) + an orphan row directly in the index; start `startUiServer`; `GET /api/tasks` shows the markdown
  tasks and NOT the orphan (reconcile-on-boot + prune ran). Second case: a project with a poison markdown
  file → server boots, `GET /api/tasks` serves the other tasks (resilience AC3).
- Full `npx vitest run` before push.

## 5. Gates
type-check (root + UI) → full vitest → tsup + UI build → codex (≤3) → gated-CI merge on the status string.
Windows: kill `dist/server` holders before tsup; `git checkout .handbook/` before commits; no `Co-Authored-By`.

## 6. Notes / out of scope
- Perf: reconcile-on-boot adds a markdown scan per project at startup (bounded — hundreds of files is fast).
  If it ever becomes a concern, gate behind a flag; default-on for correctness now.
- Does NOT change the `task_rebuild_index` MCP tool's global-store gap (separate bug, MCPAT-062).

## 7. Has-markdown guard (added during build)

`reconcileIndexOnBoot` only reconciles+prunes when the project's tasks dir **contains at least one `.md`
file**. Rationale: an empty or markdown-less dir is ambiguous (a brand-new project, or a transiently
missing/unmounted directory) — pruning the index to nothing there would be destructive. EXTR/COND have real
markdown so they still self-heal; a project with index rows but no markdown is left untouched. (This also
keeps index-only test harnesses valid — they seed the index without markdown.)

**AC6:** a project whose tasks dir has index rows but no `.md` files keeps its index on boot (not pruned).
