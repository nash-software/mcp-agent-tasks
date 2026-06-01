# MCPAT-062 — `task_rebuild_index` MCP tool skips global-storage projects

**Status:** approved
**Type:** bug
**Branch:** `fix/MCPAT-062-rebuild-index-global-store`

## Why / root cause
The `task_rebuild_index` MCP tool (`src/tools/task-rebuild-index.ts`) computes the tasks dir as
`join(projectConfig.path, tasksDirName)` for **every** project. For a **global-storage** project (MCPAT,
NASH, IFS — `storage: 'global'`), the markdown lives in `config.storageDir` (`~/.mcp-tasks/tasks`), NOT in
`<path>/agent-tasks`. So `task_rebuild_index project=MCPAT` reconciled the empty `C:\code\mcp-agent-tasks\
agent-tasks` → **count 0**, never indexing the real MCPAT tasks. The no-arg form reconciled `storageDir`
but tagged everything as `projects[0].prefix` (COND), and the Reconciler's `task.project !== this.project`
filter then dropped all the real tasks. This is what made the global index lag git's task IDs and let
`task_create` re-issue used numbers (the MCPAT-049 collision worked around all session).

The **CLI** `rebuild-index` is already storage-aware (`resolveTasksDir`, cli.ts:64-66) and the **dashboard**
self-heals on boot (MCPAT-065). Only the **MCP tool** has the gap.

## Key facts
- The MCP server builds ONE shared `sqliteIndex` for all projects (`store-registry.ts:41`), so `ctx.index`
  is the right index to reconcile into for every project.
- The registry already resolves the storage-aware tasks dir: `ctx.store.getTasksDirForPrefix(prefix)`
  (global → `storageDir`, local → `<path>/<tasksDirName>`).
- Global projects share `storageDir`; reconciling it once **per prefix** correctly indexes each prefix's
  tasks (the Reconciler's project filter keeps them separate).

## Fix — `src/tools/task-rebuild-index.ts`
- **With `project`:** validate it exists in config; `tasksDir = ctx.store.getTasksDirForPrefix(project)`;
  `count = new Reconciler(ctx.index, tasksDir, project).reconcile()`.
- **Without `project`** (schema says "all projects in config"): iterate `ctx.config.projects`, reconcile
  each with `(ctx.index, getTasksDirForPrefix(prefix), prefix)`, sum counts; return a per-project breakdown.
- Keep reconcile-only (no prune) — matches the CLI default; orphan pruning stays opt-in via the CLI
  `--prune-orphans` / the dashboard boot self-heal (MCPAT-065). Out of scope here.

## Acceptance criteria
1. `task_rebuild_index { project: '<global>' }` reconciles `storageDir` filtered to that prefix and returns
   a non-zero count when that project has markdown there (was 0).
2. `task_rebuild_index {}` reconciles **every** configured project against its correct (storage-aware) dir
   and returns the summed count (+ per-project breakdown); no project is mislabeled.
3. A local-storage project still reconciles its `<path>/<tasksDirName>` dir (no regression).
4. Unknown `project` → `PROJECT_NOT_FOUND`.
5. Gates pass.

## Tests
- Unit (`tests/unit/tools/...`): construct a config with one global project (markdown seeded in `storageDir`)
  + one local project (markdown in its dir), a shared `SqliteIndex`, a `StoreRegistry`, run the tool:
  - `project=<global>` → indexes the global-dir tasks (count > 0), `index.getTask` finds them.
  - no-arg → indexes both the global and local project tasks; per-project counts correct.
  - unknown project → throws PROJECT_NOT_FOUND.
- Full `npx vitest run` before push.

## Gates
type-check → full vitest → tsup + UI build → codex (≤3) → gated-CI merge on the status string.
Windows: kill dist/server holders before tsup; `git checkout .handbook/`; no `Co-Authored-By`.

## Out of scope
- Adding `--prune-orphans` to the MCP tool (CLI + dashboard-boot cover pruning).
- The MCP-server-uses-one-shared-index vs dashboard-per-repo-index architectural split (pre-existing).
