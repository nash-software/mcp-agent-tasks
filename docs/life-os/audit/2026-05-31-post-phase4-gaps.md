# Life OS — Post-Phase-4 Gap Audit (Phase 5 input)

**Date:** 2026-05-31. Two read-only audits (functional/UX + tech-debt/correctness) of `main` after Phase 4 merged.

---

## 🔴 CRITICAL — the UI type-check gate is blind, 22 errors live on main

- `src/ui/tsconfig.json` is solution-style (`"files": []` + `references`). `tsc --noEmit` (the `src/ui` `type-check` script) compiles **0 files** — plain `tsc` doesn't follow project references; only `tsc -b` does.
- `npx tsc -b` in `src/ui` → **22 errors across 8 files** (TS2367 ×3, TS2322 ×9, TS6133 ×7, TS2739, TS2678, TS2304).
- CI runs `npm run type-check` → the no-op UI half → **green while 22 errors ship**. This is why earlier phases shipped UI type errors, and why the `'cancelled'` errors looked like "LSP noise" (real, just never gated).
- The biggest real errors: dead `'cancelled'` branches (not in `TaskStatus`) at `useToday.ts:101`, `TodayView.tsx:131,142`, `RoadmapView.tsx:34`, `LiveFeedSection.tsx:217`; incomplete `Record<TaskStatus,string>` at `transitions.ts:12` (missing archived/draft/approved/closed, TS2739).
- **Fix:** `src/ui` `type-check` → `tsc -b`; fix the 22 errors; reconcile CLAUDE.md's stale `queued→…|cancelled` state-machine line with the real `TaskStatus`.

---

## Functional gaps (blocks daily use)

| # | Gap | Sev | Evidence | Fix |
|---|-----|-----|----------|-----|
| A1 | Can't edit **project/area/tags/type** from UI (PATCH whitelist = title/why/priority/estimate/milestone; panel renders area/tags read-only) | blocks | `server-ui.ts:1483`, `TaskPanel.tsx:364-369,532-546` | add area/tags/type to PATCH + chip editors. (**project** reassignment deferred — see below) |
| A2 | No **"New task" form** (only quick-capture title + braindump) | blocks | `api.ts:53` createDraftTask draft-only | New-task modal → `POST /api/tasks` full fields |
| A3 | No **delete task** from UI (no DELETE route, no client fn) | friction | `server-ui.ts` (only /signoff DELETE) | `DELETE /api/tasks/:id` + guarded affordance |
| A4 | Milestone editable only from Roadmap, not the task | friction | `TaskPanel` has no milestone control | milestone select in TaskPanel (PATCH milestone exists) |
| B1 | **Closed tasks can't be reopened** (no out-transition; CompletedView read-only) — mistaken "Complete all" is permanent | blocks | `transitions.ts:28`, `CompletedView.tsx` | allow closed→todo/in_progress; make Completed rows open panel |
| B2 | Completed tab is a dead-end (plain `<li>`, no click/action) | friction | `CompletedView.tsx:158-172` | rows open TaskPanel |
| C1 | Capture **`context` bias is dormant** — backend reads/uses it (the COND fix), UI never sends it | friction | `server-ui.ts:1672,1687,1735` vs `api.ts:83-94`, `CaptureOverlay.tsx:58,76` | thread active project into `quickCapture` body |

## Correctness / security (backend)

| # | Issue | Sev | Evidence | Fix |
|---|-------|-----|----------|-----|
| K1 | `rerouteTask` is **SQLite-only** (mints new ID + upsert/delete in index, no markdown move) → violates markdown-first; a reconcile resurrects the GEN original & drops the reroute (silent data loss) | correctness | `server-ui.ts:585-609`, `sqlite-index.ts:448` | markdown-first ID-migration (move file + rewrite refs) before index. **This is also the blocker for A1 project reassignment.** |
| K2 | Quick-capture + braindump inject raw user text into `claude -p` **without** the sentinel/`sanitizeForPrompt` hardening the triage path uses (prompt injection; low blast radius). Inputs ARE length-bounded (2000/10000) | security-med | `server-ui.ts:651,1761` vs `buildTriagePrompt:716-737` | wrap untrusted text in `<task>` sentinels + sanitize, like triage |
| K3 | Routing confidence is a prompt instruction ("reply GEN if unsure"), not a structured threshold like triage has | maintainability | `server-ui.ts:651,680` | optional: structured `{prefix,confidence}` + threshold |

## Board / mobile

| # | Gap | Sev | Evidence | Fix |
|---|-----|-----|----------|-----|
| D1 | Board DnD is **desktop-only** (PointerSensor only, no TouchSensor) — competes with scroll on phones | friction | `BoardView.tsx:121-128` | add `TouchSensor` w/ delay activation |
| F1 | **No mobile layout**; board grid is inline `repeat(4,...)` so media queries can't reflow it | friction | `index.css:297-306`, `BoardView.tsx:257,172` | responsive grid class `grid-cols-1 sm:2 lg:4`; add <768px breakpoint |
| D2 | `draft`/`approved` tasks have no board home | friction | `transitions.ts:9` | column or "other" affordance (design decision) |

## Quality / build

| # | Issue | Sev | Evidence | Fix |
|---|-------|-----|----------|-----|
| E1 | Roadmap milestone-assign rolls back silently on error (no visible error) | friction | `RoadmapView.tsx:153-180` | error toast |
| Q1 | `npm run build` runs `npm --prefix src/ui ci` every build (wipes node_modules; broke local dev; runs ~3× in CI) | maintainability | `package.json:33`, `ci.yml:29` | decouple install from build |
| Q2 | 24/72 test files (33%) are source-inspection (`toContain('literal')`) — brittle (broke CI once); **no RTL infra** (`@testing-library/react` not installed) | maintainability | tests/unit/* | add RTL deps + convert highest-value suites (large — defer) |

---

## Proposed Phase 5 (prioritized; ship high-value, defer large/risky)

- **P5-01 (CRITICAL):** type-check gate → `tsc -b` + fix all 22 UI type errors + reconcile CLAUDE.md status vocab. *Foundational — do first.*
- **P5-02:** backend correctness/security — `rerouteTask` markdown-first ID-migration (K1) + sentinel-harden routing/braindump prompts (K2).
- **P5-03:** task editing — area/tags/type in PATCH + TaskPanel editors + milestone control (A1 partial, A4).
- **P5-04:** New-task form (A2) + delete task (A3).
- **P5-05:** reopen closed + interactive CompletedView (B1, B2).
- **P5-06:** wire capture context (C1) + roadmap-assign error toast (E1).
- **P5-07:** board mobile — TouchSensor + responsive grid (D1, F1).
- **P5-08 (chore):** decouple `npm ci` from build (Q1).

**Deferred (noted, not auto-shipped):** project reassignment (A1 project — needs K1's ID-migration primitive first), draft/approved board columns (D2 — design decision), RTL test migration (Q2 — large; add infra + convert incrementally), structured routing confidence (K3).
