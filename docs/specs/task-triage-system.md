# Task Triage & Auto-Reconciliation System — Design Spec

**Status:** DRAFT — for review (no implementation yet)
**Task:** MCPAT-075
**Author:** design pass, 2026-06-06

## 1. Problem

The board carries ~297 open tasks that can't be reviewed by hand. Measured distribution (global `task_stats`, all projects):

| status | count |
|---|---|
| in_progress | 214 |
| todo | 83 |
| done | 341 |
| **closed** | **0** |
| draft | 12 |
| archived | 1 |
| **stale (claim TTL expired)** | **213** |

**214 in_progress / 213 of them stale / 0 ever closed.** Almost every "open" task is *started-but-never-closed*. The structural cause is known: the `post-merge` git hook that auto-transitions a task to `done` **fires only on a local `git merge`, not on `gh pr merge`** (remote squash + local fast-forward). Observed live on MCPAT-073 and MCPAT-074 this session — both needed a manual PR-link to flip to done. So merged work piled up as in_progress.

Two goals:
1. **Bring the number down now** — auto-resolve everything that is provably or confidently done/obsolete/duplicate.
2. **Keep it down** — fix the accumulation source so the queue doesn't refill.

## 2. Behaviour model (decided)

**Auto-apply across all tiers.** The engine applies its decision automatically when confidence clears the tier threshold; only genuinely-ambiguous tasks escalate to a human queue. Auto-apply is paired with a mandatory audit log + one-click undo (see §6) — non-negotiable given the engine acts without per-task confirmation.

## 3. Architecture — a tiered triage engine

Evaluate every open task (`todo, in_progress, blocked, draft, approved`) through tiers in order; first tier that produces a confident decision wins.

### Tier 0 — Deterministic git reconciliation (confidence: certain, no LLM)
Resolve on any hard signal:
- Linked **PR is MERGED** (query `gh pr view` in the task's project repo) → `done`
- Linked **commit SHA is in `origin/main`** history → `done`
- Linked **branch merged into main** (or deleted-after-merge) → `done`

This is the highest-ROI tier and likely clears the bulk of the 214 (they're merged-but-unflipped).

### Tier 1 — Heuristic rules (confidence: high)
- `in_progress` + stale (TTL expired) + no git activity in > N days + no open PR → `done` or `archive`
- `todo`/`draft` + age > M days + never claimed + no commits → **escalate to Tier 3** (cold backlog is never auto-archived — see decision D4)
- **Duplicate**: same normalized title within a project, or two tasks sharing one linked PR → close the dup, point at the survivor
- **Superseded**: task references another task that is already `done`

### Tier 2 — LLM triage (confidence: model-scored)
For the ambiguous remainder, build a compact per-task prompt:
`{id, title, why, type, status, age, last_activity, linked git, files[]}` + **repo signals** (do the referenced files exist now? does a feature keyword appear in code? recent commit touching its files?).
Ask claude (via the now-fixed `spawnClaudeStream`, with `sanitizeForPrompt` injection defense) for:
```json
{ "verdict": "done|obsolete|duplicate|still_relevant|unsure",
  "confidence": 0.0, "rationale": "…", "suggested_status": "done|archived|closed", "dup_of": "ID?" }
```
Apply if `confidence ≥ AUTO_THRESHOLD` (default 0.85) and verdict ∈ {done, obsolete, duplicate}; otherwise escalate.

### Tier 3 — "Needs your call" queue (UI)
Only what Tiers 0–2 could not decide (verdict `unsure`, conflicting signals, or below threshold). Surfaced with the engine's best guess + rationale + evidence, and action buttons.

## 4. Backend surface

- `src/triage/git-signals.ts` — PR/commit/branch merge detection; **cross-repo aware** (resolves each project's repo path from config).
- `src/triage/engine.ts` — tiered evaluator → `TriageDecision[]` `{ taskId, tier, action, confidence, rationale, evidence, fromStatus, toStatus }`.
- CLI: `mcp-agent-tasks triage [--apply] [--tier 0|1|2] [--project X] [--json]` (dry-run by default; `--apply` acts).
- MCP tool: `task_triage` (dry-run/apply) for agents + the UI.
- HTTP for the UI: `POST /api/triage/run` (returns decisions; applies when `apply:true`), `GET /api/triage/runs`, `POST /api/triage/undo`.
- **Root-cause fix:** reconcile-on-boot (and/or fix the merge→done transition to catch `gh` merges) so the queue stays down.

## 5. UI surface

- **A) Dedicated "Triage" nav view** — header summarises the last sweep ("214 → 78 · 136 auto-resolved · [Undo]"); below, the Tier-3 cards (engine guess + rationale + evidence chips) with buttons **Close / Keep / Archive / Merge-dup ▸ / Snooze ▸ / Open**, bulk-select, keyboard `j/k`+`enter`.
- **B) Advisor-integrated flow** — Advisor proactively: "I resolved 136 done tasks; 22 need your call — review?" then walks them one-by-one (reusing the `SuggestionCard` pattern).

Recommendation: start with **A** (deterministic, fast, no LLM dependency), layer **B** on top.

## 6. Safety (mandatory under auto-apply)

- **Audit log** per run → `triage-runs/<runId>.jsonl`, one line per action `{taskId, tier, fromStatus, toStatus, signal/rationale, ts}`. Task transition `reason` is stamped `auto-triage:tier0:pr#123 merged`.
- **Undo** — `triage undo <runId>` reverts a run's transitions (from→to recorded); one-click "Undo this sweep" in UI.
- **Never delete** — auto-apply only moves to `done`/`closed`/`archived`. `task_delete` stays manual.
- **Scope guards** — never auto-resolve a task updated in the last 24h, claimed by an active session, or carrying an **open** (unmerged) PR.
- **Conservative thresholds**, configurable via env/config.
- Every run, even auto-apply, emits a human-readable report of what it did.

## 7. Phasing (after approval)

| Phase | Deliverable |
|---|---|
| **P1** | Tier 0 engine + git-signals + CLI `triage` (dry-run + apply) + audit log + undo → run it, crush the 214 |
| **P2** | Reconcile-on-boot / merge-transition root-cause fix + `task_triage` MCP tool |
| **P3** | Tier 1 heuristics |
| **P4** | Triage UI view (option A) + `/api/triage/*` |
| **P5** | Tier 2 LLM triage + Advisor integration (option B) |

## 8. Resolved decisions (2026-06-06)

- **D1 — End-state status:** auto-resolved → `done`, then a later batch sweeps aged `done` → `closed`. Two-stage keeps a visible/auditable review window in the done column before final close. (`closed` = confirmed-finished-and-archived-from-view; `done` = work complete, still in recent view.)
- **D2 — UI home:** dedicated **Triage** nav view first (queue + bulk actions + Undo); Advisor-integrated conversational flow layered on in P5.
- **D3 — Cross-repo git checks:** resolve each project's repo path from config and run real `git`/`gh` checks; auto-detect and **fall back to the PR-state stored on the task** where a repo path is missing/unavailable.
- **D4 — Cold backlog:** stale `todo`/`draft` never started are **escalated to the Tier-3 queue** (Keep/Archive decision), never auto-archived.
