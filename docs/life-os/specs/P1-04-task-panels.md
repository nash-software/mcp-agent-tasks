# P1-04 — Task Peek & Detail Panels

**Type:** Feature
**Phase:** 1 (Reskin)
**Epic:** MCPAT-022 — Life OS UI Reskin
**Size:** M

> Shared tokens, data shapes, and client conventions live in
> [`00-epic-overview.md`](./00-epic-overview.md). This spec references §3 (motion), §4 (Task shape),
> and §5 (panel state `{mode, taskId}`) — it does not repeat them.

---

## Description

The current `TaskDetailPanel.tsx` is a single, one-size full panel triggered from a row. The Life OS
design (handoff §6.3) splits task inspection into **two modes** sharing one component:

- **Peek (380px)** — a lightweight glance triggered by `Space` on a selected row or a row click. The
  list stays fully visible beside it; the user scans without losing context. Most inspection is a
  peek.
- **Detail (440px)** — the full record (adds **Status history**), reached by promoting a peek with
  `Enter`, by the hero "Open detail" action, or by a click in the Board view.

**Why peek-vs-detail (not one panel):** the two represent different intents. A peek is a "what is
this?" glance during triage where the list context matters; detail is "I'm working this one" where
history and full provenance matter. Forcing one width/content set makes peeks too heavy and details
too cramped. Splitting them keeps the common path (peek) fast and visually quiet while still offering
the full record on demand.

**Why never a modal:** detail must coexist with the list — the user reads a task *against* its
neighbours and the capacity context, and dismisses with a single `Esc` without a focus trap or
backdrop blocking the rest of the surface. A modal would dim and block the list, breaking the
"glance and keep scanning" loop and violating the epic anti-pattern "❌ Modals for detail views — use
slide-in panels" (§9). The panel is therefore `absolute` within `main`, not `fixed` with a backdrop.

This spec **refactors the existing** `TaskDetailPanel.tsx` into `components/TaskPanel.tsx`. The
existing component already uses a transform-only slide (good — keep that), but only renders one full
mode, uses a `fixed` modal backdrop, keys on hardcoded `slate/blue` colours, and carries a mojibake
bug (`â†’` instead of `→`) at ~line 177. All of these are corrected here.

---

## Acceptance Criteria

1. **Two widths driven by `panel.mode`.** When `panel.mode === 'peek'` the panel renders at **380px**;
   when `panel.mode === 'detail'` at **440px**. The width transitions with the spring ease. The panel
   is positioned `absolute` against the right edge of `main` (not `fixed`, no backdrop, no modal) and
   the task list remains visible and interactive beside a peek.
2. **Transform-only slide (no opacity fade).** Slide-in uses `transform: translateX(26px)` → `0` over
   200–220ms on `--ease-spring`; the hidden state is reached by translating offscreen, **never** by
   animating opacity to `0`. This honours the §3 motion rule: animating opacity to a hidden state
   freezes offscreen content at frame 0 and blanks the panel. (Anti-pattern §9: "❌ Animating opacity
   from 0 on panels".)
3. **`Enter` promotes peek → detail.** With a peek open, pressing `Enter` switches `panel.mode` to
   `'detail'` for the same `taskId` (no close/reopen, no flicker) and the width animates 380→440.
   `Enter` has no effect when already in detail.
4. **`Esc` closes either mode.** `Esc` clears `panel` (sets it to `null`/closed) from both peek and
   detail, sliding the panel offscreen via transform only.
5. **Status history is detail-only.** The Status-history section (transitions, `GET /api/activity`-style
   `from → to` + relative time) renders **only** when `panel.mode === 'detail'` and is absent in peek.
   All other body fields (title, area chip + priority + status badge + estimate, blocked reason, why,
   linked docs, git, tags) render in both modes.
6. **Header + footer match spec.** Header shows status dot, mono task ID, the literal label
   `Peek` or `Detail` per mode, and a close `×`. Footer renders actions: **Done**, **Commit/Remove
   today** (label reflects whether the task is scheduled for today), and disabled **Hermes** and
   **ACR** stubs. The peek footer additionally shows the hint `Enter` full detail · `Esc` close.
7. **Mojibake fixed + no hardcoded palette.** The arrow renders as `→` (U+2192), not `â†’`. Status
   colours come from the §3 token set (status dots / area colours), not literal `text-slate-*` /
   `text-blue-*` classes, and the surface is `surface-1` with a `surface-3` left hairline border and a
   soft left shadow.

---

## Technical Notes

- **File:** refactor `C:\code\mcp-agent-tasks\src\ui\src\components\TaskDetailPanel.tsx` →
  `C:\code\mcp-agent-tasks\src\ui\src\components\TaskPanel.tsx`. Update all imports (currently
  `App.tsx`). Remove the old file in the same commit.
- **State ownership (P1-02 / App).** Per epic §5, `panel: { mode: 'peek' | 'detail'; taskId: string } | null`
  is **client UI state owned by `App.tsx`** (P1-02), not internal to this component. `TaskPanel` is a
  controlled component: it receives `panel` (or the resolved `task` + `mode`) and `onClose` /
  `onPromote` / action callbacks as props. The global `Enter`/`Esc` handlers live in App's key
  handler (P1-02), which mutates `panel`; the panel itself only renders from props and fires
  callbacks. The peek footer hint and the Board/Today triggers all flow through this single App-owned
  `panel` value.
- **Trigger sources (consumers).**
  - P1-03 Today view: `Space` on selected row → `mode:'peek'`; row click → `mode:'peek'`; hero
    "Open detail" / `Enter` → `mode:'detail'`.
  - P1-09 Board view: card click → `mode:'detail'`.
  These consumers set `panel` via App; this spec does not own the triggers, only the rendering and
  the `Enter`/`Esc` behaviour contract.
- **Actions reuse P1-03 optimistic mutations.** Footer **Done** and **Commit/Remove today** call the
  *same* optimistic TanStack Query mutations defined for the Today task rows (P1-03) —
  `markDone` and the `schedule({ date })` mutation against `POST /api/tasks/:id/schedule` (epic §5).
  Do **not** introduce panel-local mutation logic; import/reuse the shared hooks so the panel and the
  list stay in sync and roll back together. Invalidate `['today']` / `['tasks']` as those hooks
  already do.
- **Task shape.** Read fields from the canonical `Task` (epic §4): `area`, `priority`, `status`,
  `estimate_hours`, `block_reason` (red, only when `status==='blocked'`), `why`, `spec_file` /
  `plan_file` (render as file rows under Linked docs), `git.branch` / `git.commits[]` / `git.pr`,
  `history[]` (detail-only), `tags[]`. Use real-store status names — `todo` not `queued` — and the §3
  status/area colour tokens (reconcile against the enum-drift note in epic §2 / P1-01 if the Badge
  component is shared).
- **Motion constraint (§3).** Panel slide is **200–220ms, transform-only**, on
  `--ease-spring: cubic-bezier(0.16,1,0.3,1)`. Width change (peek↔detail) animates on the same ease.
  Nothing on this panel may animate opacity to a hidden state.

---

## Failure Modes

- **Task deleted/missing while panel open.** If the `taskId` in `panel` no longer resolves to a task
  (deleted in another tab, or refetch dropped it), the panel must close gracefully — slide offscreen
  via transform and clear `panel` — rather than render `null` fields or throw. Resolve the task from
  the live query cache; if `task === undefined` for an open `panel`, treat as a close. Never crash the
  surface.
- **Optimistic action mid-flight then task vanishes.** If `markDone`/`schedule` is in flight and the
  task is removed, the shared mutation rollback (P1-03 hooks) governs cache state; the panel must
  reflect the rolled-back/closed state and not retain a stale optimistic render.
- **Missing optional fields.** `git`, `spec_file`, `plan_file`, `why`, `tags`, `history` are all
  optional — each section renders only when present (mirror the existing guarded sections). An empty
  task (only id/title/status) shows a valid minimal panel.

---

## Out of Scope

- **Hermes and ACR footer actions** — these are **Phase 2** (P2-05 / P2-06). Render them as **disabled
  stubs** (visible, non-interactive) in Phase 1; do not wire any agent dispatch.
- **Command palette** (`Cmd+K`) — P1-10, separate spec (note: P1-10 depends on this panel).
- Job-detail / output-stream panels (that is the ambient ACR panel, P1-05).
- Editing task fields inline from the panel (read + lifecycle actions only this phase).
- The status-dot / priority-bar / Badge token reconciliation itself (owned by P1-01); this spec
  consumes the reconciled tokens.

---

## Dependencies

- **P1-01** — design-system foundation (tokens, surfaces, status/area colours, `--ease-spring`).
- **P1-02** — App shell owns `panel` state and the global `Enter`/`Esc` key handlers that drive
  promote/close.

**Consumed by:**
- **P1-03** — Today view triggers peek (Space/click) and detail (Enter/hero).
- **P1-09** — Board view triggers detail (click).
- **P1-10** — Command palette opens tasks into this panel.

---

## Testing

- **Unit (component, React Testing Library / vitest):**
  - Renders at 380px container width when `mode='peek'`, 440px when `mode='detail'`.
  - Status-history section is absent in peek and present in detail for a task with `history[]`.
  - Header label reads `Peek` vs `Detail` per mode; close `×` fires `onClose`.
  - Footer renders Done + Commit/Remove today; Hermes and ACR are present but `disabled`.
  - Peek shows the `Enter` full detail · `Esc` close hint; detail does not.
  - Optional sections (git / linked docs / why / tags) omitted when their fields are absent.
  - Regression: rendered transition arrow is `→` (U+2192), asserting the mojibake is fixed.
- **Interaction:** `Enter` on an open peek promotes to detail (mode flips, width grows) and is a no-op
  in detail; `Esc` closes from both modes. (Key handling may live in P1-02; assert the panel responds
  to the resolved mode/close props.)
- **Failure path:** when the resolved task becomes `undefined` while `panel` is set, the panel closes
  and does not throw.
- **Motion (assertable):** the panel's hidden/visible state is expressed via a `translateX` transform
  class, never an `opacity-0` hidden state — assert the className/style contract.
- **Type-check + build:** `npm run type-check` (strict, no `any`) and `npm run build` pass after the
  refactor; no remaining imports of the old `TaskDetailPanel`.

---

## Open Questions

- **Width transition on promote:** animate 380→440 as a width tween, or cross-fade content while the
  frame springs? Default: width tween on `--ease-spring`, content swapped instantly (history simply
  mounts). Confirm against `panels.jsx` during build.
- **Commit/Remove label source:** does "today" reflect `scheduled_for === today` from the `['today']`
  cache or from the task's own `scheduled_for`? Default: derive from `scheduled_for` so the panel is
  correct regardless of which view opened it.
- **Where the `Enter`/`Esc` listeners bind:** confirmed App-global in P1-02 — verify P1-02 exposes
  `onPromote`/`onClose` so the panel needs no internal `keydown` listener (avoids double-binding when
  the command palette is open).
