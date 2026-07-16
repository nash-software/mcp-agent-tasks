# Delivery Brief — Gold-Audit Remediation (2026-07-10)

Companion to `docs/audits/2026-07-10-gold-audit.md`. This brief encodes the audit's live context (verified constraints, refuted false leads, model-routing judgment) so `/deliver --milestone gold-audit-remediation-2026-07` never needs a top-tier model to re-derive what this audit already knows.

## Model routing table

Per the user's global standing rule: architect/plan-reviewer/verifier/refiner default to the top tier (currently `claude-fable-5`, reverting to `opus` when the Fable preview cap hits); Sonnet implements; Haiku handles mechanical work.

| Task class | Plan | Build | Verify | Human gate? |
|---|---|---|---|---|
| MCPAT-118 (ID collision, live specimen) | top-tier (dangerous: touches store routing + git history) | Sonnet | top-tier | **yes** — decide the new ID/branch name and confirm MCPAT-111's fix scope before touching store routing |
| MCPAT-111 (existing, wrong-store routing root cause) | top-tier | Sonnet | top-tier | **yes** — same reason; this is the shared root cause for MCPAT-118 |
| MCPAT-123 (dependency-cascade FK bug) | top-tier (schema/cascade correctness) | Sonnet | top-tier | no — narrow, well-reproduced, low blast radius (confirmed by Phase 5 impact review) |
| MCPAT-125 (nextId git-history watermark) | top-tier (this branch's original spec; re-plan from the now-corrected non-colliding ID) | Sonnet | top-tier | no |
| MCPAT-119 (non-hermetic test) | Sonnet (mechanical: mirror sibling files) | Sonnet | Sonnet | no |
| MCPAT-120/121/124 (doc drift bundle) | Haiku (mechanical: grep-and-write) | Haiku | Sonnet spot-check | no |
| MCPAT-122 (health coverage for UI) | Sonnet | Sonnet | Sonnet | no |
| MCPAT-126/127/128/129/130/131/132 (MEDIUM store/concurrency/docs) | Sonnet | Sonnet | Sonnet | no |
| MCPAT-133/134/135 (LOW test-infra + hygiene) | Haiku | Haiku | Sonnet spot-check | no |

**Rule of thumb applied:** anything touching the ID-assignment path, store routing, or the dependency-cascade schema gets the dangerous-task treatment (top-tier plan + verify, human gate on the two that intersect — MCPAT-118/MCPAT-111 share a root cause and should not be planned independently). Everything else is standard Sonnet-builds-from-a-strong-plan.

## Per-task matrix

| Task | Plan-first? | TDD? | Extra gates |
|---|---|---|---|
| MCPAT-118 | yes (this brief + MCPAT-111's plan must be read together) | no (rename/renumber operation, not new logic) | Verify no other ID references the old MCPAT-116 spec path before renaming |
| MCPAT-111 | yes | yes (regression test for store resolution) | Must land before or alongside MCPAT-118 |
| MCPAT-123 | yes | yes (the Phase-5 verifier's repro script is scratchpads/.gold-audit/verify-d1-5-factual.md — promote it to a real regression test) | none |
| MCPAT-125 | yes | yes | Depends on MCPAT-118/111 landing first (don't build the watermark logic against a still-broken ID-assignment path) |
| MCPAT-119 | no (mechanical, mirror pattern) | no | none |
| MCPAT-120/121/124 | no | no | none — doc-only |
| MCPAT-122 | yes (new logging/health-event call sites) | no | Register the new `daemon:mcp-agent-tasks-ui` source in `health-expectations.json` |
| MCPAT-126/127/128/129/130/131/132 | no (each is a scoped, well-specified fix) | yes where behavior changes (127, 130, 131) | none |
| MCPAT-133/134/135 | no | yes for 133 (test fixes) | none |

## Merge sequence

1. **MCPAT-111 + MCPAT-118 together** (shared root cause; land as one PR or two tightly-sequenced PRs) — this unblocks everything else that touches ID assignment.
2. **MCPAT-125** (nextId git-history watermark) — depends on step 1's routing fix being in place; this branch's original purpose.
3. **MCPAT-123** (dependency-cascade fix) — independent of 1-2, can run in parallel.
4. **MCPAT-119, 126-132** — independent of each other and of 1-3; parallelize freely.
5. **MCPAT-120, 121, 122, 124** — pure docs/health, no file-conflict risk with anything above; land whenever.
6. **MCPAT-133, 134, 135** — lowest priority, land last or batch into a single hygiene PR.

File-conflict note: MCPAT-123 and MCPAT-125 both touch `src/store/sqlite-index.ts` (different functions — `deleteTask`/`deleteCascade` vs `nextId`) — sequence them to avoid a merge race, not because either touches the other's code.

## Seed approach per Must-Ship/HIGH task

**MCPAT-118/111 (ID collision + wrong-store routing):** The verified constraint is that `resolveTasksDir`/store resolution has two divergent paths (legacy `~/.mcp-tasks` vs repo-local `agent-tasks/`) and `nextId()` computes its watermark independently per path — meaning the SAME project prefix can get two independent ID sequences if routing ever picks the wrong store. Acceptance criteria: (1) a single task-store resolution function is the only path that decides where a project's tasks live — no duplicate resolution logic; (2) `nextId()` for a given prefix always consults the SAME store's watermarks regardless of caller; (3) a regression test creates two tasks for the same prefix through both entry points (CLI and MCP tool) and asserts no ID collision. Architecture-contract invariant to preserve: markdown remains source of truth, SQLite remains a derived/rebuildable index — do not invert this while fixing routing.

**MCPAT-123 (dependency-cascade FK crash):** Verified constraint: `schema.sql`'s `dependencies` table has `depends_on REFERENCES tasks(id)` with NO cascade, and `foreign_keys=ON` always. Acceptance criteria: (1) `deleteCascade` in `sqlite-index.ts` deletes `dependencies WHERE task_id=? OR depends_on=?` (verified baseline-fails command: the live repro script in `scratchpads/.gold-audit/verify-d1-5-factual.md` throws `FOREIGN KEY constraint failed` today; after the fix it must NOT throw — this is the gold-patch check, already validated by the Phase-5 verifier's control run); (2) `pruneOrphans()` wraps each per-task delete in its own try/catch so one bad orphan can't abort the whole pass. Out-of-scope fence: do not touch `nextId()` or the routing logic here — that's MCPAT-118/125's scope.

**MCPAT-119 (non-hermetic test):** Mechanical — copy the `MCP_TASKS_CONFIG` beforeAll/afterAll pattern from any of the 16 sibling files (e.g. `tests/integration/reconcile-on-boot.test.ts`) verbatim into `serve-ui-html.test.ts`. Acceptance: `grep -c MCP_TASKS_CONFIG tests/integration/serve-ui-html.test.ts` returns ≥1 (baseline: 0).

**MCPAT-122 (UI health coverage):** Verified constraint: `src/server.ts` already has a working `appendHealthEvent`-based heartbeat pattern (line 386, 5-min interval) to copy. Acceptance: `grep -c appendHealthEvent src/server-ui.ts` returns >0 (baseline: 0), and a new entry exists in `~/.claude/hooks/config/health-expectations.json` for the UI source.

**MCPAT-120/121/124 (doc drift):** No code changes — pure documentation. Acceptance: `grep -c "20 MCP tools" README.md CLAUDE.md STATUS.md CONTEXT.md` returns 0 after the fix (baseline: 4); an Environment Variables table exists in README.md covering all vars from the audit's D7.2 list; the CLI reference section lists all 26 top-level commands.

## gates.json delta

No `.claude/gates.json` currently exists in this project (not checked at audit time — if `/deliver` introduces gated ACs for MCPAT-123/125/119, add:
```json
{
  "mcpat-123-dependency-cascade": { "command": "node scratchpads/.gold-audit/verify-d1-5-factual-repro.cjs", "expect_exit": 0 },
  "mcpat-119-hermeticity": { "command": "grep -c MCP_TASKS_CONFIG tests/integration/serve-ui-html.test.ts", "expect_min": 1 }
}
```
(Read-only rule holds for this audit — the delivery run applies this, not the audit.)

## Plans

Not authored this run (`--no-plans` was not passed, but given the scale already consumed by this audit — 24 subagents across scouting, dimension review, and adversarial verification — the Phase 6.5 plan factory was deferred to keep this session bounded; flagged to the user for a decision). If deferred, `/deliver --milestone gold-audit-remediation-2026-07` runs Stage-2 architect planning fresh, seeded by this brief.
