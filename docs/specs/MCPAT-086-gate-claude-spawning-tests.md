# MCPAT-086 — Gate claude-spawning integration tests behind an explicit env flag

## Problem

Some integration tests in the suite spawn a **real `claude` subprocess** (triage / passive-capture /
project-routing paths that shell out to `claude -p`). Their behaviour is environment-dependent:

- **Windows:** the spawn is blocked by Job Objects → tests effectively no-op (never observed locally).
- **CI Linux:** `claude` isn't authenticated/available → tests skip or the spawn fails fast.
- **A host where `claude` IS available** (e.g. the relay VPS build host, with `~/.claude-vps`): the tests
  spawn **real LLM calls** — slow, memory-heavy, non-deterministic, and **unkillable in bulk**.

During the MCPAT-084/085 relay ship (2026-06-09), running `npm test` in worktrees on the VPS spawned a
cluster of real `claude` processes (fixtures like "Buy more coffee beans", "Which project prefix from
[MYPROJ]") that contributed to an OOM lock-up of the build host (load 115, ~20 min unreachable).

A test suite must be **deterministic and side-effect-free by default**. Spawning real LLM calls based on
ambient `claude` availability violates that — the same `npm test` behaves differently per machine and can
take down the host it runs on.

## Goal

The suite must **never** spawn a real `claude` process unless explicitly opted in. Default `npm test` is
fully hermetic on every platform.

## Approach

1. **Discovery.** Grep the test tree + the code under test for the claude-spawn sites:
   - `grep -rnE "spawn|execFile|exec\(.*claude|claude -p|spawnClaude" tests/ src/` and the triage /
     passive-capture / project-router integration tests. Enumerate every test that can reach a real spawn.
2. **Gate behind `RUN_LLM_INTEGRATION`** (name TBD; pick one and document it):
   - These tests run **only** when `process.env.RUN_LLM_INTEGRATION === '1'`. Otherwise `describe.skip` /
     `it.skip` (visible-skipped, not silently absent — log the skip reason).
   - Default (unset) = skipped everywhere. CI does **not** set it (keeps CI hermetic + fast).
3. **Prefer a mock for the logic.** Where the test is really exercising *our* parsing/branching (not the
   LLM), inject a fake runner (the engine already supports an injected `CmdRunner` / `llmRunBatch`) so the
   logic is covered hermetically and the real-spawn variant is the opt-in extra.
4. **Guard the spawn itself** (defence in depth): the production triage/passive-capture spawn path should
   already fail safe when `claude` is missing — confirm it never hangs/piles up (bounded timeout + no retry
   storm). Out of scope to rewrite, but note any gap.

## Acceptance Criteria

- **AC1** — With `RUN_LLM_INTEGRATION` unset, `npm test` spawns **zero** `claude` processes on a host where
  `claude` is on PATH (verify by wrapping/counting, or by asserting the injected fake runner is used).
- **AC2** — The previously claude-spawning tests are visible-skipped (reported as skipped, with a reason),
  not deleted, when the flag is off; they run when `RUN_LLM_INTEGRATION=1`.
- **AC3** — The hermetic logic coverage (parsing/branching) still passes via the injected fake runner —
  no loss of real coverage.
- **AC4** — `npm run type-check`, `npm run build`, `npm test` pass (default, flag off). CI stays green and
  does not spawn `claude`.
- **AC5** — The flag + behaviour is documented (CLAUDE.md "Standards" or the test README): "integration
  tests that spawn real `claude` are opt-in via `RUN_LLM_INTEGRATION=1`."

## Tests

- A meta-test (or CI assertion) that, on Linux with a stub `claude` on PATH, `npm test` does not invoke it
  (the stub writes a sentinel file; assert it's absent after the run).

## Out of scope

- Rewriting the production triage/passive-capture spawn logic (only gate the tests + confirm no spawn storm).
- Changing CI runners.

## Files (pointers — architect to confirm)

- `tests/**` — the integration tests that spawn `claude` (discovery step)
- `src/triage/*`, `hooks/passive-capture.js`, the project-router — the spawn sites under test
- `CLAUDE.md` / test README — document the flag

## Why (provenance)

Root cause #4 in the 2026-06-09 relay-ship autopsy: ambient-`claude`-dependent tests turned a routine
`npm test` into a resource bomb on the build host. See memory `feedback-vps-oom-no-builds-on-build-host`.
