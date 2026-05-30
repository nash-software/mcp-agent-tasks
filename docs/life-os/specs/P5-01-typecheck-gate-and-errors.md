# P5-01 — Type-check gate (`tsc -b`) + fix 22 UI type errors + reconcile status vocab

**Type:** Chore (foundational — real gate)
**Phase:** Phase 5 — Close the daily-use gaps + harden the gate
**Epic:** MCPAT-050 (Life OS — Phase 5)
**Task:** MCPAT-051
**Size:** M
**Depends on:** none (foundational — must land first; every later phase keeps `tsc -b` green)
**Owners:** ui-specialist (tsconfig + error fixes) · (doc) reconcile CLAUDE.md

> Read `docs/life-os/specs/00-epic-overview.md` first — §4 (the canonical `Status` union) and §13
> (Phase 5 framing). The evidence for every error in this spec lives in the audit
> (`docs/life-os/audit/2026-05-31-post-phase4-gaps.md` — the 🔴 CRITICAL section) — **do NOT
> re-investigate.** This is the **foundation of Phase 5**: the UI type-check gate is currently blind, so
> 22 real errors ship on `main`. Until this lands, no later Phase-5 spec's "gates pass" AC means anything
> for the UI half.

---

## Why

`src/ui/tsconfig.json` is solution-style (`"files": []` + `references`). The `src/ui` `type-check`
script runs plain `tsc --noEmit`, which **does not follow project references** — only `tsc -b` does. So
the script compiles **0 files** and reports success while real errors live in the referenced configs.

Running the real build (`npx tsc -b` in `src/ui`) surfaces **22 errors across 8 files**
(TS2367 ×3, TS2322 ×9, TS6133 ×7, TS2739, TS2678, TS2304 — audit 🔴 CRITICAL). CI runs the root
`npm run type-check`, whose UI half is the no-op, so **CI is green while 22 errors ship**. This is why
earlier phases shipped UI type errors and why the `'cancelled'` errors looked like "LSP noise" — they
are real, just never gated.

The biggest cluster is **dead `'cancelled'` branches**: `'cancelled'` is **not** in the canonical
`TaskStatus` union (`src/types/task.ts:1`), so every comparison against it is an unreachable
`TS2367` / unsatisfiable `TS2322`. Plus an incomplete `Record<TaskStatus,string>` (TS2739) and unused
declarations (TS6133). The fix is to **make the gate real** (`tsc -b`), **fix all 22 errors**, and
**reconcile CLAUDE.md's stale status vocabulary** so the docs and the code agree.

---

## Scope

**In scope**
- Change `src/ui` `type-check` script from `tsc --noEmit` → **`tsc -b`** (`src/ui/package.json:9`) so the
  gate compiles the referenced projects.
- Fix all 22 errors surfaced by `tsc -b`, specifically:
  - **Dead `'cancelled'` branches — remove them** (not add to the union): `useToday.ts:101`,
    `TodayView.tsx:131,142`, `RoadmapView.tsx:34`, `LiveFeedSection.tsx:217`.
  - **Complete the `Record<TaskStatus,string>`** at `lib/transitions.ts:12` (TS2739 — missing
    `archived` / `draft` / `approved` / `closed` keys) **or** narrow its key type to the actual board
    statuses it serves — pick the option that keeps the value's intent (see Build steps).
  - Remove unused declarations (TS6133) and resolve the remaining TS2322 / TS2678 / TS2304 reported by
    `tsc -b`.
- Reconcile **CLAUDE.md**'s stale state-machine line (`queued → in_progress → done | blocked | cancelled`)
  with the real `TaskStatus` union (`src/types/task.ts:1`).

**Out of scope**
- Any behavioural / feature change — this is a type-correctness + gate change only.
- Touching the **server** tsconfig or root `type-check` server half (it already runs `tsc --noEmit`
  against real files).
- The `npm ci`-in-`build` decoupling — that is **P5-08**.
- Adding RTL test infra (audit Q2 — deferred).

---

## Data shapes / API contract

No API change. The authoritative type (do **not** redefine — import):

```ts
// src/types/task.ts:1 — canonical, used by the whole store
type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked'
               | 'archived' | 'draft' | 'approved' | 'closed';
// NOTE: there is NO 'cancelled'. All 'cancelled' UI branches are dead code.
```

`lib/transitions.ts` already imports `TaskStatus` from `../types`. The `COLUMN_LABEL` /
`Record<TaskStatus,string>` at line 12 must either cover **all 8** keys or be typed to the narrower set
it actually populates (`BOARD_STATUSES`) — never a partial `Record<TaskStatus,…>` (that is the TS2739).

---

## Acceptance Criteria

1. **Gate is real.** `src/ui/package.json` `type-check` script is `tsc -b` (not `tsc --noEmit`). Running
   `npm --prefix src/ui run type-check` now **compiles the referenced projects** (non-zero file count),
   not a no-op. (Falsifiable: introducing a deliberate type error in a `src/ui/src` file makes the script
   exit non-zero; reverting makes it pass.)
2. **Zero errors from `tsc -b`.** `npx tsc -b` inside `src/ui` exits `0` — all 22 previously-surfaced
   errors are resolved. (Falsifiable: `tsc -b` output is clean.)
3. **`'cancelled'` branches removed, not re-added.** There is **no** reference to the string literal
   `'cancelled'` as a `TaskStatus` value in `useToday.ts`, `TodayView.tsx`, `RoadmapView.tsx`,
   `LiveFeedSection.tsx` (or elsewhere in `src/ui/src`); `'cancelled'` is **not** added to the
   `TaskStatus` union. (Falsifiable: grep for `'cancelled'` across `src/ui/src` returns no status
   comparisons; `src/types/task.ts:1` is unchanged for the union members.)
4. **`Record<TaskStatus,string>` is exhaustive or correctly narrowed.** `lib/transitions.ts:12` no longer
   raises TS2739 — the map either covers all 8 statuses or is typed to the narrower key set it populates.
   (Falsifiable: `tsc -b` reports no TS2739 there.)
5. **No unused declarations.** All TS6133 (unused locals/imports) reported by `tsc -b` are removed.
   (Falsifiable: `tsc -b` reports no TS6133.)
6. **CLAUDE.md reconciled.** The stale `queued → … | cancelled` state-machine line in `CLAUDE.md`
   (`## Standards`) is updated to match the real `TaskStatus` union (no `queued`, no `cancelled`; reflect
   `todo` and the real terminal states). (Falsifiable: CLAUDE.md no longer contains `cancelled` or
   `queued` as a task status; the state-machine line matches `src/types/task.ts:1`.)
7. **Root gate passes.** `npm run type-check` (root — server half `tsc --noEmit` + UI half now `tsc -b`)
   and `npm run build` both succeed. (Falsifiable: both exit `0`.)

---

## Build steps

1. **Flip the gate.** In `src/ui/package.json:9`, change `"type-check": "tsc --noEmit"` →
   `"type-check": "tsc -b"`. Run `npm --prefix src/ui run type-check` to surface the 22 errors as the
   working set. **Test:** the script now exits non-zero (errors present) — this is expected before the
   fixes; it proves the gate compiles real files.
2. **Remove dead `'cancelled'` branches.** In `hooks/useToday.ts:101`, `views/TodayView.tsx:131,142`,
   `views/RoadmapView.tsx:34`, `components/LiveFeedSection.tsx:217`: delete the `'cancelled'`
   comparisons / branches (TS2367 / TS2322). These are unreachable because `'cancelled'` ∉ `TaskStatus`.
   Do **not** add `'cancelled'` to the union. Verify each removal does not drop a real status case (the
   surrounding switch/conditionals must still cover the real terminal states `done`/`closed`/`archived`).
   **Test:** `tsc -b` no longer reports TS2367/TS2322 in these files; the views still render the correct
   status treatment for real statuses.
3. **Fix the `Record<TaskStatus,string>` (TS2739).** At `lib/transitions.ts:12`: this map currently
   serves board columns (`BOARD_STATUSES` = `todo|in_progress|blocked|done`). Choose the option that
   preserves intent: either (a) type it `Record<(typeof BOARD_STATUSES)[number], string>` (narrow to the
   4 board statuses it populates), or (b) add the missing `archived`/`draft`/`approved`/`closed` keys if
   the map is consumed for non-board statuses. Prefer (a) if it is board-only. **Test:** `tsc -b` reports
   no TS2739; board column labels still render.
4. **Resolve remaining TS6133 / TS2678 / TS2304.** Remove unused imports/locals (TS6133); fix the
   TS2678 (a `case` not comparable to the switch's union — likely another `'cancelled'`/stale status)
   and TS2304 (undefined name) per `tsc -b`'s file:line output. **Test:** `tsc -b` exits `0`.
5. **Reconcile CLAUDE.md.** In `CLAUDE.md` (`## Standards` — the `Task state machine:` line), replace
   `queued -> in_progress -> done | blocked | cancelled` with the real machine reflecting the
   `TaskStatus` union (e.g. `todo -> in_progress -> done | blocked | closed | …`; mirror
   `src/types/transitions.ts`). **Test:** grep CLAUDE.md for `cancelled` and `queued` (as task statuses)
   → no matches; the line matches the real union.
6. **Run both gates.** `npm run type-check` (root) and `npm run build` from the repo root both succeed.
   **Test:** both exit `0`; introducing a deliberate UI type error now fails the root `type-check`
   (proving the gate is wired end-to-end through CI).

---

## Test notes

- **Gate verification (primary):** `npx tsc -b` in `src/ui` exits `0`; a deliberately-injected UI type
  error makes both `npm --prefix src/ui run type-check` and root `npm run type-check` fail (then revert).
  This is the load-bearing test for this spec — the gate must actually catch errors.
- **Grep assertions:** no `'cancelled'` status comparisons remain in `src/ui/src`; CLAUDE.md has no
  `cancelled`/`queued` task-status references.
- **Gate:** `npm run type-check` + `npm run build` + `npm test` green before PR.
- No RTL needed (none of the changes are behavioural; RTL infra is deferred per audit Q2).

---

## Failure modes

- **Adding `'cancelled'` to the union to silence errors.** WRONG — it is not a real status; the store and
  state machine have no such state. This would mask the dead code and re-introduce drift. **Remove the
  branches.**
- **Leaving `type-check` as `tsc --noEmit`.** The gate stays blind; later phases' "gates pass" ACs remain
  meaningless for the UI. The script **must** become `tsc -b`.
- **Partial `Record<TaskStatus,…>`.** Re-introduces TS2739. Either cover all keys or narrow the key type;
  never a partial `Record` over the full union.
- **Reconciling only the code, not CLAUDE.md.** The stale doc line keeps misleading future agents about a
  `cancelled` status. Both must agree.

---

## Open questions

1. **`COLUMN_LABEL` key set.** Is the `lib/transitions.ts:12` map consumed anywhere outside the board? If
   board-only, narrow to `BOARD_STATUSES` (cleaner); if a non-board status reads it, make it exhaustive.
   Default: **narrow to `BOARD_STATUSES`**; confirm during build by grepping consumers.
2. **CLAUDE.md exact wording.** Mirror `src/types/transitions.ts`'s real map rather than inventing a
   shorthand. Default: copy the canonical transitions into the doc line so they cannot drift again.
