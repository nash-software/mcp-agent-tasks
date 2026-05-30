# Life OS — Functional Audit & Bug Diagnosis

**Date:** 2026-05-30
**Trigger:** Post-Phase-3 review. User reports the dashboard "is lacking a lot of useable functionality alongside aesthetics."
**Method:** 4 parallel read-only investigators across (1) task lifecycle/editing, (2) board/roadmap/artifacts/capacity, (3) discrete UI bugs, (4) gating/favourites/infra. All findings carry `file:line` evidence.

---

## 0. Headline finding — the UI is a read-only shell

Phases 1–3 (P1-01…P3-01) delivered a faithful reskin + **display** layer. The **mutation/interaction** layer was never implemented. The client defines mutation functions that target HTTP routes absent from the server:

| Client call (`api.ts`) | Targets | Exists in `server-ui.ts`? |
|---|---|---|
| `updateTaskPriority()` | `PATCH /api/tasks/:id` | ❌ no PATCH handler at all |
| `transitionTask()` | `POST /api/tasks/:id/transition` | ❌ zero `/transition` routes |

The only task-mutation routes that exist: `POST /api/tasks` (create draft), `/schedule` (date only), `/signoff`, `/triage`, `/promote` (draft→todo only). Errors are swallowed by `if (res.ok)` guards, so the UI looks alive but changes nothing. This is the root cause of items 6, 8, and most of 12.

---

## A. Functional gaps (need building)

### A1. Cannot edit any task field — MISSING
- No `PATCH /api/tasks/:id`. `TaskPanel.tsx:170-323` renders title/why/priority/status/estimate/tags as **read-only text** — no inputs, no edit affordance. Only `updateTaskPriority` has a client fn, and it hits the dead PATCH route.
- **Fix:** add `PATCH /api/tasks/:id` bridging the `task_update` MCP logic; make `TaskPanel` fields editable (title, why, priority, project/area, estimate).

### A2. Cannot start / transition state — MISSING
- No `/transition` route. `useToday.ts:117,155,178` (`markDone`, reopen, `blockTask`) all hit it → 404 swallowed.
- **No `in_progress` affordance exists anywhere** — the UI never sends `'in_progress'`. `HeroTask.tsx:28` only *reads* an existing in_progress state.
- **J+Enter trace:** `useGlobalKeyboard.ts:80-97` — J moves selection, Enter opens the detail panel correctly. But the panel's only action ("Done", `TaskPanel.tsx:330`) calls `/promote` (draft-only) which 400s on a real task and is swallowed. Hence "J then Enter does nothing."
- **Fix:** add `POST /api/tasks/:id/transition` (bridge `task_transition`, with the state-machine guards); add a "Start"/in_progress control; re-point the panel's Done button onto the real transition.

### A3. "Done" lifecycle / archive — BROKEN + MISSING
- Panel "Done" is mis-wired to `/promote` (draft→todo), not a done-transition (`TaskPanel.tsx:101`).
- **No archive concept and no "Completed Work" view.** Done tasks just sort to the bottom of the committed list (`TodayView.tsx:42`). No view in `views/` for done/archive.
- **No idempotency guard** — nothing prevents clicking "Done" on an already-done item (masked today only because the route 404s).
- **Fix (needs product decision):** define where done work goes — archive (hide), a Completed view, or both. Add guards. See Decisions.

### A4. Board drag-and-drop — MISSING
- Zero DnD code anywhere (`onDrag|onDrop|draggable|dnd|DndContext|useSortable` → no matches). `BoardView.tsx:58-88` renders static columns; `BoardCard.tsx:42-44` cards only open a read-only detail panel. Done column has no action.
- **Fix:** add a DnD library (e.g. `@dnd-kit`), wire drop → `transition`. Decision needed (see below).

### A5. Roadmap / pipeline — PARTIAL (works more than it looks)
- Add-milestone **is** wired: form at `RoadmapView.tsx:100-105` → `POST /api/milestones` (`server-ui.ts:963-984`). Data via `GET /api/milestones` (flat-maps `milestoneRepo.listMilestones()` across projects).
- Looks "useless" because it's **empty** (no milestones created) and progress bars read 0/0 when no tasks link to a milestone. The "New Milestone" button is easy to miss and asks for a raw prefix string.
- **Fix:** better empty-state guidance + nicer add affordance + task→milestone linking UI. Mostly UX, not missing logic.

### A6. Artifacts — MISSING PRODUCER (empty list is technically correct)
- `GET /api/artifacts` reads `~/.mcp-tasks/artifacts.jsonl` (`server-ui.ts:174-178`); file **does not exist** → returns `[]`. 30-day TTL hides old records.
- Only writer is `hooks/passive-capture.js:209-229`, a **PostToolUse hook** that must be installed via `agent-tasks install-claude-hooks` and only fires on agent Write/Edit. Almost certainly never installed/firing.
- **Fix:** install/verify the passive-capture hook; add an empty-state explainer ("artifacts appear as agents write files").

### A7. Capacity gauge "0m / 6h" — WORKS (real math, null inputs)
- Real sum: `committedMinutes = Σ (estimate_hours ?? 0) × 60` (`server-ui.ts:1175-1177`); target 360min default. Shows 0m because the 3 committed tasks have **null `estimate_hours`**.
- **Fix:** allow editing estimate (A1) and/or prompt for an estimate when committing to Today. Decision: require estimate on commit?

---

## B. Discrete UI bugs (diagnosed — cheap fixes)

| # | Bug | Root cause | Fix point |
|---|-----|-----------|-----------|
| B1 | Mac ⌘K icon on Windows | Hardcoded `⌘` literal; no platform detection anywhere | `Nav.tsx:191`, `BrainDumpView.tsx:360,398` — add `MOD = isMac ? '⌘' : 'Ctrl'` helper |
| B2 | Today margins don't respond to density; focus mode doesn't fill | `'today'` not in `FULL_WIDTH_VIEWS` (only `'board'`), so `.main-inner` keeps `max-width:840px;margin:0 auto`. Density only controls `--page-pad`; focus mode only collapses side grid columns, not the width cap | `App.tsx:42`, `index.css:81-82,85` — drive `.main-inner` width from focus mode (`data-width="full"` when focusMode) |
| B3 | 3-dots menu renders behind content + no click-away | (a) menu is `absolute z-50` inside `.main` (`overflow-x:hidden`/`overflow-y:auto`) clipping ancestor + per-row stacking contexts; (b) `menuOpen` is toggle-only, no document click/Esc listener | `TaskCard.tsx:164` + `index.css:75-76`; `TaskCard.tsx:72-79,162` — portal the menu + add outside-click/Esc effect |
| B4 | Clicking committed item doesn't open peek | Row `onClick` wired to `onSelectTask` (selection only), not `onOpenDetail` (`setPanel`) | `TodayView.tsx:280` vs `App.tsx:495-496` — make click open peek |
| B5 | Rows merge / status history small | Committed list `<div className="group">` has no `space-y`/`divide` (candidate list uses `space-y-3`); status history `space-y-2`/`text-xs` | `TodayView.tsx:273`, `TaskPanel.tsx:298-300` — add row separation + bump font |

**Note on "clicking tickets shows no linked docs/git/internal tags":** the `TaskPanel` *does* render Why, linked docs, git branch/PR/commits, tags, status history (`TaskPanel.tsx:210-296`). The user never sees them because the panel **doesn't open on row-click** (B4) and/or the task has no git/spec data populated. Fixing B4 surfaces all of it.

---

## C. Enablement & infra

### C1. Hermes / ACR "Phase 2" stubs — dead placeholders, not a flag
- Hermes *view* is fully enabled (`nav.ts:17`, `App.tsx:27,503`). What's greyed is the **per-task "Sign off to Hermes" / "Dispatch to ACR" buttons** — hardcoded `disabled` stubs with empty handlers at `App.tsx:311-322`, `TaskCard.tsx:175-177`, `TaskPanel.tsx:342-354`.
- Backends exist (`POST /api/acr/dispatch`; HermesView already has a working gated sign-off button at `HermesView.tsx:531-532`).
- **Fix:** delete the four `disabled` stubs and wire onClick to existing endpoints.

### C2. Favourite a project + sidebar split — exists, missing only the "Workspace" label
- Project-level favouriting works: `favorites: string[]` of prefixes → `localStorage('lifeos-favs')` (`App.tsx:99-126`); star toggle `FilterBar.tsx:149-154`; **Favourites group** renders in sidebar `Nav.tsx:100-138` (only when non-empty).
- **Gap:** the 7 nav views (`Nav.tsx:79-98`) render in an *unlabelled* block — no "Workspace" header.
- **Fix:** wrap nav items in a labelled "Workspace" group; optionally show Favourites header with empty-state.

### C3. Brain shows offline — transport/health-probe issue
- URL is correct: `getBrainMcpUrl()` → `BRAIN_MCP_URL ?? https://nash-vps.tail5c5009.ts.net:8093` (`server-ui.ts:54`).
- **No health check.** "Offline" is inferred only when the `brain_search` probe (`POST {url}/mcp` JSON-RPC, `AbortSignal.timeout(8000)`) throws or returns non-2xx (`server-ui.ts:68-106`, `Nav.tsx:53-64`).
- **Most likely cause:** TLS (untrusted Tailscale cert on `:8093` throws in `fetch` → caught as offline) **or** endpoint shape mismatch (Brain not speaking plain `POST /mcp` JSON-RPC).
- **Fix:** add a dedicated `/api/brain/status` health probe (Brain `/health` or MCP `initialize`/`ping`); resolve TLS trust; stop overloading `brain_search` as the liveness signal.

### C4. Capture auto-routed to COND — LLM free-choice misfire, no context
- Quick capture does **not** use `project-router.js`. UI sends only `{ text }` (no CWD/hint) → server writes to **GEN**, then `spawnBackgroundRouting` (`server-ui.ts:527-579`) asks the `claude` CLI to pick a prefix from the full list with **no project context and no confidence threshold** (`:545-546`). Ambiguous text resolved to COND and silently rerouted (`:573-577`).
- Not CWD-based, not stale config, not a wrong default (default is GEN).
- **Fix:** pass the dashboard's own project as context/bias into routing; OR return confidence and leave uncertain captures in GEN / prompt the user. `#PREFIX` explicit override already works (`#MCPAT note…`).

---

## Product decisions required (cannot be inferred)

1. **Done lifecycle:** Archive (hide), a dedicated "Completed Work" view, or both?
2. **Estimates:** Require an estimate when committing to Today (fixes the 0m gauge), or keep optional + editable only?
3. **Board DnD:** Add a drag library (`@dnd-kit`) for drag-to-transition, or simpler per-card status buttons?

---

## Proposed sequencing

- **P4-01 — Core mutability (the unlock):** `PATCH /api/tasks/:id` + `POST /api/tasks/:id/transition` (bridge `task_update`/`task_transition` with state-machine guards) + editable `TaskPanel` + Start/in_progress control + fix Done button + idempotency guards. *Fixes 6, 8, most of 12.*
- **P4-02 — Lifecycle & board:** Completed/Archive view (per decision 1) + Board DnD (per decision 3) + Done-column actions + row-click opens peek everywhere.
- **P4-03 — UI bug batch:** B1–B5 (platform key, Today width/focus, menu portal+dismiss, peek-on-click, row spacing/fonts).
- **P4-04 — Plumbing:** estimate-on-commit (decision 2) + artifacts hook install + roadmap empty-state + capture context-routing + Brain health probe.
- **P4-05 — Enablement:** un-stub Hermes/ACR buttons + Workspace/Favourites sidebar labels.
