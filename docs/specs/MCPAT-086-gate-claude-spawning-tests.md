# MCPAT-086 — Gate claude-spawning integration tests behind an explicit env flag

## Problem

Some integration tests spawn a REAL `claude` subprocess (triage / passive-capture / project-routing
paths that shell out to `claude -p`). Behaviour is environment-dependent:
- Windows: spawn blocked by Job Objects -> tests no-op (never observed locally).
- CI Linux: `claude` not authenticated/available -> tests skip or fail fast.
- A host where `claude` IS available (the relay VPS build host, with ~/.claude-vps): tests spawn REAL
  LLM calls -> slow, memory-heavy, non-deterministic, unkillable in bulk.

During the 2026-06-09 MCPAT-084/085 relay ship, `npm test` in worktrees on the VPS spawned a cluster of
real claude processes (fixtures like "Buy more coffee beans", "Which project prefix from [MYPROJ]") that
contributed to an OOM lock-up of the build host (load 115, ~20 min unreachable).

A test suite must be deterministic and side-effect-free by default. Spawning real LLM calls based on
ambient `claude` availability violates that.

## Goal
The suite must NEVER spawn a real `claude` process unless explicitly opted in. Default `npm test` is
fully hermetic on every platform.

## Approach
1. Discovery: grep tests + code for spawn sites — `grep -rnE "spawn|execFile|exec\(.*claude|claude -p|spawnClaude" tests/ src/`
   and the triage / passive-capture / project-router integration tests. Enumerate every test that can spawn.
2. Gate behind `RUN_LLM_INTEGRATION` (default off): those tests run only when env==='1', else describe.skip/
   it.skip (VISIBLE-skipped with a reason, not deleted). CI does NOT set it.
3. Prefer a mock: where the test exercises OUR parsing/branching (not the LLM), inject the existing fake
   runner (CmdRunner / llmRunBatch) so logic stays covered hermetically; real-spawn is the opt-in extra.
4. Defence in depth: confirm the production spawn path fails safe when claude is missing (bounded timeout,
   no retry storm). Note any gap; rewriting it is out of scope.

## Acceptance Criteria
- AC1: with RUN_LLM_INTEGRATION unset, `npm test` spawns ZERO claude processes on a host where claude is on
  PATH (verify by counting / asserting the fake runner is used).
- AC2: the previously claude-spawning tests are visible-skipped (with reason) when off; they run when =1.
- AC3: hermetic logic coverage still passes via the injected fake runner — no lost coverage.
- AC4: type-check, build, `npm test` pass (default, flag off); CI stays green and spawns no claude.
- AC5: the flag + behaviour documented (CLAUDE.md or test README).

## Tests
- Meta-test/CI assertion: on Linux with a STUB `claude` on PATH (writes a sentinel file), `npm test` does
  not invoke it -> assert sentinel absent after the run.

## Out of scope
- Rewriting the production triage/passive-capture spawn logic. Changing CI runners.

## Files (pointers — architect to confirm)
- `tests/**` (the claude-spawning integration tests), `src/triage/*`, `hooks/passive-capture.js`,
  the project-router (spawn sites), `CLAUDE.md`/test README (document the flag).

## Why (provenance)
Root cause #4 in the 2026-06-09 relay-ship autopsy. Memory: feedback-vps-oom-no-builds-on-build-host.
