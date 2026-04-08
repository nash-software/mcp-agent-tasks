![Node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![License MIT](https://img.shields.io/badge/license-MIT-blue)

# mcp-agent-tasks

File-based task management for AI coding agents. Hybrid markdown/SQLite store. 20 MCP tools over stdio.

Tasks live as plain markdown files on disk (readable, diffable, git-trackable) with a SQLite index for fast queries. Agents interact via the MCP protocol; humans can read and edit files directly.

## Install

```bash
npm install -g mcp-agent-tasks
# or run without installing:
npx -y mcp-agent-tasks serve
```

## Quick Start

```bash
# 1. Install globally
npm install -g mcp-agent-tasks

# 2. Initialise a project
cd my-project
mcp-agent-tasks init MYPROJECT --storage local

# 3. Configure your MCP client (see below)

# 4. Install git hooks
mcp-agent-tasks install-hooks

# 5. Install Claude Code task-gate hook (optional, recommended)
mcp-agent-tasks install-claude-hooks

# 6. Create your first task (via MCP tool or CLI)
mcp-agent-tasks list
```

## MCP Client Configuration

### Claude Code (`~/.claude/settings.json` or project `.mcp.json`)

```json
{
  "mcpServers": {
    "tasks": {
      "command": "mcp-agent-tasks",
      "args": ["serve"]
    }
  }
}
```

### Cursor / Windsurf

```json
{
  "mcpServers": {
    "tasks": {
      "command": "mcp-agent-tasks",
      "args": ["serve"]
    }
  }
}
```

## Git Hook Integration

Install hooks so commits and PRs are automatically linked to tasks:

```bash
# Install into .git/hooks/ (safe — chains with existing hooks)
mcp-agent-tasks install-hooks

# Install Claude Code PreToolUse hook (blocks edits while a task is in_progress)
mcp-agent-tasks install-claude-hooks
```

The `prepare-commit-msg` hook prepends `[PROJ-001]` to commit messages when the branch name contains a task ID.

The `post-commit` hook runs `link-commit` automatically after every commit.

Set `SKIP_TASK_GATE=1` to bypass the Claude Code gate when needed.

## Configuration Reference

`.mcp-tasks.json` (project-local) or `~/.config/mcp-tasks/config.json` (global):

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `version` | number | `1` | Config schema version |
| `storageDir` | string | `~/.mcp-tasks/tasks` | Where tasks are stored |
| `defaultStorage` | `local\|global` | `global` | Storage mode for new projects |
| `enforcement` | `warn\|block\|off` | `warn` | Task gate enforcement mode |
| `autoCommit` | boolean | `false` | Auto-commit task file changes |
| `claimTtlHours` | number | `4` | How long a claim is valid |
| `trackManifest` | boolean | `true` | Keep `index.yaml` git-tracked |
| `projects` | array | `[]` | Registered project configs |

## CLI Reference

| Command | Description |
|---------|-------------|
| `init <prefix>` | Initialise a project |
| `serve` | Start MCP stdio server |
| `list` | List tasks (supports `--status`, `--project`, `--limit`, `--format`) |
| `next <project>` | Get next actionable task |
| `status` | Cross-project summary table |
| `install-hooks` | Install git hooks |
| `install-claude-hooks` | Install Claude Code PreToolUse gate |
| `rebuild-index [project]` | Rebuild SQLite from markdown files |
| `archive <id>` | Archive a task |
| `link-commit <id> <sha> <msg>` | Link a commit to a task |
| `link-pr <id>` | Link current branch PR to a task |
| `migrate` | Run schema migrations (currently a no-op) |

## Spec

Full protocol spec: `schema/` directory in this package.
