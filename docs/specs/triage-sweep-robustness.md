# Triage Sweep Robustness — Spec (MCPAT-083)

**Status:** APPROVED — ship on relay
**Parent:** MCPAT-075 · follows MCPAT-082

## 0. Problem
The MCPAT-082 full dry-run hit a ~17x speedup (57m -> 3.4m) but exposed two issues:
1. ~8% of tasks (20/242) failed with `spawn claude.exe ENOENT`. The binary exists and works —
   this is concurrent spawns of the 240MB claude.exe on Windows intermittently ENOENT-ing
   (file-handle/AV contention) when several batches spawn near-simultaneously. The adaptive
   split (MCPAT-081) misreads this as a batch-size problem, splits down to size-1, and gives up
   as `llm-error` instead of just retrying the transient spawn.
2. At the single 0.75 threshold, `obsolete`/`duplicate` verdicts auto-apply at 0.75 — riskier
   than `done @ 0.75`, since obsolete/duplicate are more of a judgment call.

## Fix 1: Spawn-retry on transient OS errors
- In the Tier-2 batch runner (`defaultLlmRunBatch` in `engine.ts`), retry the `claude` spawn on
  TRANSIENT errors — `ENOENT`, `EBUSY`, `EAGAIN`, `EMFILE`, `ETXTBSY` — up to 3 attempts with
  jittered backoff (~150ms * attempt). Non-transient errors and inference TIMEOUTS are NOT retried
  here (the adaptive split still handles slow batches). The retry must distinguish a spawn-time
  error (the `error` event with a code) from a timeout.
- Structure the spawn so the retry is unit-testable: extract a `spawnClaudeOnce(bin,args,opts,spawnFn)`
  (or `runBatchWithSpawn(..., spawnFn)`) where `spawnFn` defaults to node `spawn` and can be injected.
- Reduce default `--concurrency` 4 -> 3 to lower spawn pressure.

## Fix 2: Tiered confidence thresholds
- `mapVerdict(task, verdict, thresholds)` takes per-verdict thresholds
  `{ done: number; obsolete: number; duplicate: number }`. Defaults: done 0.75, obsolete 0.85,
  duplicate 0.85.
- The base `--threshold` / `MCPAT_TRIAGE_THRESHOLD` sets `done`; obsolete/duplicate use
  `max(base, 0.85)` — a higher base raises all; the default keeps obsolete/duplicate stricter.
- Thread the thresholds object from the CLI/engine down to `mapVerdict`.

## Acceptance criteria
- AC1: spawn-retry — unit test with an injected spawnFn that emits ENOENT N-1 times then succeeds ->
  resolves; an always-ENOENT spawnFn -> rejects after 3 attempts. A non-transient code is not retried.
- AC2: default Tier-2 concurrency === 3.
- AC3: `mapVerdict` — `done @ 0.78` resolves; `obsolete @ 0.78` escalates (llm-unsure, below 0.85);
  `obsolete @ 0.88` resolves; `duplicate @ 0.80` escalates. Unit-tested.
- AC4: base `--threshold 0.9` raises `done` to 0.9 and obsolete/duplicate to max(0.9,0.85)=0.9.
- AC5: type-check + build + all triage tests green.

## Out of scope
- A spawn mutex (serialising spawns) — retry is simpler and keeps concurrency.
- Persisting verdicts across runs.
