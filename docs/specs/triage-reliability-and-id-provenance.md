# Triage Reliability + Task-ID Provenance — Spec (MCPAT-081)

**Status:** APPROVED — relay half only (Part A + B1 + B3)
**Parent:** MCPAT-075 (triage system) · follows MCPAT-080 (repo signals)

## 0. Context

MCPAT-080 gave Tier-2 real git evidence. A live test exposed two gaps:
1. Tier-2 batches intermittently time out (a batch of 6-8 can exceed 300s), and repo
   evidence made the model calibrated, so probably-done tasks land at `done @ 0.70-0.80`,
   below the 0.85 bar, and escalate instead of resolving.
2. The strongest signal is the task ID appearing in a commit, but our commits usually do
   not carry it, so the model stays unsure for link-less tasks.

IMPLEMENT ONLY the relay-shippable parts below: A1-A4, B1, B3. Part B2 is local (global
~/.claude skills, not in this repo) and is handled by hand — do NOT attempt it on relay.

## Part A - Triage engine reliability (this repo)

### A1. Retry-on-timeout via batch splitting
New `runLlmBatchAdaptive(tasks, runBatch, opts)` in `engine.ts`: run the batch; on timeout or
error, if `tasks.length > 1` split in half and recurse on each half (one retry each); if
`tasks.length === 1` return that task as `llm-error`. Bounded recursion; resilient (never throws).
Wire it into the Tier-2 phase in place of the current single-shot batch call.

### A2. Smaller default batch (timeout retained)
Default Tier-2 `batchSize` 8 -> 6. Keep `LLM_BATCH_TIMEOUT_MS` at 300000.

### A3. Threshold default 0.85 -> 0.75
Lower the default auto-apply confidence threshold to 0.75. Configurable via `--threshold` and
`MCPAT_TRIAGE_THRESHOLD`. Update the CLI default + engine default consistently.

### A4. (optional) Bounded concurrency
Allow up to 2 batches in flight via `--concurrency` / `MCPAT_TRIAGE_CONCURRENCY`, default 1.
Skip if it complicates the adaptive-split logic; A1-A3 are the priority.

### Part A acceptance criteria
- A-AC1: `runLlmBatchAdaptive` splits on a timeout and the sub-batches resolve; a size-1 timeout
  yields exactly one `llm-error`. Unit-tested with an injected runBatch that times out for given task sets.
- A-AC2: default `batchSize === 6`; `LLM_BATCH_TIMEOUT_MS === 300000`.
- A-AC3: default threshold `=== 0.75`; `--threshold` / `MCPAT_TRIAGE_THRESHOLD` override it.
- A-AC5: type-check + build + all triage tests green.

## Part B1 - Harden + install commit hooks (this repo)
- `hooks/prepare-commit-msg.js`: robustly extract `PREFIX-NNN` from the branch name
  (`^(feat|fix|chore|refactor|spike|docs|test)/([A-Z]+-[0-9]+)-`) and prepend `[PREFIX-NNN]` to the
  commit subject when absent (idempotent, never double-stamp). Unit tests over branch-name fixtures
  incl. no-ID branch (no-op) and already-stamped message (no-op).
- `install-hooks`: add `--all-projects` to iterate `config.projects` and install prepare-commit-msg +
  post-commit into each repo's `.git/hooks` (warn + skip missing repos).
- (optional) `hooks/commit-msg.js`: on a feat/fix/... branch lacking `PREFIX-NNN`, emit a WARNING
  (never block); hard-block only under `MCPAT_REQUIRE_TASK_ID=1`.

### Part B1 acceptance criteria
- B-AC1: prepare-commit-msg extracts/stamps the ID once; no-ID branch -> unchanged; already-stamped -> unchanged. Unit-tested.
- B-AC2: `install-hooks --all-projects` installs into every existing config.projects repo and warns on missing ones (tested against temp git repos).

## Part B3 - Provenance standard (this repo)
Add `docs/standards/task-id-provenance.md`: every commit on a feature branch carries `[PREFIX-NNN]`;
branches are `<type>/<PREFIX-NNN>-<slug>`; PRs reference the task; the prepare-commit-msg hook enforces
the commit part automatically. Link it from `CLAUDE.md`.
- B-AC3: the doc exists and is linked from CLAUDE.md.

## Out of scope
- History rewrite / backfill of IDs on old commits.
- Part B2 (global ~/.claude skills) — handled locally, not on relay.
