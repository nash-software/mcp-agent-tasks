# Epic: Gold-audit remediation (MCPAT-118 through MCPAT-135)

**Goal:** Close out the 18 findings from the 2026-07-10 gold-standard production-readiness audit
(`docs/audits/2026-07-10-gold-audit.md`), covering reliability (deleteTask cascade, SQLITE_BUSY,
global error handlers), observability (serve-ui/tray health events), doc drift (tool count, CLI
commands, env vars, transition semantics), and a live ID-collision bug caught mid-audit.

**Source of truth:**
- Audit: `docs/audits/2026-07-10-gold-audit.md`
- Delivery brief: `docs/audits/2026-07-10-delivery-brief.md`
- nextId spec (MCPAT-125's implementation target): `docs/specs/MCPAT-116-nextid-git-history-watermark.md`
  — **still named MCPAT-116**, which is the exact collision MCPAT-118 (Phase 0) must resolve before
  MCPAT-125 (Phase 1) touches it.

**Out of scope:** MCPAT-111 (the underlying dual-store-routing bug MCPAT-118 reinforces — already
open, tracked separately, not part of this epic). Prism/relay-side infra changes.

**Dispatch mechanism:** `/relay-orchestrate docs/epics/MCPAT-gold-audit-remediation/README.md --auto --vps --milestone gold-audit-remediation-2026-07`
(VPS was unreachable as of 2026-07-16 — this spec is prepared so the run can be dispatched the
moment it's back, no re-derivation needed. Re-run the pre-flight `fleet__status` check before
dispatch, since repo state may have moved on by then.)

**File-ownership matrix** (why phases are batched the way they are below):

| File | Phases touching it |
|---|---|
| `docs/specs/MCPAT-116-nextid-git-history-watermark.md` | Phase 0 (rename), Phase 1 (implement) |
| `src/store/reconciler.ts` (`pruneOrphans()`) + `src/store/sqlite-index.ts` (`deleteTask()`) | Phase 7 only (123+126 combined) |
| `src/store/sqlite-index.ts` (busy_timeout/index-health area) + `src/store/index-health.ts` | Phase 8 only (127+128 combined) |
| `src/server.ts` | Phase 8 (INTERNAL_ERROR catch, ~line 229) and Phase 11 (uncaughtException/signal handlers, ~line 411) — same file, non-overlapping regions, sequenced across batches to avoid a stale-base rebase |
| `src/server-ui.ts` (~4800 lines, single file) | Phase 9 (health events) and Phase 12 (artifacts/open exec→execFile) — sequenced |
| `README.md` / `CLAUDE.md` / `STATUS.md` / `CONTEXT.md` | Phase 10, 13, 14, 15 — all four touch `README.md`; sequenced one-at-a-time to avoid guaranteed merge conflicts on the same doc sections |

---

## Phase 0 (MCPAT-118) — CRITICAL: fix live ID collision

Caught live during the audit: `docs/specs/MCPAT-116-nextid-git-history-watermark.md` (this epic's
own source spec) collides with the store's actual task MCPAT-116 ("Timeline v2", created in the
legacy `~/.mcp-tasks` global store while this doc lives in the repo's local `agent-tasks/`). Same
dual-store-routing symptom as the already-open MCPAT-111.

**Files to modify:**
- `docs/specs/MCPAT-116-nextid-git-history-watermark.md` — rename to a non-colliding filename/ID
  (verify against both the local `agent-tasks/` store and the global `~/.mcp-tasks` store before
  picking the new ID — that dual-check IS the fix for this class of bug)
- Any in-repo references to the old filename (grep before renaming)

**Branch:** `fix/MCPAT-118-id-collision-spec-rename`

---

## Phase 1 (MCPAT-125) — nextId() git-history watermark

Implements the spec renamed in Phase 0. Depends on Phase 0 because implementing against a
known-colliding filename would just recreate the bug this epic starts by fixing.

**Files to modify:**
- `src/store/sqlite-index.ts` or wherever `nextId()` currently lives — add git-history watermark
  per the (renamed) spec doc
- New/updated unit tests for the watermark logic

**Depends on:** Phase 0
**Branch:** `feat/MCPAT-125-nextid-watermark`

---

## Phase 2 (MCPAT-119) — non-hermetic serve-ui-html test

`tests/integration/serve-ui-html.test.ts` is the sole outlier among 17 `startUiServer()` test files
that doesn't set `MCP_TASKS_CONFIG` in `beforeAll`, so it boots against the real host config and
reconciles real registered projects.

**Files to modify:**
- `tests/integration/serve-ui-html.test.ts` — add the same `MCP_TASKS_CONFIG` fixture override the
  other 16 sibling files use

**Branch:** `fix/MCPAT-119-serve-ui-test-hermeticity`

---

## Phase 3 (MCPAT-129) — reconcile-github fallback sort + audit log

Already re-scoped 2026-07-16 (see task notes): two related fixes (RELAY-025 #137, MCPAT-138 #141)
narrowed candidacy but left the fallback unranked and unlogged.

**Files to modify:**
- `src/tools/task-reconcile-github.ts:220` — replace `candidates.find(...) ?? candidates[0]` with a
  deterministic sort (branch-format priority, then merge date)
- `src/tools/task-reconcile-github.ts:24-30` — add a distinct log line when a `blocked`/`draft` task
  auto-transitions via reconcile

**Branch:** `fix/MCPAT-129-reconcile-fallback-audit-trail`

---

## Phase 4 (MCPAT-131) — subtask status schema/type divergence

`schema/task.schema.json` subtask status enum forbids `draft`/`approved`; `src/types/task.ts` TS
type allows them. Neither side is enforced anywhere.

**Files to modify:**
- `schema/task.schema.json`
- `src/types/task.ts`

**Branch:** `fix/MCPAT-131-subtask-status-schema-divergence`

---

## Phase 5 (MCPAT-133) — Windows test-harness EFTYPE bugs

Mock subprocess binaries in `note-infer-confidence.test.ts` and `prepare-commit-msg.test.ts` are
bare `.js` files; on Windows this throws EFTYPE or silently resolves the real system `git.exe`.

**Files to modify:**
- Mock binary fixtures used by `tests/unit/note-infer-confidence.test.ts` and
  `tests/unit/prepare-commit-msg.test.ts` — add `.cmd`/`.exe` wrappers

**Branch:** `fix/MCPAT-133-windows-test-mock-eftype`

---

## Phase 6 (MCPAT-134) — drop dead CJS build target

`dist/server.cjs` throws at require-time but is never executed (all entry points are ESM); only
`package.json`'s `main` field misleadingly points at it.

**Files to modify:**
- `package.json` — drop CJS build target, fix `main`
- `tsup.config.*` — remove CJS output format

**Branch:** `chore/MCPAT-134-drop-cjs-build`

---

## Phase 7 (MCPAT-123 + MCPAT-126 combined) — deleteTask cascade + pruneOrphans logging

Combined into one phase because both live in the same two files and the same functional area
(cascade-delete correctness). Splitting across two lanes would guarantee a merge conflict.

- **MCPAT-123:** `deleteTask()` only deletes outgoing dependency rows, never incoming
  (`depends_on=?`); no `ON DELETE CASCADE`; `pruneOrphans()` has no per-task try/catch so one bad
  orphan aborts reconcile-on-boot for the whole project.
- **MCPAT-126:** `pruneOrphans()` returns only a count, never logs pruned IDs; `server-ui.ts`
  discards even that count.

**Files to modify:**
- `src/store/sqlite-index.ts:621` (`deleteTask()`) — fix incoming-dependency cascade
- `src/store/reconciler.ts:196-202` (`pruneOrphans()`) — per-task try/catch, per-ID logging
- `src/server-ui.ts` — surface the pruned-ID log output instead of discarding the count

**Branch:** `fix/MCPAT-123-126-cascade-delete-orphan-logging`

---

## Phase 8 (MCPAT-127 + MCPAT-128 combined) — SQLITE_BUSY handling + index-rebuild lock check

Combined for the same reason as Phase 7 — same file, same subsystem (SQLite index resilience).

- **MCPAT-127:** `SQLITE_BUSY` surfaces as an opaque, non-retryable `INTERNAL_ERROR`
  (`src/server.ts` catch-all, ~line 229) with no retry/backoff signal to the caller.
- **MCPAT-128:** `ensureHealthyIndex` unlinks the shared `.index.db` with no cross-process lock
  check — safe today, but produces a confusing error instead of a clear "rebuild in progress"
  message under genuine concurrent access.

**Files to modify:**
- `src/server.ts` (~line 229) — detect `SQLITE_BUSY` specifically, return a retryable error code
- `src/store/index-health.ts` / `src/store/sqlite-index.ts` (`ensureHealthyIndex`) — add a lock
  check before unlinking

**Branch:** `fix/MCPAT-127-128-busy-lock-handling`

---

## Phase 9 (MCPAT-122) — health events for serve-ui / tray

`server-ui.ts` has zero `appendHealthEvent` calls; only the stdio server heartbeats. UI/advisor
outages (the actually-experienced pain point) are invisible to the health/dead-man system.

**Files to modify:**
- `src/server-ui.ts` — add heartbeat/error events under a distinct source
- `src/health/health-ledger.ts` — add a matching health-expectations entry

**Branch:** `feat/MCPAT-122-serve-ui-health-events`

---

## Phase 10 (MCPAT-120) — doc tool-count drift

README/CLAUDE.md/STATUS.md/CONTEXT.md all claim "20 MCP tools"; `src/server.ts` TOOLS array
actually has 29 entries (CLAUDE.md even lists only 22 names, self-contradicting).

**Files to modify:**
- `README.md`, `CLAUDE.md`, `STATUS.md`, `CONTEXT.md` — reference the TOOLS array count instead of
  a hardcoded number; list the previously-undiscoverable tools (`task-milestone`,
  `task-reconcile-legacy`, the 5 `note-*` tools)

**Branch:** `docs/MCPAT-120-tool-count-drift`

---

## Phase 11 (MCPAT-130) — global process error handlers

No global `uncaughtException`/`unhandledRejection` handlers; both file watchers (chokidar,
`fs.watch`) lack `error` listeners — a transient Windows FS error can crash the whole stdio server
session. Sequenced after Phase 8 (both touch `src/server.ts`, different regions — sequencing avoids
a stale-base rebase rather than a real logical dependency).

**Files to modify:**
- `src/server.ts` — add `process.on('uncaughtException', ...)` / `unhandledRejection` handlers
- `src/store/file-watcher.ts` — add `error` listeners to chokidar/`fs.watch` instances

**Depends on:** Phase 8 (merge-order only, same file)
**Branch:** `fix/MCPAT-130-global-error-handlers`

---

## Phase 12 (MCPAT-135) — security hygiene bundle

Four LOW-scored findings, bundled since they're cheap and largely independent, except the
`artifacts/open` sub-item shares `server-ui.ts` with Phase 9.

**Files to modify:**
- Triage prompt builder — add tag-stripping sanitization (match existing pattern elsewhere)
- `src/*/llm-matcher.ts` — add `CLAUDE_CLI_DISABLED` gate before spawning `claude`
- `src/server-ui.ts` (`/api/artifacts/open`, ~line 4501/4854) — replace template-literal `exec()`
  with `execFile`/`spawn` + argv array
- `package.json` — bump transitive deps to clear `npm audit`'s 2 high findings (fast-uri, hono via
  MCP SDK)

**Depends on:** Phase 9 (merge-order only, same file — `server-ui.ts`)
**Branch:** `fix/MCPAT-135-security-hygiene-bundle`

---

## Phase 13 (MCPAT-121) — undocumented env vars

At least 10 undocumented `process.env` reads control hook/server behavior, including the Stop-hook
kill-switch (`MCP_TASKS_STOP_HOOK_DISABLED`) with no documented "off switch."

**Files to modify:**
- `README.md` — add an Environment Variables table (`MCP_TASKS_STOP_HOOK_DISABLED`,
  `CLAUDE_HEALTH_DIR`, `MCP_TASKS_DIR`, `BRAIN_MCP_URL`, `MCP_TASKS_CONFIG`,
  `MCP_TASKS_CLAUDE_BINARY`, `MCP_TASKS_DRY_RUN`, `MCPAT_TRIAGE_*`)

**Depends on:** Phase 10 (merge-order only, same file — `README.md`)
**Branch:** `docs/MCPAT-121-env-vars-table`

---

## Phase 14 (MCPAT-124) — undocumented CLI commands + link-pr side effect

README documents 14/26 CLI commands; `link-pr` silently auto-transitions to `done` on PR merge,
contradicting the project's own "never manually transition to done" rule; the README's MCP
registration snippet doesn't match the known-working path.

**Files to modify:**
- `README.md` — document the missing 12 commands (`serve-ui`, `tray`, `install-tray`, `triage`,
  `triage-undo`, `install`, `setup`, `fix-id-collisions`, `reconcile-legacy`, `add-file`, `create`,
  `notes`); document `link-pr`'s auto-done side effect; fix the MCP registration snippet

**Depends on:** Phase 13 (merge-order only, same file — `README.md`)
**Branch:** `docs/MCPAT-124-cli-docs-linkpr-sideeffect`

---

## Phase 15 (MCPAT-132) — transition semantics undocumented

CLAUDE.md lists all 8 statuses, but transition *semantics* are undocumented: `blocked` is reachable
from `draft`/`approved` too, and `archived` has no documented entry point in `VALID_TRANSITIONS`.

**Files to modify:**
- `CLAUDE.md` / `README.md` — document the full transition graph, not just the linear happy path

**Depends on:** Phase 14 (merge-order only, same file — `README.md`)
**Branch:** `docs/MCPAT-132-transition-semantics`

---

## Phase Dependencies

| Phase | Tasks | Branch from | Shared files | Batch |
|-------|-------|-------------|---------------|-------|
| 0 | MCPAT-118 | main | spec doc | 1 |
| 1 | MCPAT-125 | main (fresh, post-merge) | spec doc | 2 (after 0) |
| 2 | MCPAT-119 | main | — | 2 |
| 3 | MCPAT-129 | main | — | 2 |
| 4 | MCPAT-131 | main | — | 2 |
| 5 | MCPAT-133 | main | — | 2 |
| 6 | MCPAT-134 | main | — | 2 |
| 7 | MCPAT-123, MCPAT-126 | main | reconciler.ts, sqlite-index.ts | 2 |
| 8 | MCPAT-127, MCPAT-128 | main | sqlite-index.ts, index-health.ts, server.ts | 2 |
| 9 | MCPAT-122 | main | server-ui.ts | 2 |
| 10 | MCPAT-120 | main | README.md | 2 |
| 11 | MCPAT-130 | main (fresh, post-merge) | server.ts | 3 (after 8) |
| 12 | MCPAT-135 | main (fresh, post-merge) | server-ui.ts | 3 (after 9) |
| 13 | MCPAT-121 | main (fresh, post-merge) | README.md | 3 (after 10) |
| 14 | MCPAT-124 | main (fresh, post-merge) | README.md | 4 (after 13) |
| 15 | MCPAT-132 | main (fresh, post-merge) | README.md | 5 (after 14) |

**Batch 1:** Phase 0 solo (critical, blocking).
**Batch 2:** Phases 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 — 10 parallel VPS lanes.
**Batch 3:** Phases 11, 12, 13 — 3 parallel lanes (each depends on one specific Batch-2 phase for merge-order only, not on each other).
**Batch 4:** Phase 14 solo (README chain continues from 13).
**Batch 5:** Phase 15 solo (README chain continues from 14).

---

## Global gates (every phase)

- Type-check clean: `npm run type-check`
- Full suite green under the hermetic default: `npm test` (never set `RUN_LLM_INTEGRATION=1`)
- No `npm run build` / full `npm test` on the VPS build host itself — let PR CI gate those
  (VPS-OOM avoidance, learned from MCPAT-086)
- Every commit subject carries its task ID: `[MCPAT-NNN] message` (combined phases carry both IDs,
  e.g. `[MCPAT-123][MCPAT-126] ...`)
- Never manually transition a task to `done` — the post-merge git hook auto-transitions after
  squash-merge

## Notes for the orchestrator

- Phases 7 and 8 are each a single PR covering two task IDs — do not split them into separate
  lanes, they will conflict.
- Phases 11, 12, 13 do not depend on each other, only on their respective Batch-2 phase (8, 9, 10
  respectively) — they can run as one parallel batch once all three of 8/9/10 are merged, but 8/9/10
  themselves may complete at different times within Batch 2. If one lags, either wait for all of
  Batch 2 before opening Batch 3, or open 11/12/13 individually as their single dependency merges
  (whichever this orchestrator's batching model prefers — the simpler, safer default is to wait for
  all of Batch 2).
- Phases 13 → 14 → 15 are a strict README.md chain — do not parallelize them even though they don't
  share a *functional* dependency, only a file one.
- MCPAT-118's fix (Phase 0) must include a dual-store check (local `agent-tasks/` AND global
  `~/.mcp-tasks`) when picking the replacement ID — that check is the actual fix, not just picking
  the next sequential number.
