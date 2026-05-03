# Task Lifecycle Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five independent gaps that cause tasks to be created at planning time but never progressed through build, link, or done — making the entire tracking system cosmetic.

**Architecture:** Fix is split across (a) hook wiring in Claude Code settings, (b) project init for conductor/nash-ai, (c) skill updates for ship/build lifecycle, (d) git hook fallback for commit-message task ID lookup, and (e) a bulk reconcile script for stuck tasks.

**Tech Stack:** Node.js, Claude Code settings.json hooks, mcp-agent-tasks CLI, Bash/PowerShell scripts.

---

## Root Cause Summary

Five independent failure points were confirmed by investigation:

| RC# | Gap | Evidence |
|-----|-----|---------|
| RC1 | `task-gate.js` NOT in Claude Code PreToolUse hooks | settings.json lists 9 PreToolUse hooks — none is task-gate |
| RC2 | Ship skills have zero `task_` calls | `acr-ship`, `conductor-ship`, `handbook-ship`, `ship` all 0 refs; `task_link_pr` never called anywhere |
| RC3 | Branch names don't include task IDs | Hooks regex `/([A-Z]+-\d+)/i` never matches `feat/observability-completion` style names |
| RC4 | Conductor has no `.mcp-tasks.json` | Git hooks fast-exit for conductor; all automation dead |
| RC5 | Build skills have no task lifecycle calls | 9 plan-phase skills create tasks; `build`, `acr-build`, `conductor-build` never claim or progress them |

**Result:** 62 COND + 54 ACR tasks permanently stuck `in_progress`. 0/0 PRs linked across any project. Today: 2 conductor PRs merged + 5 ACR commits — zero task updates.

---

## File Map

**Modified:**
- `~/.claude/settings.json` — add task-gate to PreToolUse
- `~/.claude/skills/ship.md` — add task_link_pr + task_link_branch steps
- `~/.claude/skills/acr-ship.md` — same
- `~/.claude/skills/conductor-ship.md` — same
- `~/.claude/skills/handbook-ship.md` — same
- `~/.claude/skills/build.md` — add task claim + commit linking
- `~/.claude/skills/acr-build.md` — same
- `~/.claude/skills/conductor-build.md` — same
- `~/.claude/CLAUDE.md` — branch naming convention + NASH prefix
- `~/.claude/git-hooks/post-commit.js` — add commit-message fallback for task ID lookup

**Created:**
- `C:/code/conductor/.mcp-tasks.json` — init conductor for hook wiring
- `C:/code/nash-ai/agent-tasks/` — init nash-ai task tracking
- `C:/code/nash-ai/.mcp-tasks.json` — init nash-ai for hook wiring
- `C:/code/mcp-agent-tasks/scripts/reconcile-stuck-tasks.js` — bulk reconcile script

---

## Task 1: Wire task-gate.js into Claude Code PreToolUse (RC1)

**Files:**
- Modify: `C:/Users/micha/.claude/settings.json`

The hook at `C:/code/mcp-agent-tasks/hooks/task-gate.js` exits with code 2 (block) when a code file edit has no `in_progress` task. It's built and correct but not wired. This is the single highest-leverage fix — it immediately starts enforcing the lifecycle for every project.

- [ ] **Step 1: Read current settings.json PreToolUse section**

```bash
python3 -c "
import json
with open('C:/Users/micha/.claude/settings.json') as f:
    d = json.load(f)
print(json.dumps(d.get('hooks', {}).get('PreToolUse', []), indent=2))
"
```

- [ ] **Step 2: Add task-gate to PreToolUse in settings.json**

Open `C:/Users/micha/.claude/settings.json`. Find the `hooks.PreToolUse` array. Add this entry as the **last** item (so existing hooks run first, task-gate fires just before edits commit):

```json
{
  "matcher": "Edit|Write|MultiEdit",
  "hooks": [
    {
      "type": "command",
      "command": "C:/Users/micha/.claude/hooks/node-hidden.exe C:/code/mcp-agent-tasks/hooks/task-gate.js",
      "timeout": 3000
    }
  ]
}
```

> **Security note:** This hook executes a script from `C:/code/mcp-agent-tasks/hooks/task-gate.js` on every matching tool call. Verify ownership before wiring:
> ```powershell
> # Check owner AND verify no broad write access (Everyone / Users / Authenticated Users)
> $acl = Get-Acl "C:\code\mcp-agent-tasks\hooks\task-gate.js"
> Write-Host "Owner:" $acl.Owner
> $acl.Access | Where-Object {
>   $_.IdentityReference -match 'Everyone|Users|Authenticated Users|BUILTIN\\Users' -and
>   $_.FileSystemRights -match 'Write|Modify|FullControl'
> } | ForEach-Object { Write-Warning "RISKY ACL: $($_.IdentityReference) has $($_.FileSystemRights)" }
> # Expected: Owner is current user; no WARNING lines printed.
> # If warnings appear: fix ACLs with icacls or do not wire this hook.
> ```
> The hook has no network access and only reads `index.yaml` — it does not write files or call external APIs.

> **Known limitation — Bash bypass:** The `Edit|Write|MultiEdit` matcher gates the Claude Code file-editing tools. Code changes made via the `Bash` tool (e.g. `sed`, `awk`, `tee`, `git apply`) are not intercepted by this hook. This is a constraint of the Claude Code PreToolUse hook system, not a fixable gap in this plan. The gate covers the primary agent editing vector; Bash-based writes are considered out of scope.

- [ ] **Step 3: Verify task-gate.js is built**

```bash
ls C:/code/mcp-agent-tasks/hooks/task-gate.js
```

Expected: file exists (it's a raw Node script — no build needed, it reads from `hooks/` not `dist/`).

- [ ] **Step 4: Smoke-test the hook manually**

```bash
cd C:/code/conductor
echo '{"tool_name":"Edit","tool_input":{"file_path":"src/test.ts"}}' | node C:/code/mcp-agent-tasks/hooks/task-gate.js
echo "Exit code: $?"
```

Expected: exit 0 (silent pass — `.mcp-tasks.json` is absent so the hook fast-exits without blocking). After Task 2 completes and `.mcp-tasks.json` exists, re-run and expect exit 2 (blocked, no in_progress task) or a warning.

- [ ] **Step 5: Commit settings change**

```bash
cd C:/Users/micha/.claude
git add settings.json
git commit -m "feat(hooks): wire task-gate.js into Claude Code PreToolUse"
```

If `.claude` is not a git repo, skip commit — the file is already saved.

- [ ] **Step 6: Verify the hook doesn't block non-task-tracked projects**

Test in a project that does NOT have `.mcp-tasks.json` (e.g. `C:/code/context-window`):

```bash
cd C:/code/context-window
echo '{"tool_name":"Edit","tool_input":{"file_path":"src/test.ts"}}' | node C:/code/mcp-agent-tasks/hooks/task-gate.js
echo "Exit code: $?"
```

Expected: exit 0 (fast-exit — no `.mcp-tasks.json` found, hook is silent for non-participating repos).

**Rollback:** If the hook causes unexpected blocking across unrelated projects, remove the entry from `settings.json` PreToolUse array and restart Claude Code. The hook only blocks on repos that have `.mcp-tasks.json` — if something goes wrong, removing the hook entry fully restores prior behaviour.

**Compensating control for Bash bypasses:** Even if a Bash write bypasses this gate, the global `post-commit.js` hook runs on every commit and attempts to link it to a task via branch name or commit message. This provides a second-pass linkage opportunity that partially compensates for the Bash bypass gap.

---

## Task 2: Initialize conductor for task tracking (RC4)

**Files:**
- Create: `C:/code/conductor/.mcp-tasks.json`

Conductor is the most active project (163 task files, 2 PRs today) but has zero git hook integration because `.mcp-tasks.json` is missing.

**Why `.mcp-tasks.json` is sufficient (no `.git/hooks/` installation needed):** Global git hooks are already wired via `git config --global core.hooksPath = C:/Users/micha/.claude/git-hooks`. These hooks fire for every commit on this machine. However, both `post-commit.js` and `post-merge.js` walk up from the repo root looking for `.mcp-tasks.json` and immediately `process.exit(0)` if not found. Creating `.mcp-tasks.json` is the correct and only fix needed — it tells the already-running global hook that this repo participates in task tracking.

- [ ] **Step 1: Verify global hooks path — do NOT overwrite an existing value blindly**

```bash
git config --global core.hooksPath
```

**Three cases:**
- **Output is `C:/Users/micha/.claude/git-hooks`** — already correct, proceed.
- **Output is empty** — safe to set: `git config --global core.hooksPath "C:/Users/micha/.claude/git-hooks"`
- **Output is a different path** — Do not overwrite. Investigate what's in that path:
  ```bash
  ls <existing-hooksPath>
  ```
  Then merge by creating a thin wrapper. For each conflicting hook name (e.g. `post-commit`), create a wrapper in the existing directory that calls both:
  ```bash
  # In <existing-hooksPath>/post-commit (if the file already exists, wrap it)
  #!/bin/sh
  # Run existing hook logic first
  <existing-logic-or-source-existing-file>
  # Then run agent-tasks hook
  node "C:/Users/micha/.claude/git-hooks/post-commit.js"
  ```
  If no conflict (the existing path has no `post-commit` or `post-merge`), create executable wrapper files **without the `.js` extension** — git requires exactly `post-commit` and `post-merge`:
  ```bash
  # Copy and make executable — git looks for 'post-commit', not 'post-commit.js'
  cp "C:/Users/micha/.claude/git-hooks/post-commit.js" "<existing-path>/post-commit"
  cp "C:/Users/micha/.claude/git-hooks/post-merge.js" "<existing-path>/post-merge"
  chmod +x "<existing-path>/post-commit" "<existing-path>/post-merge"
  ```
  In both cases, test with `git commit --allow-empty -m "test"` and verify the agent-tasks hook fires.

- [ ] **Step 2: Run agent-tasks init for conductor**

```bash
cd C:/code/conductor
node C:/code/mcp-agent-tasks/dist/cli.js init COND
```

Expected: creates `C:/code/conductor/.mcp-tasks.json` with COND prefix and local storage config.

- [ ] **Step 3: Verify the file was created correctly**

```bash
cat C:/code/conductor/.mcp-tasks.json
```

Expected output (approximately):
```json
{
  "version": 1,
  "tasksDirName": "agent-tasks",
  "projects": [
    {
      "prefix": "COND",
      "path": "C:\\code\\conductor",
      "storage": "local"
    }
  ]
}
```

- [ ] **Step 4: Test that the hook now blocks for conductor**

```bash
cd C:/code/conductor
echo '{"tool_name":"Edit","tool_input":{"file_path":"src/test.ts"}}' | node C:/code/mcp-agent-tasks/hooks/task-gate.js
echo "Exit code: $?"
```

Expected: exit 2 (blocked — `.mcp-tasks.json` found but no `in_progress` task). This confirms the hook now fires instead of fast-exiting.

- [ ] **Step 5: Commit**

```bash
cd C:/code/conductor
git add .mcp-tasks.json
git commit -m "chore: initialize agent-tasks tracking (COND prefix)"
```

---

## Task 3: Initialize nash-ai for task tracking

**Files:**
- Create: `C:/code/nash-ai/.mcp-tasks.json`
- Create: `C:/code/nash-ai/agent-tasks/` directory

Nash-ai has zero task infrastructure. Define prefix as `NASH`.

- [ ] **Step 1: Run agent-tasks init for nash-ai**

```bash
cd C:/code/nash-ai
node C:/code/mcp-agent-tasks/dist/cli.js init NASH
```

Expected: creates `.mcp-tasks.json` and `agent-tasks/` directory.

- [ ] **Step 2: Verify and ensure agent-tasks/ is trackable**

```bash
cat C:/code/nash-ai/.mcp-tasks.json
ls C:/code/nash-ai/agent-tasks/
```

Git does not track empty directories. If `init NASH` created an empty `agent-tasks/` with no files, add a placeholder so the directory persists in the repo:

```bash
# Check if agent-tasks/ is empty
ls C:/code/nash-ai/agent-tasks/

# If empty (only index.yaml or nothing), verify index.yaml exists:
ls C:/code/nash-ai/agent-tasks/index.yaml 2>/dev/null || \
  echo '{}' > C:/code/nash-ai/agent-tasks/index.yaml
```

An `index.yaml` (even empty) is sufficient — the agent-tasks CLI creates it on first use.

- [ ] **Step 3: Add NASH prefix to CLAUDE.md prefix registry**

Open `C:/Users/micha/.claude/CLAUDE.md`. Find the `**Project prefixes**` table under Task Management. Add:

```
| nash-ai | NASH |
```

- [ ] **Step 4: Commit nash-ai files**

```bash
cd C:/code/nash-ai
git add .mcp-tasks.json agent-tasks/
git commit -m "chore: initialize agent-tasks tracking (NASH prefix)"
```

- [ ] **Step 5: Commit CLAUDE.md prefix registry change separately**

The CLAUDE.md lives in `~/.claude/` which is a separate repo (or unversioned file). Commit or save it explicitly:

```bash
cd C:/Users/micha/.claude
git add CLAUDE.md
git commit -m "chore: add NASH prefix to agent-tasks project registry"
```

If `~/.claude` is not a git repo, verify the change was saved by re-reading the file:
```bash
grep "NASH" C:/Users/micha/.claude/CLAUDE.md
```
Expected: `| nash-ai | NASH |`

---

## Task 4: Add task_link_pr to all ship skills (RC2)

**Files:**
- Modify: `~/.claude/skills/ship.md`
- Modify: `~/.claude/skills/acr-ship.md`
- Modify: `~/.claude/skills/conductor-ship.md`
- Modify: `~/.claude/skills/handbook-ship.md`

Every ship skill currently has zero task lifecycle calls. Pattern is the same for all four skills.

**MCP tool call clarification:** All `task_*` references in these skill steps are **MCP tool calls** via the globally registered `tasks` MCP server — not CLI commands. In Claude Code context, these are invoked as tool use (e.g. calling `task_link_branch` with `{task_id: "COND-047", branch: "feat/COND-047-..."}` as structured input). If a task ID cannot be found (empty branch, no matching commit), skip the link call and proceed — do not block the PR creation.

When editing each skill, use this exact wording to refer to MCP calls:
> Call the `task_link_branch` MCP tool with `task_id` and `branch` fields.
> Call the `task_link_pr` MCP tool with `task_id` and `pr_number` fields.

- [ ] **Step 1: Read ship.md to find the PR creation step**

```bash
grep -n "gh pr create\|pull request\|PR\|task_" C:/Users/micha/.claude/skills/ship.md | head -20
```

- [ ] **Step 2: Add task lifecycle steps to ship.md — BEFORE and AFTER gh pr create**

Two separate insertions are needed. `task_link_branch` goes **before** PR creation (no PR number needed). `task_link_pr` goes **after** PR creation (requires the PR number returned by `gh pr create`).

**Insert BEFORE `gh pr create`:**

```markdown
### Pre-PR: link task to branch

Before creating the PR, resolve the task ID and link the branch. This allows post-merge auto-transition to `done`.

1. Find the task ID:
   ```bash
   BRANCH=$(git branch --show-current)
   TASK_ID=$(echo "$BRANCH" | grep -oE '[A-Z]+-[0-9]+' | head -1)
   # Fallback: scan recent commit messages
   if [ -z "$TASK_ID" ]; then
     TASK_ID=$(git log --oneline -5 | grep -oE '[A-Z]+-[0-9]+' | head -1)
   fi
   echo "Task ID: $TASK_ID"
   ```

2. If TASK_ID is non-empty, call the `task_link_branch` MCP tool with `task_id` and `branch` fields.

3. If TASK_ID is empty after both lookups: **warn but do not block.** Print a message:
   > ⚠️  No task ID found for this branch. PR will be created without task linkage — post-merge auto-transition will not fire. Create a task manually and call `task_link_pr` after PR creation if needed.

   Continue with PR creation regardless.
```

**Insert AFTER `gh pr create` (once the PR URL/number is known):**

```markdown
### Post-PR-create: link PR number to task

After `gh pr create` prints the PR URL, extract the PR number:

```bash
PR_NUMBER=$(gh pr view --json number -q .number)
```

If `TASK_ID` (from the pre-PR step) is **non-empty**, call the `task_link_pr` MCP tool with `task_id` and `pr_number` fields.

If `TASK_ID` is **empty**, skip this call entirely — do not call `task_link_pr` with an empty or invalid task ID. The warning from the pre-PR step is sufficient.
```

- [ ] **Step 3: Apply same change to acr-ship.md, conductor-ship.md, handbook-ship.md**

```bash
# Read each to find their PR creation step
grep -n "gh pr create\|pull request\|task_" C:/Users/micha/.claude/skills/acr-ship.md | head -10
grep -n "gh pr create\|pull request\|task_" C:/Users/micha/.claude/skills/conductor-ship.md | head -10
grep -n "gh pr create\|pull request\|task_" C:/Users/micha/.claude/skills/handbook-ship.md | head -10
```

Add the same `task_link_pr` step to each, adapted to their specific PR creation step location.

- [ ] **Step 4: Verify no skill was missed**

```bash
grep -l "gh pr create" C:/Users/micha/.claude/skills/*.md | xargs grep -L "task_link_pr"
```

Expected: empty output (all skills that create PRs now reference task_link_pr).

- [ ] **Step 5: No commit needed** (skills are files in `~/.claude/skills/` — not in a git repo that needs committing; changes take effect immediately)

---

## Task 5: Fix branch naming convention + commit-message fallback (RC3)

**Files:**
- Modify: `~/.claude/CLAUDE.md` — add branch naming rule
- Modify: `~/.claude/git-hooks/post-commit.js` — add commit-message fallback

Branch names like `feat/observability-completion` never match the task ID regex `/([A-Z]+-\d+)/i`. Two fixes: (a) enforce task ID in branch names going forward, (b) add commit-message fallback so existing non-conforming branches still get linked.

- [ ] **Step 1: Add branch naming rule to CLAUDE.md git section**

Find the `## Git (Universal)` section. Add after the GOLDEN RULE line:

```markdown
- **Branch naming must include task ID**: Use format `feat/COND-047-short-description` or `fix/HBOOK-012-bug-name`. The task ID segment is required — git hooks use it to auto-link commits to tasks. Without it, no commit or post-merge linkage fires.
```

- [ ] **Step 2: Read post-commit.js to find the task ID extraction section**

```bash
grep -n "branch\|taskId\|A-Z\|regex" C:/Users/micha/.claude/git-hooks/post-commit.js | head -30
```

- [ ] **Step 3: Add commit-message fallback to post-commit.js**

Find where the hook extracts the task ID from the branch name. After that extraction, add a fallback that reads the most recent commit message:

```javascript
// Primary: extract from branch name
let taskId = (branch.match(/([A-Z]+-\d+)/i) || [])[1] || null;

// Fallback: scan last commit message for task ID
if (!taskId) {
  try {
    const commitMsg = execSync('git log -1 --format=%s', { encoding: 'utf-8' }).trim();
    const match = commitMsg.match(/([A-Z]+-\d+)/i);
    if (match) taskId = match[1].toUpperCase();
  } catch (_) {}
}

if (!taskId) process.exit(0); // No task ID found anywhere — skip silently
```

- [ ] **Step 4: Test the fallback**

```bash
cd C:/code/conductor
# Simulate: set branch to a name without task ID, but last commit has COND-047 in message
# Just verify the regex logic works
node -e "
const msg = 'feat(observability): Sentry scrubber — COND-047';
const match = msg.match(/([A-Z]+-\d+)/i);
console.log('Found:', match ? match[1] : 'none');
"
```

Expected: `Found: COND-047`

- [ ] **Step 5: Commit post-commit.js change**

```bash
cd C:/Users/micha/.claude
git add git-hooks/post-commit.js
git commit -m "fix(git-hooks): add commit-message fallback for task ID extraction"
```

---

## Task 6: Add task lifecycle to build skills (RC5)

**Files:**
- Modify: `~/.claude/skills/build.md`
- Modify: `~/.claude/skills/acr-build.md`
- Modify: `~/.claude/skills/conductor-build.md`

The 9 plan-phase skills create tasks. But build skills never claim them or link commits. The gap is between `task_create` (planning) and `task_link_pr` (shipping) — builds are invisible.

- [ ] **Step 1: Read build.md to find its start/end sections**

```bash
head -40 C:/Users/micha/.claude/skills/build.md
tail -40 C:/Users/micha/.claude/skills/build.md
```

- [ ] **Step 2: Add task claim step to START of build.md**

At the beginning of the build skill (before any code changes), add:

```markdown
### Before starting: claim the task

1. Find the task for this work using `task_search` with the feature/bug title.

   **Handle all cases:**
   - **No results:** call `task_create` (type: feature/bug, priority: medium, why: one-sentence reason)
   - **One result, status `queued`:** call `task_transition` → `in_progress`, then `task_claim`
   - **One result, status `in_progress`, unclaimed:** call `task_claim` only (no transition needed)
   - **One result, status `in_progress`, already claimed:** check the branch name — if the branch matches this work, proceed without claiming (same task, different session). If the branch is unrelated, this is a different piece of work: call `task_create` for the current task instead.
   - **One result, status `done` or `cancelled`:** create a new task — the prior one is closed
   - **Multiple results:** pick the one whose title most closely matches the current work; if two are equally close, create a new task with a more specific title

   **Agent identity for `task_claim`:** pass the current agent role as the `claim_agent` field (e.g. `"builder"`, `"conductor-builder"`). Do not use a session-unique ID — role names are stable and sufficient for detecting concurrent builds.

2. Set the branch and link it:
   - Branch must include the task ID: `git checkout -b feat/TASK-NNN-short-description`
   - Call the `task_link_branch` MCP tool with `task_id` and `branch` fields
```

- [ ] **Step 3: Add commit-linking step AFTER each commit in build.md**

Find where build.md says to commit. After each commit instruction, add:

```markdown
- After committing, call `task_link_commit` with the task ID and the commit hash:
  ```bash
  git rev-parse HEAD  # copy this hash
  ```
  Then call `task_link_commit` with task ID and hash.
```

- [ ] **Step 4: Apply same changes to acr-build.md and conductor-build.md**

```bash
head -30 C:/Users/micha/.claude/skills/acr-build.md
head -30 C:/Users/micha/.claude/skills/conductor-build.md
```

Add identical task claim + commit-linking steps, adapted to each skill's specific section structure.

- [ ] **Step 5: Verify coverage**

```bash
grep -l "task_claim\|task_link_commit" C:/Users/micha/.claude/skills/build.md C:/Users/micha/.claude/skills/acr-build.md C:/Users/micha/.claude/skills/conductor-build.md
```

Expected: all three files listed.

---

## Task 7: Bulk reconcile stuck in_progress tasks

**Files:**
- Create: `C:/code/mcp-agent-tasks/scripts/reconcile-stuck-tasks.js`

62 COND + 54 ACR tasks are permanently stuck `in_progress`. Cross-reference merged PRs with task IDs to auto-link and transition what can be recovered.

- [ ] **Step 1: Write the reconcile script**

Create `C:/code/mcp-agent-tasks/scripts/reconcile-stuck-tasks.js`:

```javascript
#!/usr/bin/env node
// Reconciles stuck in_progress tasks against merged PRs.
// For each in_progress task, checks if a merged PR exists for a matching branch, title, or body.
// If found: calls task_link_pr (verified), then task_transition → done only on success.
// Run: node scripts/reconcile-stuck-tasks.js [--dry-run] [--project COND|ACR|HBOOK]

'use strict';
const { execSync, execFileSync } = require('child_process');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Fix: safe --project extraction — never accidentally picks up another flag
const projectIdx = args.indexOf('--project');
const projectFilter = (projectIdx !== -1 && args[projectIdx + 1] && !args[projectIdx + 1].startsWith('--'))
  ? args[projectIdx + 1]
  : null;

// Optional --since flag (ISO date YYYY-MM-DD, e.g. --since 2025-01-01) to extend PR lookback
const sinceIdx = args.indexOf('--since');
const sinceRaw = (sinceIdx !== -1 && args[sinceIdx + 1] && !args[sinceIdx + 1].startsWith('--'))
  ? args[sinceIdx + 1]
  : null;
// Strict ISO date validation — reject anything that isn't YYYY-MM-DD
const sinceDate = (sinceRaw && /^\d{4}-\d{2}-\d{2}$/.test(sinceRaw)) ? sinceRaw : null;
if (sinceRaw && !sinceDate) {
  console.error(`Error: --since must be a date in YYYY-MM-DD format, got: ${sinceRaw}`);
  process.exit(1);
}

const projects = {
  COND: 'C:/code/conductor',
  ACR: 'C:/code/acr-reimagined',
  HBOOK: 'C:/code/handbook',
};

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
  } catch {
    return null;
  }
}

// Configurable PR fetch limit. Default 200; use --limit N flag for deeper history.
const limitIdx = args.indexOf('--limit');
const prLimit = (limitIdx !== -1 && args[limitIdx + 1] && !isNaN(parseInt(args[limitIdx + 1], 10)))
  ? parseInt(args[limitIdx + 1], 10)
  : 200;

function getMergedPRs(repoDir) {
  // Use execFileSync with argument array to avoid shell injection.
  // sinceDate is validated as YYYY-MM-DD before reaching here.
  const ghArgs = ['pr', 'list', '--state', 'merged', '--limit', String(prLimit),
    '--json', 'number,title,headRefName,body'];
  if (sinceDate) ghArgs.push('--search', `merged:>${sinceDate}`);
  try {
    const result = execFileSync('gh', ghArgs, { encoding: 'utf-8', cwd: repoDir }).trim();
    return JSON.parse(result);
  } catch { return []; }
}

function getInProgressTasks(prefix, repoDir) {
  // Use the CLI to get tasks — avoids fragile YAML regex parsing
  const result = run(
    `node C:/code/mcp-agent-tasks/dist/cli.js list --status in_progress --project ${prefix} --format json`,
    { cwd: repoDir }
  );
  if (!result) return [];
  try {
    const parsed = JSON.parse(result);
    return Array.isArray(parsed) ? parsed : (parsed.tasks ?? []);
  } catch { return []; }
}

function preflight() {
  // Fail loudly on missing prerequisites instead of silently producing zero results
  const ghCheck = run('gh auth status');
  if (ghCheck === null) { console.error('Error: gh CLI not authenticated. Run: gh auth login'); process.exit(1); }
  const cliCheck = run('node C:/code/mcp-agent-tasks/dist/cli.js --version');
  if (cliCheck === null) { console.error('Error: agent-tasks CLI not built. Run: cd C:/code/mcp-agent-tasks && npm run build'); process.exit(1); }
}

async function main() {
  preflight();
  for (const [prefix, repoDir] of Object.entries(projects)) {
    if (projectFilter && prefix !== projectFilter) continue;
    console.log(`\n=== ${prefix} (${repoDir}) ===`);

    const tasks = getInProgressTasks(prefix, repoDir);
    const prs = getMergedPRs(repoDir);

    console.log(`  ${tasks.length} in_progress tasks, ${prs.length} merged PRs`);

    for (const task of tasks) {
      // Validate task ID shape before any shell interpolation
      const taskId = String(task.id ?? '');
      if (!/^[A-Z]+-\d+$/.test(taskId)) {
        console.log(`  SKIP: malformed task ID "${taskId}" — skipping`);
        continue;
      }

      // Three-tier match with confidence levels. Only EXACT matches auto-transition.
      // BODY matches are surfaced as warnings requiring human review — a PR body
      // can mention a task as "blocked by" or "related to" without completing it.
      const idUpper = taskId.toUpperCase();
      const exactMatch = prs.find(pr =>
        pr.headRefName?.toUpperCase().includes(idUpper) ||
        pr.title?.toUpperCase().includes(idUpper)
      );
      const bodyMatch = !exactMatch && prs.find(pr =>
        pr.body?.toUpperCase().includes(idUpper)
      );
      const matchedPR = exactMatch;

      // Validate PR number is a safe integer before shell interpolation
      const prNumber = matchedPR ? parseInt(String(matchedPR.number), 10) : NaN;

      if (matchedPR && !isNaN(prNumber)) {
        console.log(`  MATCH: ${taskId} → PR #${prNumber} (${matchedPR.headRefName})`);
        if (!dryRun) {
          console.log(`    → task_link_pr ${taskId} ${prNumber}`);
          const linkResult = run(
            `node C:/code/mcp-agent-tasks/dist/cli.js link-pr ${taskId} ${prNumber}`,
            { cwd: repoDir }
          );
          if (linkResult === null) {
            // link-pr failed — do NOT transition; leave task for manual review
            console.log(`    ✗ link-pr failed — skipping transition for ${taskId}`);
            continue;
          }
          console.log(`    → task_transition ${taskId} done`);
          const transResult = run(
            `node C:/code/mcp-agent-tasks/dist/cli.js transition ${taskId} done`,
            { cwd: repoDir }
          );
          if (transResult === null) {
            console.log(`    ✗ transition failed — ${taskId} is linked to PR but still in_progress; manual review needed`);
          }
        }
      } else if (bodyMatch) {
        // Body-only match: PR mentions task but may not complete it. Always print, never auto-apply.
        console.log(`  BODY-MATCH (review manually): ${taskId} → PR #${bodyMatch.number} — task ID found only in PR body, not branch/title. Do NOT auto-transition; verify this PR completes this task.`);
      } else {
        console.log(`  NO MATCH: ${taskId} — "${String(task.title ?? '').slice(0, 50)}" (leave as-is)`);
      }
    }
  }
  console.log('\nDone.' + (dryRun ? ' (dry run — no changes made)' : ''));
}

main().catch(console.error);
```

- [ ] **Step 2: Dry-run for conductor first**

```bash
node C:/code/mcp-agent-tasks/scripts/reconcile-stuck-tasks.js --dry-run --project COND
```

Expected: lists matched and unmatched tasks. Review the output before proceeding.

- [ ] **Step 3: Dry-run for ACR**

```bash
node C:/code/mcp-agent-tasks/scripts/reconcile-stuck-tasks.js --dry-run --project ACR
```

- [ ] **Step 4: Apply for COND (if dry-run looks correct)**

```bash
node C:/code/mcp-agent-tasks/scripts/reconcile-stuck-tasks.js --project COND
```

- [ ] **Step 5: Apply for ACR**

```bash
node C:/code/mcp-agent-tasks/scripts/reconcile-stuck-tasks.js --project ACR
```

- [ ] **Step 6: Verify task counts changed**

```bash
python3 -c "
import re
for proj, d in [('conductor','C:/code/conductor/agent-tasks'), ('acr','C:/code/acr-reimagined/agent-tasks')]:
    with open(f'{d}/index.yaml') as f: c = f.read()
    statuses = {}
    for m in re.finditer(r'status: (\w+)', c): statuses[m.group(1)] = statuses.get(m.group(1),0)+1
    print(proj, statuses)
"
```

Expected: `in_progress` count decreased, `done` count increased for matched tasks.

- [ ] **Step 7: Commit the script**

```bash
cd C:/code/mcp-agent-tasks
git add scripts/reconcile-stuck-tasks.js
git commit -m "chore(scripts): add reconcile-stuck-tasks for bulk PR linkage recovery"
```

---

## Self-Review

**Spec coverage:**
- RC1 (task-gate not wired) → Task 1 ✓
- RC2 (ship skills no task calls) → Task 4 ✓
- RC3 (branch names no task ID) → Task 5 ✓
- RC4 (conductor no .mcp-tasks.json) → Task 2 ✓
- RC4 equivalent (nash-ai) → Task 3 ✓
- RC5 (build skills no task lifecycle) → Task 6 ✓
- Stuck tasks reconcile → Task 7 ✓
- NASH prefix in CLAUDE.md → Task 3 step 3 ✓

**Placeholder scan:** No TBD or TODO items. All steps have exact file paths, commands, and expected outputs.

**Type consistency:** No TypeScript types in this plan — all Node.js scripts with plain objects.

**Order dependency check:**
- Task 1 (task-gate) and Task 2 (conductor init) should be done together — Task 1 before Task 2 will give exit 0 for conductor until Task 2 adds .mcp-tasks.json.
- Task 7 (reconcile) depends on `dist/cli.js` being built — verify `npm run build` passes in mcp-agent-tasks first.
- Tasks 4, 5, 6 (skill updates) are independent of each other and of the project inits.

**Codex spec review fixes applied (Round 1 → Round 2):**
- Task 1: matcher expanded from `Edit|Write` to `Edit|Write|MultiEdit`; security note added for hook script trust
- Task 2: clarified why `.mcp-tasks.json` is sufficient (global hooks already wired via `core.hooksPath`)
- Task 4: split into two separate insertions — `task_link_branch` BEFORE pr create, `task_link_pr` AFTER with PR number
- Task 7: fixed `--project` arg extraction (no longer accidentally picks up `--dry-run`)
- Task 7: replaced fragile YAML regex parsing with `agent-tasks list --format json` CLI call
- Task 7: `link-pr` result now checked before calling `transition` (no silent bad transitions)
- Task 7: PR matching now includes `body` field (catches historical PRs that mention task IDs in description)

**Round 2 → Round 3 fixes:**
- Task 1: Bash-tool bypass documented as known limitation (hook system constraint, not fixable in scope)
- Task 1 Step 4: corrected expected exit code (0 before init, 2 after init)
- Task 2: added Step 1 to verify `git config --global core.hooksPath` before relying on it
- Task 3: added Step 5 to explicitly commit/verify CLAUDE.md prefix registry change
- Task 4/6: clarified all `task_*` calls are MCP tool calls (not CLI), with exact field names
- Task 7: PR fetch limit raised to 200; pagination limitation noted
- Task 7: task ID validated against `/^[A-Z]+-\d+$/` before any shell interpolation
- Task 7: PR number validated as integer before shell interpolation
- Task 7: matching normalised to uppercase (case-insensitive)
- Task 7: `transition` result now checked; partial failure (linked but not transitioned) reported explicitly

**Round 3 → Round 4 fixes:**
- Task 7: body-only matches no longer auto-transition — printed as BODY-MATCH requiring manual review (false-positive risk)
- Task 1: rollback steps added; compensating control from post-commit hook documented; non-task-tracked project blast-radius test added
- Task 3: added check for empty `agent-tasks/` directory — ensures `index.yaml` exists so Git can track it
- Task 6: `task_search` disambiguation logic defined for all cases (no results, multiple results, non-queued status, already claimed)
- Task 4: missing task ID now explicitly "warn, don't block" (PR creation proceeds; linkage gap reported)

**Round 4 → Round 5 fixes:**
- Task 2 Step 1: core.hooksPath now checks for three cases — correct/absent/different — only sets when absent; stops with instructions if a different path exists
- Task 1: added actual `Get-Acl` PowerShell command to verify hook file ownership before wiring
- Task 7: added configurable `--limit N` flag (default 200); `--since DATE` support using `gh --search`; usage examples updated
- Task 6: "claimed by someone else" now resolved by branch-name check (same branch = proceed, different branch = new task); agent identity for `task_claim` defined as role name

**Round 5 → Round 6 fixes:**
- Task 7: `sinceDate` validated with strict `/^\d{4}-\d{2}-\d{2}$/` regex before use; exits with error if malformed
- Task 7: `getMergedPRs` switched from shell string interpolation to `execFileSync` with argument array (eliminates injection surface)
- Task 7: `preflight()` function added — fails loudly if `gh` not authenticated or CLI not built (prevents silent zero-result runs)
- Task 1: ACL check expanded — now verifies write permissions for `Everyone`/`Users`/`Authenticated Users` groups, not just owner
- Task 2 Step 1: merged-hooks approach now concrete — wrapper script pattern specified for conflicting hook names; copy-only path for non-conflicting case
- Task 4: post-PR-create step now explicitly skips `task_link_pr` when TASK_ID is empty
