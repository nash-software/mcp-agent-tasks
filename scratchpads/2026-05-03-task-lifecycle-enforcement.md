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
  "matcher": "Edit|Write",
  "hooks": [
    {
      "type": "command",
      "command": "C:/Users/micha/.claude/hooks/node-hidden.exe C:/code/mcp-agent-tasks/hooks/task-gate.js",
      "timeout": 3000
    }
  ]
}
```

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

Expected: exit 2 (blocked — no in_progress task for conductor since it has no .mcp-tasks.json yet). After Task 2 completes, re-run and expect a warning instead.

- [ ] **Step 5: Commit settings change**

```bash
cd C:/Users/micha/.claude
git add settings.json
git commit -m "feat(hooks): wire task-gate.js into Claude Code PreToolUse"
```

If `.claude` is not a git repo, skip commit — the file is already saved.

---

## Task 2: Initialize conductor for task tracking (RC4)

**Files:**
- Create: `C:/code/conductor/.mcp-tasks.json`

Conductor is the most active project (163 task files, 2 PRs today) but has zero git hook integration because `.mcp-tasks.json` is missing.

- [ ] **Step 1: Run agent-tasks init for conductor**

```bash
cd C:/code/conductor
node C:/code/mcp-agent-tasks/dist/cli.js init COND
```

Expected: creates `C:/code/conductor/.mcp-tasks.json` with COND prefix and local storage config.

- [ ] **Step 2: Verify the file was created correctly**

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

- [ ] **Step 3: Test that post-commit hook now fires for conductor**

```bash
cd C:/code/conductor
echo '{"tool_name":"Edit","tool_input":{"file_path":"src/test.ts"}}' | node C:/code/mcp-agent-tasks/hooks/task-gate.js
echo "Exit code: $?"
```

Expected: exit 2 or a warning message (no longer silent exit 0).

- [ ] **Step 4: Commit**

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

- [ ] **Step 2: Verify**

```bash
cat C:/code/nash-ai/.mcp-tasks.json
ls C:/code/nash-ai/agent-tasks/
```

- [ ] **Step 3: Add NASH prefix to CLAUDE.md prefix registry**

Open `C:/Users/micha/.claude/CLAUDE.md`. Find the `**Project prefixes**` table under Task Management. Add:

```
| nash-ai | NASH |
```

- [ ] **Step 4: Commit both**

```bash
cd C:/code/nash-ai
git add .mcp-tasks.json agent-tasks/
git commit -m "chore: initialize agent-tasks tracking (NASH prefix)"
```

---

## Task 4: Add task_link_pr to all ship skills (RC2)

**Files:**
- Modify: `~/.claude/skills/ship.md`
- Modify: `~/.claude/skills/acr-ship.md`
- Modify: `~/.claude/skills/conductor-ship.md`
- Modify: `~/.claude/skills/handbook-ship.md`

Every ship skill currently has zero task lifecycle calls. `task_link_pr` must be called before `gh pr create`. Pattern is the same for all four skills.

- [ ] **Step 1: Read ship.md to find the PR creation step**

```bash
grep -n "gh pr create\|pull request\|PR\|task_" C:/Users/micha/.claude/skills/ship.md | head -20
```

- [ ] **Step 2: Add task_link_pr step in ship.md BEFORE the gh pr create step**

Find the section that calls `gh pr create`. Insert this step immediately before it:

```markdown
### Link task to PR (before creating)

Before creating the PR, link the current task to it. This enables post-merge auto-transition to `done`.

1. Find the active task for this branch:
   ```bash
   # Extract task ID from branch name (e.g. COND-047 from feat/COND-047-feature-name)
   BRANCH=$(git branch --show-current)
   TASK_ID=$(echo "$BRANCH" | grep -oE '[A-Z]+-[0-9]+' | head -1)
   echo "Task: $TASK_ID"
   ```

2. If TASK_ID is empty, check recent commit messages:
   ```bash
   git log --oneline -5 | grep -oE '[A-Z]+-[0-9]+' | head -1
   ```

3. Call task_link_branch if not already done:
   Use the `task_link_branch` MCP tool with the task ID and current branch name.

4. Call task_link_pr after getting the PR number:
   After `gh pr create` returns the PR URL, extract the PR number and call `task_link_pr` with task ID and PR number.
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

1. Find the task for this work:
   - Use `task_search` with the feature/bug title to find an existing task
   - If found and status is `queued`: call `task_transition` → `in_progress`, then `task_claim`
   - If not found: call `task_create` (type: feature/bug, priority: medium, why: brief description)

2. Set the branch and link it:
   - Branch must include the task ID: `git checkout -b feat/XXXX-NNN-short-description`
   - Call `task_link_branch` with the task ID and branch name
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
// For each in_progress task, checks if a merged PR exists for a matching branch.
// If found: calls task_link_pr, then task_transition → done.
// Run: node scripts/reconcile-stuck-tasks.js [--dry-run] [--project COND|ACR]

'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projectFilter = args[args.indexOf('--project') + 1] || null;

const projects = {
  COND: 'C:/code/conductor',
  ACR: 'C:/code/acr-reimagined',
  HBOOK: 'C:/code/handbook',
};

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe','pipe','pipe'], ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function getMergedPRs(repoDir) {
  const result = run(
    `gh pr list --state merged --limit 100 --json number,title,mergedAt,headRefName`,
    { cwd: repoDir }
  );
  if (!result) return [];
  try { return JSON.parse(result); } catch { return []; }
}

function getInProgressTasks(prefix, repoDir) {
  const indexPath = path.join(repoDir, 'agent-tasks', 'index.yaml');
  if (!fs.existsSync(indexPath)) return [];
  const yaml = fs.readFileSync(indexPath, 'utf-8');
  const tasks = [];
  const taskBlocks = yaml.split(/^  - id:/m).slice(1);
  for (const block of taskBlocks) {
    const id = (block.match(/^([A-Z]+-\d+)/) || [])[1];
    const status = (block.match(/\n    status: (\w+)/) || [])[1];
    const title = (block.match(/\n    title: "?(.+?)"?\n/) || [])[1];
    if (id && status === 'in_progress' && id.startsWith(prefix)) {
      tasks.push({ id, title: title || '', status });
    }
  }
  return tasks;
}

async function main() {
  for (const [prefix, repoDir] of Object.entries(projects)) {
    if (projectFilter && prefix !== projectFilter) continue;
    console.log(`\n=== ${prefix} (${repoDir}) ===`);
    
    const tasks = getInProgressTasks(prefix, repoDir);
    const prs = getMergedPRs(repoDir);
    
    console.log(`  ${tasks.length} in_progress tasks, ${prs.length} merged PRs`);
    
    for (const task of tasks) {
      // Match by task ID in branch name or PR title
      const matchedPR = prs.find(pr =>
        pr.headRefName?.includes(task.id) ||
        pr.title?.includes(task.id)
      );
      
      if (matchedPR) {
        console.log(`  MATCH: ${task.id} → PR #${matchedPR.number} (${matchedPR.headRefName})`);
        if (!dryRun) {
          console.log(`    → task_link_pr ${task.id} ${matchedPR.number}`);
          run(`node C:/code/mcp-agent-tasks/dist/cli.js link-pr ${task.id} ${matchedPR.number}`, { cwd: repoDir });
          console.log(`    → task_transition ${task.id} done`);
          run(`node C:/code/mcp-agent-tasks/dist/cli.js transition ${task.id} done`, { cwd: repoDir });
        }
      } else {
        console.log(`  NO MATCH: ${task.id} — "${task.title?.slice(0, 50)}" (leave as-is)`);
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
