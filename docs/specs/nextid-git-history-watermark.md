# `nextId()` doesn't check git history — causes ID collisions with real, merged work

**Type**: Bug
**Task:** MCPAT-125 (implementation) — see MCPAT-118 for the ID-collision fix that renamed this
spec file away from its original `MCPAT-116-*.md` filename
**Repo**: mcp-agent-tasks
**Discovered**: ALFI-073 delivery run (2026-07-08/09, in atlas-pipeline) — created 4 new tracker
tasks; two of them (`ALFI-071`, `ALFI-072`) were silently assigned numbers that collide with real,
already-merged git-history tickets of the same number (a Palmanova lead-cluster PR and the
atlas-capture service PR, respectively) — completely unrelated to the new tasks just created.

---

## Description

`SqliteIndex.nextId(prefix, tasksDir)` (`src/store/sqlite-index.ts:928`) computes the next ID by
taking the max of two sources: on-disk task files matching `<prefix>-<N>*` in `tasksDir`
(`onDiskMax`, lines 929-938), and the highest ID already present in the sqlite index for that
project (`indexMax`, via `maxIdNumberForProject`, lines 914-926). It does not check **git commit
history or branch names** for the linked repository at all.

This is a real gap specifically for projects like atlas-pipeline, where — per
`project-task-tracking-fragmentation` (an already-known issue in that project's own memory) —
`agent-tasks/index.yaml` and the `tasks/` directory went stale/unindexed for a stretch, while
real ticket numbers kept incrementing through **git commit messages and branch names**
(`feat(ALFI-071): ...`, `feat/ALFI-072-capture-service`) without ever having a corresponding
task file created in the tracker. When the tracker later assigns a fresh ID via `nextId()`, it has
no way to see those git-only numbers were already "used" in spirit (referenced in merged,
real work) — it only sees what's on disk and in its own index, both of which are missing that
range entirely, so it happily hands the same number out again.

**Impact**: any project where git-history numbering has drifted ahead of what's tracked in
`tasks/`/the index (which the fragmentation issue confirms is an existing, known state for
atlas-pipeline, and could recur for any project using both git and this tracker loosely) will keep
producing new tracker tasks whose IDs silently collide with real merged commits — with no error,
no warning, just two different things sharing one ID going forward.

---

## Group A — Git-History Watermark in `nextId()`

**File**: `src/store/sqlite-index.ts`

### A1 — Add a third watermark source: git history

Extend `nextId(prefix, tasksDir)` to also scan git history for the project's repo (if `tasksDir`
resolves to a path inside a git working tree) for the highest `<prefix>-<N>` pattern across all
commit messages and branch names — the same two sources this session used manually to find the
"real" next-available ALFI number (`git log --all --oneline | grep -oE "ALFI-[0-9]+"` and
`git branch -a --contains` style checks).

```typescript
function gitHistoryMax(prefix: string, tasksDir: string): number {
  const repoRoot = findGitRoot(tasksDir); // walk up from tasksDir looking for .git
  if (!repoRoot) return 0;
  try {
    const out = execSync(
      `git log --all --pretty=%s`,
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    const branches = execSync(`git branch -a --format=%(refname:short)`, { cwd: repoRoot, encoding: 'utf8' });
    const re = new RegExp(`\\b${escapeRegExp(prefix)}-(\\d+)\\b`, 'g');
    let max = 0;
    for (const text of [out, branches]) {
      let m;
      while ((m = re.exec(text)) !== null) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max;
  } catch {
    return 0; // not a git repo, git not available, or the scan failed — degrade to existing behavior
  }
}
```

Call this alongside the existing `onDiskMax`/`indexMax` checks in `nextId()`, taking the max of
all three before incrementing. Must degrade silently (return 0, don't throw) when `tasksDir` isn't
in a git repo, or git isn't available — this needs to work for non-git-backed projects unchanged.

### A2 — Cache the git scan, don't run it on every `nextId()` call

`git log --all` over a large/old repo's full history is not free — scale it. Options to consider
during planning: cache the result keyed by `(prefix, repo HEAD sha)` and invalidate on HEAD change,
or just cap it with `--since` if there's a reasonable bound, or accept the cost since `nextId()` is
called on task creation (not a hot path) — pick based on measuring actual cost on a real large
repo (atlas-pipeline's own history is a reasonable test case) rather than guessing.

---

## Domain Model

No schema change. `projects.next_id` semantics are unchanged — this just adds a third input to the
`MAX()` computation that already happens across `onDiskMax`/`indexMax`.

---

## Acceptance Criteria

- [ ] `nextId('ALFI', tasksDir)` on a fresh index, run against atlas-pipeline's real git history,
      returns a number higher than the highest `ALFI-NNN` reference in `git log --all` and
      `git branch -a`, not just higher than what's in `tasks/` or the sqlite index
- [ ] Reproduce the actual incident: with the index/tasks state as it was in this session (missing
      the ALFI-071/072 git-only range), `task_create` for a new ALFI task must NOT produce
      `ALFI-071` or `ALFI-072`
- [ ] A project whose `tasksDir` is not inside a git repo (or where git isn't installed) behaves
      identically to today — no error, no behavior change, degrades to the existing two-source max
- [ ] Test with a large-ish real repo's history to confirm the git scan doesn't meaningfully slow
      down `task_create` (measure before/after)

---

## Failure Modes

- **`git log --all` scope**: `--all` includes every ref (all branches, not just merged ones) —
  this is intentional (a ticket number referenced on an *unmerged* branch is still "used" in the
  sense that reusing it would cause confusion later when that branch does merge), but confirm this
  doesn't pull in an unreasonable number of refs on a repo with many stale feature branches.
- **False positives from unrelated number-like substrings**: the regex `\b<prefix>-(\d+)\b` should
  be reasonably precise given the prefix is project-specific (e.g. `ALFI-`), but verify against a
  real repo's commit message corpus that nothing spurious matches.

---

## Out of Scope

- Retroactively reconciling already-collided IDs (this session already worked around the two live
  collisions by using non-colliding human-facing names in branches/commits — no automated fix
  needed for that specific incident, it's already resolved by convention).
- `id-collision-fixer.ts`'s existing scope (file-vs-file collisions within the tracker's own
  `tasks/` directory) — unrelated, already handled, not touched by this ticket.
- Building a fully general "reconcile tracker state against git history" tool — this ticket only
  fixes the forward-looking `nextId()` allocation, not a retroactive audit/repair tool.

---

## Dependencies

None.

---

## Effort Estimate

**S** (half a day to a day): the git-scanning logic itself is small; most of the effort is A2's
performance consideration and testing against a real repo's history rather than a synthetic case.
