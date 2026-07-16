# mcp-agent-tasks — Gold-Standard Production-Readiness Audit

**Date:** 2026-07-10 · **Branch:** spec/MCPAT-116-nextid-git-history-watermark · **Tier:** gold
**Verdict: NEAR-GOLD** — solid core primitives (atomic writes, CAS claims, fail-open hooks, live heartbeat, green CI) undercut by a live ID-collision specimen, one confirmed store-integrity crash bug, non-hermetic tests, and doc drift that misroutes the agents who read CLAUDE.md as their source of truth.

## Scorecard

| Dimension | Score | Top gap |
|---|---|---|
| D1 Store Integrity & ID Safety | 5/10 | Confirmed dependency-cascade FK crash (MCPAT-123); nextId has no git-history watermark |
| D2 Concurrency & Crash Safety | 6/10 | SQLITE_BUSY surfaces as opaque error; no cross-process lock on index rebuild |
| D3 Automation Correctness | 6/10 | reconcile-github has no audit trail for blocked/draft auto-resolution (mechanism itself is safe) |
| D4 Security & LLM Safety Perimeter | 8/10 | All confirmed findings are LOW under the stated single-user/localhost threat model |
| D5 Testing & Gate Reality | 4/10 | 9 tests fail locally today (root-caused: 2 test-harness bugs + 1 non-hermetic test) |
| D6 Correctness & Code Quality | 7/10 | No global uncaughtException/unhandledRejection handlers; watcher error listeners missing |
| D7 Operability & Docs of Record | 4/10 | Docs understate the MCP tool surface by 45%, 12/26 CLI commands undocumented |

**Gold gate** (no dimension <8, no unresolved P0/P1): **not met.** One live P0-equivalent specimen (below) plus 6 confirmed HIGH findings remain open.

## Live specimen (found during this audit, not hypothetical)

**MCPAT-116 is currently assigned to two different things.** This audit's own branch (`spec/MCPAT-116-nextid-git-history-watermark`) carries a spec doc for "nextId() should check git history as a third watermark" — describing exactly the ID-collision defect class this audit investigates. But the task store's actual `MCPAT-116` is an unrelated "Timeline v2" feature, created 2026-07-09T23:16 in the *legacy* `~/.mcp-tasks` store, while the spec doc lives in the *repo's* `agent-tasks/`. This is dual-store routing producing a real collision, live, during the audit — and it plausibly shares root cause with the already-open [MCPAT-111](../../agent-tasks) ("wrong-store routing" bug, opened 2026-07-03). Tracked as **MCPAT-118**.

## Confirmed findings (severity-ordered)

### HIGH

**MCPAT-123 — deleteTask() incomplete dependency cascade crashes reconcile-on-boot** (D1.5)
`src/store/sqlite-index.ts:621-638` deletes `dependencies WHERE task_id=?` (a task's own outgoing deps) but never `WHERE depends_on=?` (incoming references from surviving tasks). The `depends_on` column has no `ON DELETE CASCADE` and `foreign_keys=ON` is set on every connection, so `pruneOrphans()` throws an uncaught `FOREIGN KEY constraint failed` the moment an orphaned task is still referenced as a dependency target — matching the observed `reconcile-on-boot FAILED for ALFI ... serving last-known index` log line from this audit's own test run.
*Adversarial verification: FACTUAL confirmed via live reproduction (a throwaway script reproduced the exact SqliteError; a control run with the bidirectional DELETE fixed it). IMPACT downgraded CRITICAL→HIGH — the MCP stdio server (what agents actually use for task CRUD) never calls `pruneOrphans`, so no task is ever lost; the crash is confined to one project's stale dashboard view; `task_rebuild_index` recovers cleanly without re-triggering.*
Reproduce: `scratchpads/.gold-audit/verify-d1-5-factual.md`

**MCPAT-119 — tests/integration/serve-ui-html.test.ts is non-hermetic** (D5.2)
The sole file (of 17 that call `startUiServer()`) that never sets `MCP_TASKS_CONFIG` in `beforeAll` — it boots against the real host's `~/.config/mcp-tasks/config.json` and triggers reconcile-on-boot against every real registered project, which is the actual source of the FK-crash log line above appearing during `npm test`.
*Adversarially confirmed (grep: 0 references here vs 8/2/2 in three sibling files). Sustained HIGH.*
Reproduce: `grep -c MCP_TASKS_CONFIG tests/integration/serve-ui-html.test.ts` → 0

**MCPAT-120 — MCP tool surface understated by ~45%** (D7.1)
README.md, CLAUDE.md, STATUS.md, CONTEXT.md all say "20 MCP tools"; `src/server.ts:67-96`'s TOOLS array has 29 entries (matches the live server). CLAUDE.md additionally lists only 22 names, contradicting its own header. Agents that trust CLAUDE.md never discover `task-milestone`, `task-reconcile-legacy`, or the 5 `note-*` tools.
Reproduce: `grep -rn "20 MCP tools" *.md`

**MCPAT-121 — undocumented env vars including the Stop-hook kill-switch** (D7.2)
At least 10 `process.env` reads control hook/server behavior with zero doc coverage, including `MCP_TASKS_STOP_HOOK_DISABLED` — the owner named "hooks & background automation" as live pain, and there's no documented off-switch to reach for when one misbehaves.
Reproduce: `grep -rn "MCP_TASKS_STOP_HOOK_DISABLED" README.md CLAUDE.md docs/` → empty

**MCPAT-124 — 12/26 CLI commands undocumented; link-pr's silent auto-done; stale README MCP registration** (D7.3, three findings)
`serve-ui`, `tray`, `triage`, `install`, `setup`, and 7 others are undocumented. `link-pr` (cli.ts:731-740) silently transitions a task to `done` on PR merge, contradicting the project's own "never manually transition to done" rule. README's MCP config snippet (bare `agent-tasks` command) doesn't match the known-working absolute-path registration this project's own memory records as a real recurring failure.

**MCPAT-122 — health/heartbeat coverage protects only the MCP stdio server** (D7.5)
Verified live: the heartbeat is real (`src/server.ts:386`, 5-min interval, 3260+ events in `~/.claude/state/health.jsonl`), but `server-ui.ts` has zero `appendHealthEvent` calls — the UI/advisor outages the owner actually experiences are structurally invisible to the dead-man alerting.

### MEDIUM

- **MCPAT-125** — `nextId()` has no git-history watermark (the spec this branch was authored for). Confirmed; downgraded HIGH→MEDIUM — the collision window is narrow for a single-operator fleet, and duplicates are detectable/recoverable, not silent data loss.
- **MCPAT-126** — `pruneOrphans()` deletes DB-only rows with zero per-ID logging. Confirmed; downgraded — SQLite-only rows aren't the source of truth (markdown is), so this is a diagnosability gap, not data loss.
- **MCPAT-127** — `SQLITE_BUSY` surfaces as an opaque `INTERNAL_ERROR` with no retry/backoff. Confirmed; downgraded — contention is occasional in this single-operator setup, and the 5s `busy_timeout` absorbs most windows.
- **MCPAT-128** — `ensureHealthyIndex` unlinks the shared `.index.db` with no cross-process lock check. *Adversarially REFUTED as silent-corruption risk*: a live test showed unlinking an open SQLite file on Windows throws a clean `EBUSY`, already caught by the existing try/catch — not the "orphaned inode" scenario originally described. One call site (server boot), so true racing needs two simultaneous boots. Real gap: confusing swallowed errors, not corruption.
- **MCPAT-129** — reconcile-github's PR-order fallback is unsorted (arbitrary API order) + blocked/draft eligibility has no audit trail. *D3.4's core claim was adversarially REFUTED as an illegal-transition exploit*: live testing proved `transitionTask`'s existing guard already rejects `blocked→done` directly, and `pathToDone` correctly routes through `blocked→in_progress→done`. The transition mechanism is safe; only the missing confirmation/audit-log for these two statuses is real debt.
- **MCPAT-130** — no global `uncaughtException`/`unhandledRejection` handlers; file watchers lack `error` listeners — a transient Windows FS error can crash the stdio server for the session.
- **MCPAT-131** — subtask status schema (forbids draft/approved) vs TypeScript type (allows them) diverge, and neither is enforced anywhere.
- **MCPAT-132** — status transition *semantics* undocumented (all 8 statuses ARE listed in CLAUDE.md, correcting the scout's initial overstatement — but reachability rules like blocked-from-draft and archived's entry point aren't).

### LOW

- **MCPAT-133** — two independent Windows test-harness EFTYPE bugs (`note-infer-confidence.test.ts`, `prepare-commit-msg.test.ts`) — both confirmed test-infra defects, not product bugs, via live repro.
- **MCPAT-134** — the CJS build output is dead code (throws at require-time) but provably unconsumed; drop the format.
- **MCPAT-135** — security hygiene bundle, all LOW under the stated threat model: triage prompt sanitization gap, one spawn site missing `CLAUDE_CLI_DISABLED`, one `exec()`-via-template-literal that should be `execFile`, 2 transitive high-severity npm audit advisories (likely unreachable — stdio transport, not hono).

## Killed / downgraded findings (what was refuted and why)

- **"ensureHealthyIndex silently corrupts data across processes" (D2, originally HIGH)** — REFUTED. Live test: Windows throws `EBUSY` on unlink-while-open, already swallowed safely by existing error handling. Downgraded to MEDIUM (lock check is still good hygiene for clearer errors).
- **"reconcile-github can bypass the transition guard to force blocked/draft→done" (D3.4, originally HIGH)** — REFUTED as stated. Live testing proved the shared `transitionTask`/`VALID_TRANSITIONS` layer already rejects the illegal jump; `pathToDone` routes through valid intermediate hops. Downgraded to MEDIUM — the literal absence of a confirmation gate remains real hygiene debt, but no illegal transition reproduces.
- **"deleteTask dependency-cascade bug is CRITICAL, causes data loss" (D1.5)** — Impact-lens downgraded to HIGH: MCP server unaffected, blast radius is one project's UI staleness, one-command recovery exists.
- **"prepare-commit-msg fails on Windows in production" (D3.1)** — REFUTED as a production defect. The test's fake git stub lacks a `.exe`/`.cmd` extension; Windows `execSync` silently resolves the *real* system `git.exe` instead, so the hook "correctly" no-ops in the test rather than the production hook actually misbehaving. Test-infra bug only (MCPAT-133).
- **"note-infer-confidence.test.ts failures reveal a real classification bug" (D5.1)** — REFUTED. `spawnSync` on a bare `.js` mock without `shell:true` throws `EFTYPE` on Windows; production's `resolveClaudeBinary()` never resolves to a bare `.js` file. Test-infra bug only (MCPAT-133).
- **"3.8GB index bloat" (docs/life-os/internal-research.md claim)** — stale. The live index is 4.6MB with an active self-heal (`index-health.ts`) already in place.
- **"CLAUDE.md doesn't document task statuses" (initial D7 read)** — corrected on spot-check: all 8 statuses ARE listed (CLAUDE.md:67); only the transition *semantics* are undocumented (folded into MCPAT-132).

## Budget note

Gold-tier target is ≤15 subagents; this audit used 5 scouts + 10 dimension-agent dispatches (7 unique dimensions, 3 required a relaunch after a mid-session usage-window reset cancelled them) + 9 Phase-5 verification agents = 24 total. The overage bought two REFUTED findings (D2 multi-process, D3.4) that would otherwise have shipped as false HIGH-severity backlog items — worth the cost per this skill's own stated rationale for the adversarial-verification phase.

## Provenance

- Rubric: `scratchpads/mcp-agent-tasks-gold-rubric.md` (baseline scores + verification ledger)
- Scout reports: `scratchpads/.gold-audit/s1-s5-*.md`
- Dimension reports: `scratchpads/.gold-audit/d1-d7-*.md`
- Phase-5 verification transcripts: `scratchpads/.gold-audit/verify-*.md`
- Milestone: `gold-audit-remediation-2026-07` (MCPAT project)
- Delivery brief: `docs/audits/2026-07-10-delivery-brief.md`
- Re-verify gate reality: `npm test 2>&1 | tail -20` (baseline 2026-07-10: 9 failed / 2137 passed / 7 skipped)
- Re-verify tool count: `grep -c "from './tools/" src/server.ts` vs `grep -o "[0-9]* MCP tools" README.md CLAUDE.md`
