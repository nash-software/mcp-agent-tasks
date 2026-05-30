# P5-06 — Wire capture `context` + roadmap-assign error toast

**Type:** Feature
**Phase:** Phase 5 — Close the daily-use gaps + harden the gate
**Epic:** MCPAT-050 (Life OS — Phase 5)
**Task:** MCPAT-056
**Size:** S
**Depends on:** P5-01 (real gate)
**Owners:** ui-specialist (thread context, error toast)

> Read `docs/life-os/specs/00-epic-overview.md` first — §5 (client conventions, graceful degradation).
> Read **P4-06** (`P4-06-enablement-infra.md` item (d)) — its backend already reads/validates a `context`
> bias against known prefixes; the UI never sends it (the bias is **dormant**). Evidence: audit §C1, §E1
> (`server-ui.ts:1672,1687,1735` reads context vs `api.ts:83-94`, `CaptureOverlay.tsx:58,76` never
> sends; `RoadmapView.tsx:153-180` rolls back silently) — **do NOT re-investigate.**

---

## Why

**C1 — capture `context` bias is dormant.** The backend already reads and uses a `context` field on
capture (the COND-misroute fix from P4-06: `server-ui.ts:1672,1687,1735`, validated against known
prefixes), but the client's `quickCapture` (`api.ts:83`) sends only `{ text }` and `CaptureOverlay`
(`:58,76`) never threads the active project/view. So the bias the backend can apply is never supplied —
an ambiguous capture still routes context-free. This spec **threads the active project/view into the
`quickCapture` body** so the dormant bias activates.

**E1 — roadmap milestone-assign fails silently.** `RoadmapView`'s milestone-assign mutation
(`RoadmapView.tsx:153-180`) rolls back on error with **no visible error** — the user sees the assignment
revert and doesn't know why. This spec adds a visible error toast on that mutation's `onError`.

Both are small, share no backend, and batch cleanly into one S-sized PR.

---

## Scope

**In scope**
- Thread the **active project / view** into `quickCapture` (`api.ts:83`) + `CaptureOverlay`
  (`:58,76`) so the POST body includes `context` (the dashboard's current project/area), activating the
  P4-06 backend bias. Preserve the `#PREFIX` explicit override (it must still win over context).
- Add a **visible error toast** to `RoadmapView`'s milestone-assign mutation `onError`
  (`RoadmapView.tsx:153-180`) so a failed assign surfaces (overview §5), not just a silent rollback.

**Out of scope**
- Backend routing changes — P4-06 already reads/validates `context`; this spec only **sends** it. Do not
  re-touch `spawnBackgroundRouting`.
- Structured routing confidence (audit K3 — deferred).
- A global toast system rebuild — reuse the existing toast/inline-error mechanism from P4-01/P4-06.

---

## Data shapes / API contract

### `quickCapture` body — add `context`

```ts
// api.ts:83 — quickCapture(text, context?)
POST /api/capture/quick
{ text: string; context?: { project?: string; view?: string } }
```

- `context.project` = the dashboard's active project (from the current filter/view selection); the
  backend (P4-06) validates it against known prefixes and biases routing toward it for ambiguous text.
- `#PREFIX` in `text` is an **explicit override** and must continue to win over `context` (backend
  already honours this — the client must not strip or override it).
- Backend already accepts/validates `context` (`server-ui.ts:1672,1687,1735`) — **no server change**.

### Roadmap assign — error surfacing only

`RoadmapView.tsx:153-180` milestone-assign mutation: add `onError` → show a visible toast/inline error
(plus the existing rollback). No API shape change.

---

## Acceptance Criteria

1. **Capture sends `context`.** `quickCapture` (`api.ts:83`) accepts and includes a `context`
   (active project/view) in the POST body; `CaptureOverlay` (`:58,76`) supplies the dashboard's current
   project. (Falsifiable: a capture fired from a project-scoped view sends `context.project` in the
   request body.)
2. **Dormant bias activates.** With `context.project` supplied, an ambiguous capture is biased toward the
   active project (the P4-06 backend path now receives a value). (Falsifiable: with a known active
   project, an ambiguous text routes toward it rather than context-free; the backend reads the supplied
   `context`.)
3. **`#PREFIX` override still wins.** `#MCPAT note` captured from a COND-scoped view still lands in MCPAT
   — the explicit prefix overrides `context`. (Falsifiable: explicit-prefix capture ignores the context
   bias.)
4. **Roadmap assign shows an error.** A failed milestone-assign in `RoadmapView`
   (`RoadmapView.tsx:153-180`) surfaces a visible toast/inline error (not just a silent rollback)
   (overview §5). (Falsifiable: forcing the assign mutation to reject shows the error.)
5. **Graceful degradation preserved.** Capture with no active project (e.g. an all-projects view) still
   works — `context` is simply omitted/empty and behaviour falls back to the prior context-free routing.
   (Falsifiable: capture from an unscoped view succeeds with no `context`.)
6. **Gates pass.** `npm run type-check` (`tsc -b` green) + `npm run build` succeed; `npm test` green.

---

## Build steps

1. **Extend `quickCapture` (`api.ts:83`).** Add an optional `context` param and include it in the POST
   body when present. **Test:** unit — `quickCapture('x', { project: 'MCPAT' })` posts a body containing
   `context.project: 'MCPAT'`.
2. **Thread active project from `CaptureOverlay` (`:58,76`).** Read the dashboard's active project/view
   (from the filter/view state per overview §5) and pass it to `quickCapture`. Preserve the `#PREFIX`
   parse/override path. **Test:** RTL — capturing from a project-scoped view calls `quickCapture` with the
   matching `context`; a `#PREFIX` input still routes by prefix.
3. **Roadmap assign error toast.** In `RoadmapView.tsx:153-180`, add `onError` to the milestone-assign
   mutation → show the existing toast/inline error mechanism alongside the rollback. **Test:** RTL — a
   rejected assign mutation renders a visible error.
4. **Run gates.** `npm run type-check` + `npm run build` + `npm test`.

---

## Test notes

- **Unit (UI, RTL):** `quickCapture` body includes `context` (AC1); `#PREFIX` override path unchanged
  (AC3); CaptureOverlay threads the active project (AC2); Roadmap assign error toast on reject (AC4);
  unscoped-view capture omits `context` (AC5).
- **No backend test needed** — backend `context` handling is P4-06's coverage; this spec only sends it.
  (Optionally assert the backend already accepts a `context` body without 400, as a contract guard.)
- **Gate:** `npm run type-check` (`tsc -b`) + `npm test` before PR.

---

## Failure modes

- **Context overriding `#PREFIX`.** If the client lets `context` win over an explicit `#PREFIX`, captures
  mis-route. The explicit prefix must always win (backend honours this — don't undermine it client-side).
- **Sending an invalid/unknown project as context.** The backend validates `context` against known
  prefixes (P4-06); sending a stale/unknown value should be a no-op bias, not an error — but prefer
  sending only a known active project.
- **Silent roadmap assign (E1 regression).** Forgetting the `onError` toast leaves the silent-rollback
  bug. The error must be visible.
- **Breaking unscoped capture.** An all-projects view has no single active project; `context` must be
  omittable, not required.

---

## Open questions

1. **`context` shape — project only vs project+view.** Backend (P4-06) biases on project. Default: send
   `{ project }` (the load-bearing field); include `view` only if the backend can use it. Confirm against
   `server-ui.ts:1672,1687,1735`.
2. **Active-project source.** Use the FilterBar's selected project (P2-01) as the active context. Default:
   the current filter's project if exactly one is selected; omit `context` when "all". Confirm against the
   filter state model.
