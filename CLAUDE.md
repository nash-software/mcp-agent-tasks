# agent-tasks

File-based task management for AI coding agents. Hybrid markdown/SQLite store with 20 MCP tools over stdio.

Tasks live as plain markdown files on disk (human-readable, git-trackable) with a SQLite index for fast queries. Agents interact via the MCP protocol; humans can read and edit files directly.

## Tech Stack

- Node.js >=18, TypeScript (strict)
- SQLite (better-sqlite3) — ephemeral index; delete and it rebuilds from markdown
- MCP stdio server via `@modelcontextprotocol/sdk`
- Commander CLI for humans
- vitest for tests, tsup for ESM + CJS dual build

## Commands

- `npm run build` — Compile TypeScript to `dist/` (ESM + CJS via tsup)
- `npm run type-check` — TypeScript strict check (no emit)
- `npm test` — Run unit + integration + perf tests (vitest)
- `npm run test:coverage` — Run tests with V8 coverage
- `agent-tasks serve` — Start MCP stdio server
- `agent-tasks init <PREFIX>` — Initialise a project for task tracking
- `agent-tasks list` — List tasks (supports `--status`, `--project`, `--limit`, `--format`)
- `agent-tasks next <PROJECT>` — Get the next actionable task for a project
- `agent-tasks status` — Cross-project summary table
- `agent-tasks rebuild-index` — Reconcile markdown files into SQLite
- `agent-tasks install-hooks` — Install git hooks (prepare-commit-msg, post-commit)
- `agent-tasks install-claude-hooks` — Install Claude Code PreToolUse task-gate hook

## Architecture

```
src/
  types/          — TypeScript interfaces (task, errors, config, tools, transitions)
  store/          — MarkdownStore, SqliteIndex, TaskStore, TaskFactory, Reconciler, ConfigLoader
  tools/          — 20 MCP tool handler files (task-create, task-get, task-list, task-transition, etc.)
  config/         — ConfigLoader (env -> .mcp-tasks.json -> global config)
  templates/      — feature/bug/spike/chore markdown templates
  server.ts       — MCP stdio server entry point (registers all 20 tools)
  cli.ts          — Commander CLI entry point
schema/
  task.schema.json    — JSON Schema for task frontmatter
  config.schema.json  — JSON Schema for .mcp-tasks.json
hooks/
  task-gate.js           — Claude Code PreToolUse enforcement hook (reads index.yaml, zero deps)
  post-commit.js         — Auto-links commits to tasks via branch name
  prepare-commit-msg.js  — Prepends [TASK-ID] to commit messages
tests/
  fixtures/       — HERALD-001..003 + corrupt fixture
  unit/           — Store + tool handler unit tests (~150 tests)
  integration/    — Full lifecycle, concurrency, circular deps, subtask promotion (~25 tests)
  perf/           — 500-task benchmark (4 tests)
dist/             — Built output (ESM + CJS, not committed)
```

**Write protocol:** SQLite transaction commits first, then markdown atomic rename, then index.yaml atomic rename. If the process dies between steps, the next reconcile corrects it.

**MCP tools (20):** task-create, task-get, task-list, task-update, task-delete, task-search, task-next, task-claim, task-release, task-transition, task-add-subtask, task-promote-subtask, task-link-commit, task-link-pr, task-link-branch, task-blocked-by, task-unblocks, task-stale, task-stats, task-init, task-rebuild-index, task-register-project.

## Standards

- Strict TypeScript (`strict: true`), no `any`
- Markdown files are source of truth; SQLite is a derived, rebuildable index
- Atomic writes via temp-file rename (POSIX + NTFS safe)
- Task IDs use per-project prefixes (e.g., `HBOOK-001`). See global MEMORY for prefix registry.
- `SKIP_TASK_GATE=1` env var bypasses the Claude Code enforcement hook (for orchestrators)
- Task state machine: `queued` -> `in_progress` -> `done` | `blocked` | `cancelled`
- Max 10 subtasks per task; max 100 transitions; max 50 commits in git.commits[]

## Handbook Navigation

This project uses the handbook tool to maintain a structured knowledge graph.

- Run `handbook status` to see the current state of the knowledge graph
- Run `handbook query <terms>` to search for patterns, decisions, and flows
- Run `handbook init` to rebuild the handbook from source files
- Run `handbook diagnose` for health checks (add `--deep` for LLM-powered analysis)
- Run `handbook remediate` to generate actionable plans from diagnostic findings

The handbook is stored in `.handbook/` and tracked in git (except queue/lock files).
@.handbook/critical-rules.md
