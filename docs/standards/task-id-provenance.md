# Task-ID Provenance Standard

Every commit on a feature branch must carry the originating task ID. This lets the triage engine find evidence in git history and auto-resolve tasks without LLM calls.

## Rules

### 1. Branch naming
```
<type>/<PREFIX-NNN>-<short-slug>
```
Where `<type>` is one of: `feat`, `fix`, `chore`, `refactor`, `spike`, `docs`, `test`.

Examples:
- `feat/MCPAT-081-triage-reliability`
- `fix/HBOOK-012-null-ptr`
- `chore/COND-045-cleanup`

### 2. Commit messages
Every commit subject on the branch must begin with `[PREFIX-NNN]`:
```
[MCPAT-081] add runLlmBatchAdaptive for adaptive batch splitting
[MCPAT-081] lower default threshold from 0.85 to 0.75
```

The `prepare-commit-msg` hook enforces this automatically when the branch follows the naming convention above. No manual action required.

### 3. PR references
The PR title or description must reference the task ID. The pipeline creates the PR with the task ID linked automatically via `task_link_pr`.

## Why this matters

The triage engine (Tier-0) scans `git log --grep=<task-id>` to detect evidence that a task is complete. Without the ID in commits, the engine has no signal and must escalate to the slower Tier-2 LLM batch — or leave tasks unresolved indefinitely.

Commit provenance is the strongest signal available. An ID appearing in a commit on a merged PR is high-confidence evidence the task is done.

## Automatic enforcement

Install the hook into your project repo:
```bash
agent-tasks install-hooks --local --path /path/to/your/repo
```

Or into all registered project repos at once:
```bash
agent-tasks install-hooks --all-projects
```

The `prepare-commit-msg` hook will prepend `[PREFIX-NNN]` to any commit on a typed branch that is not already stamped. It is idempotent and never blocks a commit.

## Out of scope

- History rewrite / backfill of old commits — do not rewrite published commits.
- Branches without a typed prefix (e.g. `hotfix/xyz`, `main`) — hook is a no-op on these.
