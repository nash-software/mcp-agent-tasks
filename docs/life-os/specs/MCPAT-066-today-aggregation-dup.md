# MCPAT-066 — Today view shows duplicate tasks (unscoped aggregation over shared global index)

**Status:** approved
**Type:** bug
**Branch:** `fix/MCPAT-066-today-aggregation-dup`

## Why / root cause (the REAL duplicate-tasks bug)
The dashboard renders each task 4× in the Today view. Root cause found via live visual QA (not the index
staleness MCPAT-065 addressed — that was a misdiagnosis of this symptom):

The dashboard opens **several global-storage projects (MCPAT, NASH, IFS, GEN) that all share ONE underlying
index db** (`resolveServerDbPath` returns the global db for `storage:'global'`). `/api/today` aggregates
`projectIndexes.flatMap(p => p.index.getCandidates(20))` — but `getCandidates` / `getTasksByScheduledDate`
are **NOT project-scoped** (`SELECT * FROM tasks WHERE status…`). So the shared global db is queried once
per global project and its rows are emitted N× (N = number of global projects = 4). `/api/tasks` is clean
because it always scopes with `project: p.prefix` (server-ui.ts:1362). Evidence: `/api/today` candidates
returned `EXTR-162 ×4, EXTR-147 ×4, EXTR-148 ×4, COND-370 ×4` while `/api/tasks?project=EXTR` returned 114
rows, 0 dups.

Same latent shape in `/api/milestones` (`listMilestones()` unscoped) and `/api/activity`
(`getRecentActivity(50)` unscoped).

## Fix — project-scope the aggregations (match the proven `/api/tasks` pattern)
- `SqliteIndex.getCandidates(limit, project?)` and `getTasksByScheduledDate(date, project?)`: add an optional
  `project` filter (`AND (@project IS NULL OR project = @project)`).
- `SqliteIndex.getRecentActivity(limit, project?)`: add the same (`WHERE t.project = @project`).
- `/api/today`: pass `p.prefix` to `getTasksByScheduledDate`, `getCandidates`, and the draft `listTasks`.
- `/api/milestones`: `listMilestones(p.prefix)` (the method already supports it).
- `/api/activity`: `getRecentActivity(50, p.prefix)`.
Now each projectIndex contributes only its own prefix's rows; the shared global db is never multiplied.

## Acceptance criteria
1. `/api/today` candidates + committed contain each task exactly once when multiple global-storage projects
   share one index db (no dup ids).
2. `/api/milestones` and `/api/activity` likewise not multiplied across shared global indexes.
3. `/api/tasks` behaviour unchanged (regression).
4. Gates pass; visual confirmation in serve-ui that the Today view shows distinct tasks.

## Tests
- Integration (`today-dedup`): config with two global projects sharing one db, seed unscheduled + committed
  tasks, assert `/api/today` candidates/committed contain each id once (would be 2× pre-fix).
- Full `npx vitest run` before push.

## Gates
type-check → full vitest → tsup + **npm --prefix src/ui run build** (tsup cleans dist/, wiping dist/ui — MUST
rebuild the UI after tsup or serve-ui 404s the dashboard) → codex (≤3) → gated-CI merge.

## Notes
- MCPAT-065 (reconcile-on-boot) remains valid hardening (real index-staleness defense) but did NOT cause or
  fix these dupes — documented as a misdiagnosis corrected here.
- Deeper architectural smell: multiple `projectIndexes` sharing one db while some queries are unscoped.
  Project-scoping every aggregation (as `/api/tasks` does) is the consistent contract; a future cleanup
  could dedupe projectIndexes by db, but scoping is the minimal correct fix.
