# P1-05 — Right ambient panel (ACR / Knowledge / Activity)

**Type:** Feature
**Phase:** Phase 1 — Reskin
**Epic:** MCPAT-022 — Life OS UI Reskin + Agent Layer
**Size:** M

> Read `docs/life-os/specs/00-epic-overview.md` first — §3 (tokens), §4 (`AcrJob` / `BrainDoc` / `Activity` shapes), §5 (query keys, offline degradation), §6.4 (right ambient panel) are the contract. This spec does not repeat them.

---

## Description

The right rail is a quiet, **ambient** companion to the main work surface. It surfaces three live signals — what the agents (ACR) are doing, what the knowledge base knows, and what just changed in the task store — **without ever interrupting**. It is deliberately low visual weight: hairline-separated sections, muted text, status conveyed by colour-coded dots and chips rather than prose. The user glances at it; they do not work *in* it.

WHY ambient / non-interruptive:
- These are background signals, not the primary task. They must read as ~30–40% visual weight (epic anti-pattern: nav/peripheral at equal weight to content). No loud borders, no gradients, no shadows — elevation is a lighter surface only.
- It polls quietly and degrades silently. ACR and Brain are external, optional services that are frequently offline on a localhost dev box. An offline ambient panel must render a calm grey "offline" affordance — **never** an error toast, red banner, or empty crash. The main app is fully usable with both off.
- Today the equivalent component (`LiveFeedSection`) lives **inside** `TodayView`, so ACR/Knowledge vanish on every other tab and there is **no Recent-activity section at all**. This spec promotes it to a persistent right rail (the `ambient` grid area introduced in P1-02) visible across all views, and adds the missing activity feed.

This is a Phase-1 reskin task: it wires to **existing** endpoints (`GET /api/acr/status`, `GET /api/brain/search`, `GET /api/activity`) — no backend work.

---

## Acceptance Criteria

1. **Persistent rail, not tab-local.** `LiveFeedSection` renders in the App grid `ambient` slot (296px column, always visible at ≥1200px; collapses to the bottom drawer at 768–1199px per P1-02), **not** inside `TodayView`. It is visible on Today, Board, Roadmap, Activity, Brain Dump, and Artifacts. The old in-`TodayView` mount is removed.
2. **Three hairline-separated sections** in order — ACR, Knowledge, Recent activity — each with a `lucide-react` header icon (`Server`, `Brain`, `Activity`) and a `surface-3` 1px divider between them. No section uses a card border or shadow.
3. **ACR status dot logic** (single dot beside the "ACR · Agent Control Room" header): **green** if any job `status === 'running'`; else **red** if any job `status === 'failed'`; else **grey** when idle (no running, no failed) or offline. The `animate-pulse` ring appears only on running dots.
4. **ACR jobs render up to 5** from `GET /api/acr/status`: truncated title, elapsed seconds for running jobs, and a status chip — pending (grey) / running (blue + pulsing dot) / done (green) / failed (red). When `offline === true`, the section renders a grey `ACR offline ○` affordance and renders **no jobs and no error**.
5. **Knowledge search is 400ms-debounced.** Typing in the single search input debounces 400ms before issuing `GET /api/brain/search?q=` (query disabled while `q` is empty). Up to 5 results show title, a 2-line snippet, and a mono source label. When the response is unreachable/offline, the section renders `Brain unavailable` (grey) and **no error**.
6. **Recent activity** shows the last ~6 transitions from `GET /api/activity`: a status dot (coloured by `to_status`), the task title, a `→ done` / `→ in_progress` / … label, and a relative timestamp. Clicking an activity row **opens that task** — it sets the App `selectedTask` and surfaces the detail panel (the same wiring `BoardView` uses via `onTaskClick`).
7. **ACR refetch cadence is 5s while any job is running.** The `['acr','status']` query refetches every ~5s when at least one job is running (per epic §5), and backs off to the idle interval otherwise. Brain and activity keep their own keys (`['brain', q]`, `['activity']`).

---

## Technical Notes

**Real files**
- `src/ui/src/components/LiveFeedSection.tsx` — the rail component (rewrite). Today it owns ACR + `BrainSearch` and is mounted inside `TodayView`.
- `src/ui/src/components/BrainSearch.tsx` — the Knowledge section; already has correct 400ms debounce and offline handling (`Brain unavailable`). Reskin to tokens; keep the debounce/offline logic.
- `src/ui/src/App.tsx` — currently a vertical flex column mounting `LiveFeedSection` indirectly. Move `LiveFeedSection` into the P1-02 grid `ambient` area as a sibling of `<main>` / `TaskPanel`. Pass an `onOpenTask: (task: Task) => void` (or task-id resolver) prop down so the activity click can call `setSelectedTask(...)`.
- `src/ui/src/hooks/useAcrStatus.ts` — `['acr-status']` today with a flat 15s `refetchInterval`. Re-key to `['acr','status']` (epic §5) and make `refetchInterval` a function of the data: ~5000ms while any job `status === 'running'`, longer (e.g. 15000ms) otherwise. Keep `AcrStatusResponse { offline, jobs }`.
- `src/ui/src/hooks/useBrainSearch.ts` — `useBrainSearch(query)`, `enabled: q.length>0`. Re-key to `['brain', q]` to match epic §5 (currently `['brain-search', query]`).
- `src/ui/src/hooks/useActivity.ts` — `useActivity()` returns `{ activity: ActivityEntry[], isLoading, error }` on key `['activity']`. New consumer for the Recent-activity section; slice to ~6.
- `src/ui/src/types.ts` — `AcrJob`, `AcrStatusResponse`, `BrainResult`, `BrainSearchResponse`, `ActivityEntry` already defined. Add the optional `hermes?: boolean` flag to `AcrJob` (see Out of Scope) and extend `status` to the `'pending'|'running'|'done'|'failed'` union from epic §4 if not already narrowed.

**Three query hooks** drive the three sections: `useAcrStatus()` → ACR, `useBrainSearch(debouncedQuery)` → Knowledge, `useActivity()` → Recent activity. Each section reads its own hook independently so one offline service never blocks another.

**Moving into the grid.** P1-02 defines the App as a CSS grid with a named `ambient` track. This spec only requires `LiveFeedSection` to be mounted in that slot and removed from `TodayView`; the grid template / responsive drawer behaviour itself is owned by P1-02. The rail must not assume Today is the active view.

**ACR job-detail slide-in.** Clicking an ACR job opens a slide-in job-detail panel (transform-only spring-in per §3, never opacity-to-hidden) showing the job title, status, elapsed, and `error` if failed. Output streaming may be minimal (a static/placeholder stream area is acceptable here — see Out of Scope).

**Status conventions** (epic §3): running/in_progress → blue `#3B82F6`, done → green `#22C55E`, failed/blocked → red `#EF4444`, pending/idle → muted grey. Timestamps and elapsed use Geist Mono with tabular-nums. Map prototype `queued` → `todo` for any activity status dot.

---

## Failure Modes

- **ACR offline** (`/api/acr/status` returns `{ offline: true }` or the fetch fails): header dot is grey, body shows `ACR offline ○`, no jobs, no error surfaced. Polling continues quietly so the section recovers when ACR comes back.
- **Brain unreachable** (`/api/brain/search` fails or returns offline): Knowledge section shows `Brain unavailable` (grey), input stays usable, no error. The ACR and Activity sections are unaffected.
- **Empty activity** (`/api/activity` returns `[]`): Recent-activity section renders a calm empty hint (e.g. "No recent activity"), not a spinner or error. Loading state is a single muted line, not a blocking skeleton.
- **Partial outage:** any one of the three services being down must not blank or error the other two — sections fail independently.

---

## Out of Scope

- **Hermes H-tag / live dispatch (P2-06).** Do not render the "Hermes-dispatched" badge on ACR jobs. Only leave room for it: add the optional `AcrJob.hermes?: boolean` flag to the type so P2-06 can light it up without a schema change. No Hermes wiring here.
- **Deep ACR output streaming.** The job-detail slide-in may show a minimal/static output area; real-time log streaming, websocket attach, and scrollback are deferred.
- Grid template definition, responsive bottom-drawer mechanics, and `selectedTask` state ownership — those belong to P1-01 / P1-02 (this spec consumes them).
- Any new backend endpoint or change to `/api/acr/status`, `/api/brain/search`, `/api/activity`.

---

## Dependencies

- **P1-01** — design tokens (`surface-1/2/3`, status colours, Geist/Geist Mono, motion ease) must exist; the rail styles against them.
- **P1-02** — App shell grid must define the `ambient` slot and the 768–1199px bottom-drawer behaviour, and must own the `selectedTask` / detail-panel wiring this spec's activity click drives (`onOpenTask` → `setSelectedTask`).

---

## Testing

- **Offline-path rendering (primary):** with `/api/acr/status` returning `{ offline: true }`, assert the ACR header dot is grey, `ACR offline ○` renders, and no error/job rows appear. Repeat for Brain (`Brain unavailable`) and confirm no thrown error or error boundary trip.
- **ACR dot logic:** unit-test the dot resolver — running present → green; no running but failed present → red; neither → grey.
- **Debounce:** assert `GET /api/brain/search` is not called until 400ms after the last keystroke, and not at all while the input is empty.
- **Refetch cadence:** assert `useAcrStatus` uses a ~5s interval when a running job is present and a longer interval when idle.
- **Activity click:** clicking an activity row invokes the `onOpenTask` callback with the matching task and opens the detail panel.
- **Empty states:** activity `[]` and ACR `jobs: []` (online) render calm empty hints, not errors.
- **Persistence across views:** the rail stays mounted when switching tabs (it is not unmounted with `TodayView`).

---

## Open Questions

- **Activity → task resolution:** `/api/activity` returns `ActivityEntry { task_id, title, … }` but not a full `Task`. Should the click pass `task_id` and let the detail panel fetch the task (`['tasks']` cache lookup), or should the rail resolve to a `Task` object before calling `onOpenTask`? (Lean: pass `task_id`, resolve from the `useTasks()` cache like the rest of the app.)
- **ACR elapsed source:** display server-provided `elapsed_s` (epic §4 `AcrJob`) verbatim, or compute client-side from a `claimed_at`? Current `AcrJob` type lacks `elapsed_s` — confirm the live `/api/acr/status` payload before wiring the running timer.
- **Bottom-drawer (768–1199px) default state:** collapsed-by-default with a toggle, or always-expanded below the main content? Defer to P1-02's drawer decision.
