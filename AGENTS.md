# MCP Agent Tasks — Agent Instructions

Cross-vendor agent guidance. Mirrors key commands and conventions from `CLAUDE.md`.

File-based task management for AI coding agents. Hybrid markdown/SQLite store with 22 MCP tools over stdio. Tasks live as plain markdown files (human-readable, git-trackable) with a SQLite index for fast queries.

## Setup

```bash
npm install
```

## Commands

| Task | Command |
|------|---------|
| Build (ESM + CJS dual) | `npm run build` |
| Type-check (mandatory gate) | `npm run type-check` |
| Test | `npm test` (unit + integration + perf) |
| Test with coverage | `npm run test:coverage` |
| Start MCP stdio server | `agent-tasks serve` |
| Init project for tracking | `agent-tasks init <PREFIX>` |
| List tasks | `agent-tasks list` |
| Next actionable task | `agent-tasks next <PROJECT>` |
| Cross-project summary | `agent-tasks status` |
| Rebuild SQLite from markdown | `agent-tasks rebuild-index` |
| Install git hooks | `agent-tasks install-hooks` |
| Install Claude Code hook | `agent-tasks install-claude-hooks` |

## Tech Stack

- Node.js >=18, TypeScript strict
- `better-sqlite3` (ephemeral index; delete to rebuild from markdown)
- `@modelcontextprotocol/sdk` (stdio server)
- Commander CLI for humans
- vitest, tsup (ESM + CJS dual build)

## Repo Structure

```
src/
  types/      TypeScript interfaces (task, errors, config, tools, transitions)
  store/      MarkdownStore, SqliteIndex, TaskStore, Reconciler, ConfigLoader
  tools/      22 MCP tool handler files
  config/     ConfigLoader (env → ~/.config/mcp-tasks/config.json)
  templates/  feature/bug/spike/chore markdown templates
  server.ts   MCP stdio server entry point
  cli.ts      Commander CLI entry point
hooks/
  task-gate.js           Claude Code PreToolUse enforcement (reads index.yaml, zero deps)
  post-commit.js         Auto-links commits to tasks via branch name
  prepare-commit-msg.js  Prepends [TASK-ID] to commit messages
tests/
  fixtures/ unit/ integration/ perf/
```

## Critical Conventions

- **Markdown is the source of truth** — SQLite is a derived, rebuildable index. Delete the .db file and it rebuilds.
- **Atomic writes** — temp-file rename pattern (POSIX + NTFS safe). Never partial writes.
- **Write protocol order** — (1) SQLite transaction commits → (2) markdown atomic rename → (3) index.yaml atomic rename. Reconcile corrects mid-failure state.
- **Strict TypeScript** — no `any`, use `unknown` and narrow
- **Per-project task ID prefixes** — e.g. `HBOOK-001`, `COND-047`, `MCPAT-012`; see global MEMORY for registry
- **State machine** — `queued` → `in_progress` → `done | blocked | cancelled`
- **Hard limits** — max 10 subtasks per task, max 100 transitions, max 50 commits in git.commits[]
- **Escape hatch** — `SKIP_TASK_GATE=1` bypasses the Claude Code enforcement hook (for orchestrators executing approved plans)

## Done Criteria

- [ ] `npm run type-check` passes
- [ ] `npm test` passes (unit + integration + perf)
- [ ] `npm run build` produces both ESM and CJS in `dist/`
- [ ] No `any` types added
- [ ] Atomic write order preserved (sqlite → md → index.yaml)
- [ ] No partial-write paths introduced
