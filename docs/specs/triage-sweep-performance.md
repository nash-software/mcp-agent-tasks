# Triage Sweep Performance — Spec (MCPAT-082)

**Status:** APPROVED — ship on relay
**Parent:** MCPAT-075 · follows MCPAT-080/081

## 0. Problem
A full `--apply` sweep over 278 tasks took ~57 min. Cost: (1) the Tier-2 batch runner spawns
`claude -p` with NO `--model`, so it uses the account default (Sonnet/Opus) with high-effort
extended thinking, for what is really structured classification; (2) each batch is a fresh
`claude` process running the full ~/.claude SessionStart hook chain; (3) batches + Tier-0 gh
probes + per-task repo-signal git calls run serially.

## 1. Constraint
Stay on the `claude` CLI (uses the Max subscription — NO SDK/API). Optimise within the CLI path.

## 2. Goal
Cut wall-clock ~5-10x (target < 15 min) with no meaningful loss of verdict quality.

## 3. Changes

### P1. Haiku for Tier-2 verdicts (default)
- Batch runner spawns `claude -p --model claude-haiku-4-5`. Configurable via `--model` /
  `MCPAT_TRIAGE_MODEL` (default `claude-haiku-4-5`).
- Build an agreement-check command/harness `triage-eval` (or `triage --eval-models`) that, given
  a task sample, runs the prompt through two models and reports the verdict-agreement rate. The
  REAL comparison run is done locally post-merge (the VPS has no sibling project repos and nested
  claude is constrained) — DO NOT attempt a live Haiku-vs-Sonnet sweep on the VPS. Just build +
  unit-test the harness with an injected runner.

### P2. Trim per-spawn overhead
- Point triage `claude` spawns at a lean config dir with no SessionStart hooks
  (`CLAUDE_CONFIG_DIR=<scratch>/.claude-triage`, seeded once with minimal settings) so each batch
  skips the hook chain. If auth breaks from a lean dir, fall back to disabling only hooks.

### P3. Concurrent batches
- Run up to N batches concurrently (`--concurrency` / `MCPAT_TRIAGE_CONCURRENCY`, default 4).
  Adaptive split (MCPAT-081) retained.

### P4. Parallel repo-signal gathering + per-repo cache
- Gather a batch's repo signals concurrently. Per run, pre-warm once per repo with
  `git log --oneline --all` and match task IDs in-memory, replacing N per-task `git log` spawns
  with one per repo; cache `git grep` per repo.

### P5. Concurrent Tier-0 probes + gh cache
- Run probeMerge concurrently (bounded) with a gh cache; resilient (one failed probe never aborts).

### P6. Larger Haiku batches
- Default batchSize 6 -> 10; adaptive split retained.

## 4. Acceptance criteria
- AC1: Tier-2 spawn includes `--model` (default `claude-haiku-4-5`); `--model` /
  `MCPAT_TRIAGE_MODEL` override it. Unit-tested (spawned argv carries the model).
- AC2: an agreement-check harness exists + is unit-tested with an injected runner (the live
  comparison run is local, post-merge).
- AC3: `--concurrency` / `MCPAT_TRIAGE_CONCURRENCY` (default 4) runs batches concurrently,
  bounded; unit-tested (N in flight).
- AC4: repo signals for a batch gathered concurrently with a per-repo cache; unit-tested with an
  injected CmdRunner (per-repo log fetched once, not per task).
- AC5: Tier-0 probes run concurrently (bounded) with a gh cache; resilient.
- AC6: default `batchSize === 10`; adaptive split retained.
- AC7: type-check + build + all triage tests green.

## 5. Out of scope
- Anthropic SDK/API (violates the CLI standard).
- Persisting verdicts/signals across runs; UI progress streaming.
