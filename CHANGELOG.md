# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-04-11

### Added

- File-based task management with markdown files and YAML frontmatter
- SQLite index for fast queries across tasks
- 20 MCP tools over stdio protocol (create, transition, claim, search, link, archive, etc.)
- CLI with `init`, `serve`, `list`, `next`, `status`, `rebuild-index`, `archive` commands
- Git hook integration: `prepare-commit-msg` (task ID prefix) and `post-commit` (auto link-commit)
- Claude Code PreToolUse hook for task-gate enforcement
- Task lifecycle: `backlog` → `ready` → `in_progress` → `review` → `done`
- Dependency graph with circular dependency detection
- Subtask support with promotion workflow
- Cross-project task management with configurable prefixes
- Manifest writer for git-tracked `index.yaml`
- Legacy scratchpad reconciliation and import
- Dual ESM/CJS build output
- 283 tests (unit + integration)
