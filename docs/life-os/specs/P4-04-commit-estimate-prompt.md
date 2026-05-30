# P4-04 — Commit-to-Today estimate prompt

**Type:** Feature
**Phase:** Phase 4 — Make the read-only UI usable
**Epic:** MCPAT-041 (Life OS — Phase 4: Usability)
**Task:** MCPAT-045
**Size:** S
**Depends on:** P4-01 (`PATCH /api/tasks/:id` with `estimate_hours`).
**Owners:** ui-specialist (commit-flow prompt + capacity gauge)

> Read `docs/life-os/specs/00-epic-overview.md` first — §3 (tokens), §4 (data shapes), §5 (client
> conventions). This resolves audit **decision 2** (`docs/life-os/audit/2026-05-30-functional-audit.md`
> §A7, "Product decisions required" #2): the capacity gauge reads **"0m / 6h"** because committed tasks
> have **null `estimate_hours`** — the math is real (`committedMinutes = Σ (estimate_hours ?? 0) × 60`,
> `server-ui.ts:1175-1177`) but the inputs are empty. Decision: **prompt for a quick estimate when
> committing a task to Today.**

---

## Why

The capacity gauge is a genuinely useful planning tool that currently reads 0 forever, because nothing
ever sets `estimate_hours` (audit §A7). The cheapest meaningful fix is to ask for an estimate **at the
moment of commitment** — when a user schedules a task to Today — so the gauge has real input. The estimate
is written via P4-01's `PATCH` (`estimate_hours`), and stays editable later in the panel (also P4-01).

---

## Scope

**In scope**
- When committing a task to Today (the existing schedule-to-today action — `POST /api/tasks/:id/schedule`
  with today's date), **prompt for a quick time estimate** before/with the commit if the task has no
  `estimate_hours`.
- Write the estimate via P4-01's `PATCH /api/tasks/:id` `{ estimate_hours }` (alongside / right after the
  schedule call).
- Make the **capacity gauge meaningful**: it already computes `Σ estimate_hours × 60` vs 360min — once
  estimates are populated it shows real numbers. Add the over/under-capacity colour (status green ≤80%,
  amber 80–100%, red >100%, per overview §3) if not already wired.
- **Zero / empty-state handling:** allow committing *without* an estimate (don't block the commit); a task
  with no estimate contributes 0 and the gauge shows an "unestimated" hint so the user knows the gauge is
  incomplete.
- Estimate is **editable later** in the panel — already delivered by P4-01; this spec just relies on it.

**Out of scope**
- The editable estimate field in the panel — **P4-01** (this spec reuses it).
- Changing the capacity *math* or the 360-min target — that math is correct (`server-ui.ts:1175-1177`);
  target-persistence is the epic Open Q (overview §11), not this spec.
- Requiring an estimate (hard gate) — default is **prompt but allow skip**; a hard requirement is an Open Q.
- Per-task estimate on the board / elsewhere — only the Today-commit flow.

---

## Data shapes / API contract

No new endpoint. Uses two existing/P4-01 routes in sequence:

```
POST /api/tasks/:id/schedule   body { date: "YYYY-MM-DD" }   // commit to Today (existing)
PATCH /api/tasks/:id           body { estimate_hours: number } // set estimate (P4-01)
```

- `estimate_hours` is a number of hours (matches overview §4 + the gauge math `× 60`). Validate `> 0` and
  reasonable (e.g. ≤ a sane cap); empty/skip → leave unset (contributes 0).
- Capacity (from `GET /api/today`): `capacity: { committedMinutes, targetMinutes }` (overview §4).
  `committedMinutes = Σ (estimate_hours ?? 0) × 60`. Gauge colour thresholds: ≤80% green, 80–100% amber,
  >100% red (overview §3).

---

## Acceptance Criteria

1. **Committing to Today prompts for an estimate.** Invoking the commit-to-Today action on a task with **no**
   `estimate_hours` opens a quick estimate prompt (a small input — minutes or hours, e.g. quick chips like
   30m/1h/2h/4h plus a free input). Tokens §3, no modal-for-detail (a lightweight inline prompt/popover is
   fine; this is a transient input, not a detail view).
2. **Estimate is written via PATCH.** Entering an estimate fires `PATCH /api/tasks/:id { estimate_hours }`;
   re-reading the task confirms `estimate_hours` persisted. The schedule (commit) still happens (task lands
   in Today).
3. **Skip is allowed.** The prompt has a skip/"later" path; skipping still commits the task to Today with no
   `estimate_hours`. No commit is blocked on the estimate.
4. **Capacity gauge becomes meaningful.** After committing tasks with estimates, the gauge reflects real
   `committedMinutes` (Σ estimate × 60) against the 360-min target — not "0m". A committed task with an
   estimate moves the gauge.
5. **Over/under-capacity colour.** The gauge is green ≤80%, amber 80–100%, red >100% of target
   (overview §3). (Falsifiable: committing estimates summing to >360min turns the gauge red.)
6. **Unestimated hint.** When one or more committed tasks have no estimate, the gauge shows a subtle hint
   (e.g. "2 unestimated") so the user knows the number undercounts. No error, just guidance.
7. **Already-estimated tasks skip the prompt.** Committing a task that **already** has `estimate_hours` does
   **not** re-prompt (it just schedules). (Idempotent UX — don't nag.)
8. **Gates pass.** `npm run type-check` (strict, no `any`) and `npm run build` succeed.

---

## Build steps

1. **Estimate prompt component.** Add a small `EstimatePrompt` (inline popover / lightweight panel, tokens
   §3) with quick chips (30m / 1h / 2h / 4h) + a free number input + Skip. **Test:** RTL — renders chips +
   input + skip; selecting a chip yields the right `estimate_hours` value (30m → 0.5).
2. **Hook into the commit-to-Today flow.** Find the existing "commit/schedule to Today" action (the
   `POST /api/tasks/:id/schedule` caller — `useToday`/`api.ts`). When it fires on a task with no
   `estimate_hours`, open the prompt; on submit, `PATCH { estimate_hours }` then schedule (or schedule then
   PATCH — order is fine as long as both land). Skip → schedule only. Already-estimated → skip prompt.
   **Test:** unit — committing an unestimated task opens the prompt; submitting fires PATCH + schedule;
   skip fires schedule only; an already-estimated task does not open the prompt.
3. **Capacity gauge colour + unestimated hint.** In the capacity gauge component (`CapacityGauge.tsx` per
   overview §6), apply the green/amber/red thresholds (overview §3) from `committedMinutes/targetMinutes`,
   and render an "N unestimated" hint counting committed tasks with no `estimate_hours`. **Test:** RTL —
   gauge is red when sum >100% target; shows the unestimated count when applicable.

---

## Test notes

- **Unit (UI, RTL):** prompt rendering + chip→value mapping; commit-flow branching (prompt vs skip vs
  already-estimated); gauge colour thresholds + unestimated hint (ACs 1–7).
- **No new server tests** — reuses `/schedule` (existing) + P4-01's PATCH.
- **Gate:** `npm run type-check` + `npm test` green before PR.

---

## Failure modes

- **Estimate write fails but schedule succeeded.** The task is committed without an estimate (gauge
  undercounts, hint shows it) — acceptable degradation, surface the PATCH error but don't un-commit.
- **Re-prompting on every commit.** Guard on existing `estimate_hours` (AC 7) so re-committing / re-opening
  doesn't nag.
- **Unit mismatch.** The gauge math is in *minutes* (× 60); the field is in *hours*. Convert at the field
  boundary (30m chip → `estimate_hours: 0.5`), never mix units in the gauge.

---

## Open questions

1. **Require vs prompt.** Default: prompt-but-skippable. If the team wants the gauge always-accurate, make
   the estimate **required** on commit — flag, don't build the hard gate now.
2. **Estimate granularity / units.** Default: hours field with minute-chips (0.5/1/2/4h). Confirm whether
   sub-30-min granularity is needed.
