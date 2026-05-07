# mcp-agent-tasks

A file-based task management system for AI coding agents, exposing 20 MCP tools over stdio. Tasks are stored as human-readable markdown files on disk with a SQLite index for fast queries; the index is always rebuildable from the markdown files.

## Language

**Task** — The primary unit of work. Stored as a markdown file with YAML frontmatter (id, status, type, priority, project prefix, links). Located at `agent-tasks/{PREFIX}-{NNN}.md`. The markdown file is the source of truth; the SQLite row is derived.

**Task ID** — A prefix-scoped sequential identifier: `{PREFIX}-{NNN}` (e.g. `HBOOK-042`). Prefixes are per-project and registered in the global memory. The prefix is part of the filename and used to scope queries.

**Task state machine** — The allowed lifecycle transitions: `queued` → `in_progress` → `done` | `blocked` | `cancelled`. Enforced by `task-transition`; invalid transitions are rejected.

**MarkdownStore** — The layer that reads and writes task markdown files (`src/store/`). Source of truth for all task data. Uses atomic temp-file rename writes for crash safety.

**SqliteIndex** — The derived fast-query layer (`src/store/`). Rebuilt from markdown on `rebuild-index`. Never authoritative — if it disagrees with markdown, markdown wins.

**TaskStore** — The facade over MarkdownStore + SqliteIndex that MCP tool handlers call. Coordinates the write protocol: SQLite transaction commits first, then markdown atomic rename, then `index.yaml` atomic rename.

**Write protocol** — The ordered write sequence: SQLite commit → markdown atomic rename → index.yaml atomic rename. If the process dies mid-sequence, the next reconcile corrects it.

**task-gate hook** — A Claude Code `PreToolUse` hook (`hooks/task-gate.js`) that blocks Edit/Write operations unless an `in_progress` task is claimed. Bypassed with `SKIP_TASK_GATE=1` for orchestrators.

**Subtask** — A child task linked to a parent task. Max 10 subtasks per task. Can be promoted to a top-level task via `task-promote-subtask`.

**Reconciler** — The component that scans all markdown files on disk and reconciles them into the SQLite index. Run via `rebuild-index` or automatically on startup if the index is missing.

## Relationships

- **MCP tool handlers** (`src/tools/`) call **TaskStore** → which coordinates **MarkdownStore** (source of truth) and **SqliteIndex** (derived cache).
- The **task-gate hook** reads `index.yaml` directly (zero Node.js dependencies) to check for a claimed `in_progress` task before allowing file edits.
- The **post-commit hook** extracts a **Task ID** from the branch name and calls `task-link-commit` to attach the commit SHA to the task's git history.
- **Subtasks** reference their parent **Task ID**; the **Reconciler** rebuilds these relationships from markdown frontmatter on index rebuild.
- The **CLI** (`src/cli.ts`) and the **MCP server** (`src/server.ts`) are two independent entry points to the same **TaskStore** — humans use the CLI, agents use MCP tools.

## Flagged ambiguities

- **"Index" is overloaded**: `SqliteIndex` (the in-process SQLite query layer) and `index.yaml` (the flat file read by the task-gate hook) are distinct artifacts. The hook reads `index.yaml` not the SQLite database, to avoid a Node.js dependency in the hook process.
- **Source of truth vs fast path**: "Markdown is source of truth" means the SQLite index can always be discarded and rebuilt. It does NOT mean SQLite writes can be skipped — the write protocol always writes SQLite first for transactional safety, then markdown.
- **MCP tool count**: The CLAUDE.md header says "20 MCP tools" but the tools list in the architecture section enumerates 22 names. The canonical count is whatever `src/tools/` contains; 20 is the stable public contract.
