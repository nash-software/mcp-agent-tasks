---
date: 2026-04-09
version: 0.1.0
branch: master
commits: 4
tests: 231 passing, 4 skipped
build: ESM + CJS, type-check clean
---

# agent-tasks — Current State

## What This Is

A standalone npm package providing file-based task management for AI coding agents.

The core idea: agents (Claude, Cursor, Windsurf, etc.) need persistent task tracking between sessions. This gives them a proper todo list stored as plain markdown files that developers can read, edit, and commit to git — with a SQLite index for fast queries.

**Stack:**
- Markdown files are the source of truth (human-readable, git-trackable)
- SQLite is an ephemeral cache (delete it; it rebuilds from markdown)
- 20 MCP tools exposed over stdio (Model Context Protocol)
- Commander CLI for humans
- Claude Code hook for enforcement

---

## What's Built (All 4 Phases Complete)

### Phase 0 — Types, Schema, Contracts
All TypeScript interfaces locked before any implementation.

- `src/types/task.ts` — Task, TaskStatus, Priority, CommitRef, PRRef, SubtaskEntry, StatusTransition
- `src/types/errors.ts` — McpTasksError with typed error codes
- `src/types/config.ts` — GlobalConfig, PerProjectConfig
- `src/types/tools.ts` — Input/output types for all 20 tools
- `src/types/transitions.ts` — Valid state machine transitions
- `src/store/schema.sql` — Full SQLite schema: 10 tables, FTS5, 6 indexes, 3 triggers
- `schema/task.schema.json` — JSON Schema for task frontmatter
- `schema/config.schema.json` — JSON Schema for config
- `tests/fixtures/` — HERALD-001..003 + corrupt fixture

### Phase 1a — Store Layer
All data I/O. The foundation everything else builds on.

- **`MarkdownStore`** — reads/writes task markdown files. Atomic writes via temp-file rename (POSIX + NTFS safe). Caps `transitions[]` at 100, `git.commits[]` at 50.
- **`SqliteIndex`** — SQLite index with WAL mode, FTS5 full-text search, TOCTOU-safe claim locking, priority-aware `getNextTask()`, atomic `nextId()` via `UPDATE ... RETURNING`.
- **`ManifestWriter`** — writes `index.yaml` summary for the enforcement hook to read without querying SQLite.
- **`TaskFactory`** — creates Task objects with all required frontmatter defaults, template bodies, ID formatting (`PREFIX-001`).
- **`TaskStore`** — facade over the above three. Enforces write protocol: SQLite → markdown → manifest. Validates allowed fields. Checks circular dependencies before any write.
- **`dependency-graph.ts`** — DFS cycle detection called by createTask and updateTask.
- **`Reconciler`** — scans all `.md` files and re-indexes into SQLite. Used to rebuild after DB deletion or manual file edits.
- **`ConfigLoader`** — resolves config from env → per-project `.mcp-tasks.json` → global config.

**Write protocol:** SQLite transaction commits first, then markdown atomic rename, then index.yaml atomic rename. If the process dies between steps, the next reconcile corrects it.

### Phase 1b — MCP Server + 20 Tools
The interface agents use.

**Server:** `src/server.ts` — MCP stdio server using `@modelcontextprotocol/sdk`. Routes all 20 tools. Each tool file exports `{ name, description, schema, execute }`.

**Core CRUD (6):**
- `task-create` — create task, validate inputs, check circular deps
- `task-get` — fetch by ID
- `task-list` — filter by status/project/type, default limit 50
- `task-update` — explicit allowlist (rejects `status` — use transition instead)
- `task-delete` — archives to `archive/` subdirectory
- `task-search` — FTS5 full-text search

**Workflow (6):**
- `task-next` — returns the highest-priority ready task with no unresolved dependencies
- `task-claim` — TOCTOU-safe claim with TTL (default 4h); second claim returns `{ claimed: false }`
- `task-release` — releases a claim back to the pool
- `task-transition` — state machine transitions with reason logging; auto-derives parent status from children
- `task-add-subtask` — appends inline subtask (max 10)
- `task-promote-subtask` — converts inline subtask to a full task file with parent linkage

**Git integration (3):**
- `task-link-commit` — idempotent by sha; appends to `git.commits[]`
- `task-link-pr` — sets PR metadata; if `state=merged` auto-transitions task to `done`
- `task-link-branch` — sets `git.branch`

**Query/analytics (4):**
- `task-blocked-by` — which dependencies are not yet `done`
- `task-unblocks` — which tasks will become unblocked when this one completes
- `task-stale` — tasks `in_progress` past their TTL
- `task-stats` — counts by status, avg cycle time by type, completion rate

**Admin (3 tools + FileWatcher):**
- `task-init` — idempotent project init (dirs + `.gitignore` + config)
- `task-rebuild-index` — calls Reconciler; safe to run at any time
- `task-register-project` — adds project to global config
- `FileWatcher` — chokidar watcher with 200ms debounce; re-indexes on external file changes (e.g., `git pull`)

### Phase 1c — CLI, Hooks, Packaging

**CLI** (`src/cli.ts`, 12 commands):
- `init <prefix>` — set up a project
- `serve` — start MCP stdio server
- `list` — show tasks (table or JSON)
- `next <project>` — print next task
- `status` — cross-project summary table
- `install-hooks` — installs git hooks with chaining support
- `install-claude-hooks` — installs task-gate into `~/.claude/hooks/`
- `rebuild-index` — reconcile markdown → SQLite
- `archive <id>` — archive a task
- `link-commit <id> <sha> <message>` — used by git hook
- `link-pr <id>` — shell to `gh pr view`, link PR metadata
- `migrate` — stub for future schema upgrades

**Enforcement Hook** (`hooks/task-gate.js`):
- Zero dependencies (Node builtins only)
- Plugs into Claude Code as PreToolUse hook
- Reads `index.yaml` directly (no MCP server round-trip)
- Blocks file edits if a task is `in_progress` and the agent hasn't claimed it
- `SKIP_TASK_GATE=1` env var bypasses (for orchestrators running approved plans)

**Git Hooks:**
- `hooks/post-commit.js` — extracts task ID from branch name, calls `link-commit`, optionally links PR via `gh`
- `hooks/prepare-commit-msg.js` — prepends `[TASK-ID]` to commit messages
- `install-hooks` chains safely with existing hooks using a `.d/` dispatcher

**Templates** (`src/templates/`): `feature.md`, `bug.md`, `spike.md`, `chore.md` — default task body with `{{TITLE}}`, `{{WHY}}`, `{{DATE}}` placeholders.

**Build:** tsup dual ESM + CJS. `dist/cli.js` (13KB), `dist/server.js` (73KB). npm pack includes `dist/`, `hooks/`, `schema/`, `src/templates/`, `README.md`. Native module `better-sqlite3` is external (not bundled).

---

## Test Coverage

| Suite | Files | Tests |
|-------|-------|-------|
| Unit — store layer | 7 | ~80 |
| Unit — tool handlers | 5 | ~70 |
| Integration — lifecycle, concurrency, circular deps, subtask promotion, rebuild | 5 | ~25 |
| Performance — 500-task bulk create + query | 1 | 4 |
| **Total** | **17** | **231 passing** |

4 tests skipped (file-watcher integration — requires chokidar timing, marked `.skip` pending CI tuning).

---

## Known Gaps / Not Yet Built

- **Visualization layer** — no dashboard or graph output yet
- **Cross-project support in CLI** — `status` command iterates projects but init/list default to single project
- **`autoCommit`** — config flag exists, not yet wired in (would auto-`git add + commit` after each task write)
- **`migrate` command** — stub only; schema is v1 and has no migrations yet
- **File-watcher integration tests** — skipped; need OS-level timing guarantees
- **`export` command** — in spec, not yet implemented in CLI
- **Landing page / npm publish** — package is ready but not published

---

## How to Use (Quick Reference)

```bash
# Install
npm install -g agent-tasks

# Init a project
agent-tasks init MYPROJECT --path ./tasks

# Configure Claude Code MCP (in .claude/mcp.json or settings)
{ "mcpServers": { "tasks": { "command": "agent-tasks", "args": ["serve"] } } }

# Install git hooks in current repo
agent-tasks install-hooks

# Install Claude Code enforcement hook
agent-tasks install-claude-hooks

# Day-to-day
agent-tasks list --project MYPROJECT
agent-tasks next MYPROJECT
agent-tasks status
```

---

## Repository Layout

```
C:/code/mcp-agent-tasks/
  src/
    types/          — TypeScript interfaces (task, errors, config, tools, transitions)
    store/          — MarkdownStore, SqliteIndex, TaskStore, TaskFactory, Reconciler, etc.
    tools/          — 20 MCP tool handler files
    config/         — ConfigLoader
    templates/      — feature/bug/spike/chore markdown templates
    server.ts       — MCP stdio server entry point
    cli.ts          — Commander CLI entry point
  schema/
    task.schema.json
    config.schema.json
  hooks/
    task-gate.js    — Claude Code PreToolUse hook
    post-commit.js  — git post-commit
    prepare-commit-msg.js
  tests/
    fixtures/       — HERALD-001..003 + corrupt
    unit/           — store + tools unit tests
    integration/    — full lifecycle tests
    perf/           — 500-task benchmarks
  dist/             — built output (ESM + CJS)
  README.md
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
```
