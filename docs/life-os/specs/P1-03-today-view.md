# P1-03 — Today view (hero, capacity, task rows, candidates, J/K)

**Type:** feature
**Phase:** 1 — Reskin
**Epic:** MCPAT-022 — Life OS UI Reskin + Agent Layer
**Size:** L

> Reads shared tokens, data shapes, and client conventions from the epic anchor:
> `docs/life-os/specs/00-epic-overview.md` (§3 tokens, §4 Task shape, §5 query keys + optimistic
> mutations). This spec does not repeat the token table or the `Task` interface — cite the anchor.
> Visual reference: `design_handoff_life_os/screenshots/01-today.png`,
> prototype `design_handoff_life_os/reference/today.jsx` + `reference/shared.jsx`.

---

## Description — why this is the core loop

Today is the default view and the heart of the daily loop: "what am I doing right now, what did I
commit to today, and how much have I over-promised?" The current `TodayView.tsx` scans like a flat
list — there is no single authoritative answer to "what now," capacity is read-only, and the row
component is a bordered card (not a 40px row). The prototype answers the loop with a three-tier
hierarchy: one high-weight **in-progress hero** with a live timer, a **capacity gauge** that warns
before you over-commit, and a dense **committed list + candidate queue** where committing a task is
one instant click. This spec rebuilds Today to match the prototype at high fidelity and wires every
interaction through optimistic TanStack mutations so the surface feels instant.

This is the surface that proves the reskin's design language (status dots, priority bars, area chips,
mono tabular numerics) — every later view reuses the consolidated `TaskCard` row built here.

---

## Domain Model — brief

- **In-progress hero invariant:** there is **at most one** `status === 'in_progress'` task. The hero
  renders that single task; if none exists, the hero is the dashed empty state. The view never shows
  two heroes — if the API returns more than one in-progress task, render the first by priority and
  treat the rest as committed rows (defensive; log a warning).
- **Committed = `scheduled_for === today`** (today = local `YYYY-MM-DD`), excluding the in-progress
  hero and `cancelled`. Sorted by `PRI_RANK` (critical=0 … low=3); `done` tasks sink to the bottom.
- **Candidates = `scheduled_for == null && status === 'todo'`** (prototype `queued` → real `todo`,
  per epic §4). Grouped by area in fixed order `client · personal · internal · outsource`.
- **Capacity zones:** `pct = committedMinutes / targetMinutes`. green ≤ 0.80 · amber 0.80–1.0 ·
  red > 1.0. Fill width is `min(pct,1)`; fill and label colour follow the zone. The committed total
  for capacity counts committed tasks that are **not** `done`/`cancelled` (a done task no longer
  consumes capacity).
- **Live timer source:** elapsed since the task was claimed. The real `Task` (epic §4 / `types.ts`)
  has **no `claimed_at` epoch field** — derive the start instant from the most recent transition into
  `in_progress` (`transitions[]` `to === 'in_progress'` `at`), or `claimed_by`-era metadata if the
  server exposes it. See Technical Notes + Open Questions.

---

## Acceptance Criteria

1. **Single hero, never truncated.** When a task is `in_progress`, `HeroTask` renders it as the
   `signal` variant (card with a blue left accent bar). The title is 19px / weight 600 and is
   **never truncated or ellipsised** at any viewport width (it wraps). A "● In progress" pulsing
   eyebrow is shown.
2. **Live elapsed timer ticks every second.** The hero shows a mono (`tabular-nums`) elapsed timer
   derived from the in-progress start instant; it advances once per second (`setInterval` 1000ms,
   cleared on unmount / task change) and formats as `H:MM:SS` (or `M:SS` under an hour) per
   `fmtElapsed`.
3. **Empty hero state.** With no in-progress task, the hero is a dashed card reading "Nothing in
   progress — pick one from today's list, or press `J` then `Enter`." (kbd-styled keys).
4. **Capacity gauge shows both numbers + zone colour.** The label reads e.g. `4h 45m / 6h committed`
   in mono tabular-nums; the bar fill width = `min(pct,1)*100%` and fill+number colour follow the
   green/amber/red zone. Over 100% renders a red "Over target by `<Δ>` — consider deferring
   something." hint.
5. **Inline-editable target.** Clicking the target number turns it into a numeric input
   (autofocus); `Enter`/blur persists, `Escape` reverts. Persisted to `localStorage('lifeos-target')`
   (minutes or hours — be consistent with the gauge's unit). Invalid/≤0 input reverts to prior value.
6. **One consolidated 40px `TaskCard` row.** Committed and candidate rows use a single `TaskCard`:
   8–9px status dot (running variant has a soft `animate-pulse` ring), 14px title with ellipsis at
   ~60ch, a 2px coloured left priority bar (critical=red / high=amber / medium=faint / low=none), and
   a right meta cluster: priority tag (text **only** for critical/high), `est`, area dot that expands
   to a labelled chip on hover, prefix badge, and a hover-revealed `…` menu (committed) or `+` button
   (candidate). Row hover = `surface-1`; J/K-selected = `surface-2` + inset accent ring.
7. **Instant commit, no confirm.** Clicking `+` on a candidate row commits it to today in a single
   click with no confirmation dialog; the row optimistically moves into the committed list (the
   committed total + capacity update immediately) and animates in.
8. **Keyboard loop is optimistic.** With selection state from the shell (P1-02): `J/K`/`↑/↓` move
   selection, `Space` peeks the selected row, `Enter` opens detail, `D` marks done, `P` cycles
   priority, `T` toggles committed/uncommitted. Each mutating key updates the cache immediately and
   rolls back on server error.

---

## Technical Notes

**Target files (split as named):**
- `src/ui/src/views/TodayView.tsx` — layout orchestrator: hero → capacity → committed list →
  collapsible candidate queue → existing `LiveFeedSection` stays (right rail wiring is P1-05; leave
  the current placement until then). Remove the private inline `TaskCard`/`CapacityGauge`/`AreaBadge`
  currently defined in this file.
- `src/ui/src/components/HeroTask.tsx` — new. Props: `{ task: Task | null; onDone; onPause; onBlock;
  onOpenDetail }`. `signal` variant only (others optional toggles, not required). Meta row: prefix
  badge, area chip, priority tag, `est <fmtEst>`, git branch (`task.git?.branch`, with a git glyph).
  `why` in a left-bordered block. Actions: Mark done (primary `btn`), Pause (→ `todo`), Block
  (→ `blocked`, `window.prompt` for reason then pass as `block_reason`/transition reason), Open
  detail (ghost, right-aligned). Timer effect keyed on `[task?.id, startInstant]`.
- `src/ui/src/components/CapacityGauge.tsx` — new. Props: `{ committedMinutes; targetMinutes;
  onTargetChange }`. `bar` render style (segmented/ring optional, not required). Inline-edit state is
  local; persistence is the caller's `onTargetChange`.
- `src/ui/src/components/TaskCard.tsx` — **consolidate**. There are currently two divergent TaskCards:
  the exported bordered-card `components/TaskCard.tsx` and the private 40px-ish `TaskCard` inside
  `TodayView.tsx`. Collapse both into ONE 40px row component matching `reference/shared.jsx`
  `TaskRow`. Audit every importer of the old `components/TaskCard.tsx` (Board uses it) before
  changing its prop shape — keep it usable by BoardView or coordinate the prop change. Props at least:
  `{ task; mode?: 'committed' | 'candidate'; selected?; onClick?; onCommit?; onMenu?; animClass? }`.
- `src/ui/src/lib/format.ts` — new (per epic component map §6). Port `fmtEst`, `fmtHM`, `fmtElapsed`,
  `PRI_RANK` from `reference/shared.jsx`. Keep `lib/time.ts` `relativeTime` as-is; do not duplicate.
- `src/ui/src/hooks/useToday.ts` — extend with the optimistic mutations below.

**Atoms:** build `StatusDot`, `AreaDot`, `AreaChip`, `PrefixBadge` as small components (in
`TaskCard.tsx` or a `components/atoms.tsx`) keyed on the **real** status/area unions — reconcile enum
drift to `types.ts` first (epic §note: `Badge.tsx` keys on `queued`; canonical is `todo`). Status dot
colours: in_progress=blue (pulsing ring), done=green, blocked=red, todo=muted, cancelled=faint.

**Optimistic mutation pattern (epic §5):** replace the current `invalidateQueries`-only helpers in
`useToday.ts` with TanStack `useMutation` using the cancel → snapshot → `setQueryData` → rollback →
`onSettled invalidate` pattern:

```ts
const m = useMutation({
  mutationFn: ({ id, date }) => scheduleTask(id, date),          // POST /api/tasks/:id/schedule {date}
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: ['today'] })
    const prev = qc.getQueryData<TodayResponse>(['today', targetMinutes])
    qc.setQueryData(['today', targetMinutes], (d) => /* move task committed↔candidate */)
    return { prev }
  },
  onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['today', targetMinutes], ctx.prev),
  onSettled: () => { qc.invalidateQueries({ queryKey: ['today'] }); qc.invalidateQueries({ queryKey: ['tasks'] }) },
})
```

- **Endpoints:** commit/uncommit/toggle → `POST /api/tasks/:id/schedule` `{ date: 'YYYY-MM-DD' | null }`.
  Mark done / pause / block / priority-cycle → the existing task transition/update path (whatever
  `api.ts` exposes; if a transition endpoint is missing, route through `PATCH`/update of `status` and
  `priority`). All exist (epic §76 — Phase 1 endpoints all present).
- **Query keys to invalidate:** `['today']` always; also `['tasks']` for status/priority changes; do
  **not** touch `['acr','status']` here. The query key includes `targetMinutes` (`['today', target]`)
  — keep `setQueryData`/`getQueryData` keyed consistently or the optimistic write misses the cache.
- **`today` constant:** local-time `new Date().toISOString().slice(0,10)` is UTC-shifted; prefer a
  local `YYYY-MM-DD` to match how the server computes "today" — verify against `/api/today`.
- **Selection state** is owned by the shell (P1-02) and passed in as `selectedTaskId` + handlers;
  this view does not own the global key listener, it only renders selected styling and exposes the
  per-row actions the shell's handlers call.
- **Filtering note (forward-compat):** when the global filter lands (P2-01) it narrows the **committed
  list and candidate queue only** — never the hero or the capacity gauge. Structure the view so the
  filter is applied to the two lists, not to the hero/capacity inputs.
- **"Needs your call" sub-section (P2-04b forward-compat):** the candidate queue gains a pinned
  sub-section above the regular unscheduled group: `▸ Needs your call · N` — shows `status:'draft'`
  tasks that the P2-04b auto-triage flagged as ambiguous (have a `triage_note`). Each row shows the
  `triage_note` as a secondary line and the Haiku-suggested `project`/`priority` pre-filled; a
  "Promote" action calls `POST /api/tasks/:id/promote` + `POST /api/tasks/:id/schedule` (if committing
  to today). This sub-section is **hidden when empty** (most of the time it will be). Implement the
  query (`GET /api/tasks?status=draft`) and the sub-section layout here in P1-03; the triage backend
  is P2-04b. The sub-section can be stubbed with an empty array for Phase 1 and wired in P2-04b.

---

## Failure Modes

- **Schedule/commit mutation fails:** the optimistic move (candidate→committed or toggle) rolls back
  via the snapshot in `onError`; the row returns to its prior section and capacity reverts. No error
  toast required for Phase 1 beyond silent rollback, but never leave the cache in the optimistic state.
- **No in-progress task:** hero renders the dashed empty state (AC #3), not a blank or a crash. The
  live timer effect must early-return when `task` is null (no dangling interval).
- **Missing start instant for the timer:** if no `in_progress` transition timestamp is resolvable,
  render the hero **without** the timer (omit it) rather than showing `NaN`/`0:00` ticking from epoch.
- **Multiple in-progress tasks (invariant violation):** render the highest-priority one as hero, log
  a warning, fold the rest into committed rows. Do not render two heroes.
- **`targetMinutes` zero/unset:** `pct` guards against divide-by-zero (`target > 0 ? … : 0`); gauge
  shows 0% rather than `Infinity`.

---

## Out of Scope

- **Peek / detail panel internals** — the slide-in panels triggered by `Space`/`Enter`/`Open detail`
  are built in **P1-04**. This spec only invokes the shell-provided `openPeek`/`openDetail` handlers.
- **The `…` menu's P2 actions** — "Sign off to Hermes" and "Dispatch to ACR" are rendered as
  present-but-disabled stubs only. Commit/Remove today, Mark done, and Open detail are live.
- **Global filter / FilterBar** — P2-01. Leave the structural hook (filter applies to lists only) but
  do not build the filter UI or state here.
- **Right ambient rail relocation** — P1-05 moves `LiveFeedSection` into the right rail; leave it in
  place here.
- **Design tokens / Geist / accent theming** — P1-01 owns the token layer; assume it exists.

---

## Dependencies

- **P1-01** — Design-system foundation (tokens, Geist, density, accent CSS vars). Required for all
  colours, `surface-*`, `--accent`, mono font, and the `data-density` row heights.
- **P1-02** — App shell, navigation & global keyboard. Supplies `selectedTaskId`, the J/K/↑/↓/Space/
  Enter/D/P/T key dispatch, and the `openPeek`/`openDetail` handlers this view consumes.

---

## Testing

Unit (vitest):
- **CapacityGauge zones:** assert zone/colour selection at boundaries — `pct = 0.79` → green,
  `0.80` → amber, `1.00` → amber, `1.01` → red; over-100% renders the "Over target by …" hint with
  the correct `fmtHM` delta.
- **Timer formatting:** `fmtElapsed` formats `M:SS` under an hour and `H:MM:SS` over (e.g. 3661000ms
  → `1:01:01`, 65000ms → `1:05`). Use fake timers to assert the interval ticks once per second and is
  cleared on unmount / task change.
- **Optimistic commit:** mocking the mutation, committing a candidate immediately moves it into the
  committed cache snapshot and increments the committed total; a rejected mutation rolls the cache
  back to the prior snapshot.
- **Sort + section split:** committed sorts by `PRI_RANK` with `done` sinking to the bottom;
  candidates filter to `scheduled_for == null && status === 'todo'` and group by area in fixed order.
- **Hero invariant:** with zero in-progress → empty state; with one → that task; with two → highest
  priority only.

---

## Open Questions

- **Capacity target persistence (epic §11):** Phase 1 uses `localStorage('lifeos-target')`
  (client-only). Should this be promoted to a `GET/PUT /api/config` user-setting so the target
  survives across devices/clears? Default: client-only for now; revisit if multi-device. Resolve here.
- **Live-timer start instant:** the real `Task` has no `claimed_at` epoch (only `claimed_by` +
  `transitions[]`). Confirm the server exposes a reliable in-progress start timestamp (latest
  transition `to === 'in_progress'` `at`), or add one to `/api/today`'s task payload. If neither is
  available, the hero ships without the live timer (failure mode above).
