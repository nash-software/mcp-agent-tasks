# Life OS — Phase 3 UI Reskin: The Picture

> Source handoff: `C:\Users\micha\Downloads\Life OS (1)\design_handoff_life_os\`
> Target: `C:\code\mcp-agent-tasks\src\ui\src\` + backend `src/server-ui.ts`
> Visual targets: screenshots `08-advisor.png` (full Phase-3 shell + Advisor), `09-notes.png` (Notes). Screenshots 01–07 show the *pre-Phase-3* state.

## What Phase 3 is

Phase 1 (reskin) and Phase 2 (filters/favourites/Hermes) already shipped. Phase 3 layers six changes on top:
1. Capture bar gets an **Infer | Task | Note** segmented control.
2. Sidebar regroups into **Workspace / Assistants / Library** + count badges + density footer.
3. Today gets a **filter+sort toolbar** (`.today-toolbar`) with a new Sort menu.
4. **Advisor** becomes a chat panel + proactive suggestion cards (currently a flat recommendations list).
5. **Notes** becomes a pinned-grid layout (currently a list + side panel).
6. **Completed** restyled to a done-list with check chips (currently a sprint batch-closure view).

Fidelity is "high" — match the prototype's tokens/CSS exactly. Tokens & shell grid are unchanged from Phase 1/2.

## Current state vs target (the delta)

| # | Area | Current | Target | Effort |
|---|------|---------|--------|--------|
| 1 | Capture modes | `CaptureOverlay.tsx` already has Infer/Task/Note pills, per-mode placeholders, mode-routed submit | Add `lifeos-capmode` persistence; `focusCapture(mode)` (switch+focus); lead-glyph tint via `[data-mode]` | **S** — mostly there |
| 2 | Sidebar | `Nav.tsx`/`lib/nav.ts`: flat 10-item list under one "Workspace" header + dynamic Favourites; footer mostly present | 3 groups (Workspace/Assistants/Library); per-item count badges; density labels→`compact`/`balanced`/`airy` (currently `cozy`/`spacious`) | **M** |
| 3 | Today sort | `SortControl.tsx`+`lib/sort.ts` exist; row is `.filter-bar-row` in `App.tsx`; sort keys = Priority/Created/Updated/Scheduled/Title/Complexity/Estimate | `.today-toolbar` wrapper; sort keys = **Priority/Area/Estimate/Project**; `taskCmp` semantics w/ priority tiebreaker, done-sink, descending estimate | **M** |
| 4 | Advisor | `AdvisorView.tsx` (166L): `useQuery(['advisor'])`→`POST /api/advisor/query`, renders ranked recommendation cards w/ citation chips | `AdvisorChat` (chat thread, context chips, suggested prompts, tool chips, composer, id-chip parsing, localAdvice fallback) + `SuggestionCard`/`buildSuggestions` (s-crit/s-cap/s-block/s-root/s-auto) | **L** — biggest gap |
| 5 | Notes | `NotesView.tsx` (244L): flat list + editable `NotePanel` (autosave) | Pinned 2-col grid → divider → rest grid; `NoteCard` (badge/area dot/star/timestamp/title/body/tags); New note → `focusCapture('note')` | **M** |
| 6 | Completed | `CompletedView.tsx` (190L): groups `status==='closed'` by `close_batch`, "Nh burned" headings | `done`-status rows, newest by `done_at`, green check chip, strikethrough title, filter-aware | **M** — see decision below |

## Backend (`src/server-ui.ts`, raw Node http, ~3161L)

- `POST /api/capture/quick` — does **not** accept `{mode}`; client routes mode-side to `/api/capture/infer`, `/api/capture/note`, or quick. Works today.
- `GET /api/notes` ✅ · `GET /api/notes/:id` ✅ · `PATCH /api/notes/:id` ✅ · `POST /api/notes` ❌ (creation is `POST /api/capture/note`) · `DELETE /api/notes/:id` ❌
- `POST /api/advisor/query` ✅ (non-streaming; spawns `claude -p`, 60s timeout, returns `{recommendations[]}`). `POST /api/advisor/chat` ❌ · `GET /api/advisor/suggestions` ❌

## Exact contracts to preserve (from prototype)

- **Infer route regex:** `/^(note|idea|remember|thought|todo think)[:\-]/i` → note else task. **Strip regex** (narrower): `/^(note|idea|remember|thought)[:\-]\s*/i`. Flash 700ms; "Captured as task"/"Captured"/"Noted".
- **NAV order/kbd:** Today1 Board2 Braindump3 Notes4 Advisor5 Hermes6 Artifacts7 Roadmap8 Activity9 Completed0 (`0`→idx9). Count keys: today/board/agent/artifacts/notes/completed/advisor(=#suggestions); others show kbd.
- **NAV_GROUPS:** Workspace[today,board,braindump,notes] · Assistants[advisor,agent] · Library[artifacts,roadmap,activity,completed].
- **Sort:** `AREA_ORDER={client:0,personal:1,internal:2,outsource:3}`, `PRI_RANK={critical:0,high:1,medium:2,low:3}`. area/estimate/project all tiebreak on priority; estimate descending; committed list sinks `done` first then `taskCmp`; candidates grouped by area then `taskCmp` within group.
- **id-chip regex:** `/\b[A-Z]{2,5}-\d+\b/g` (client-side on rendered text, keep regardless of backend).
- **buildSuggestions:** 5 types, max 5, rank=insertion order. s-crit(critical task !in_progress)→commit/"priority + status"; s-cap(committed hrs vs target, over=warning/under=info)/"capacity model"; s-block(blocked task)→open/"status age"; s-root(shared root cause)→commit/"brain · patterns/dispatch.md"; s-auto(weekly tag, no agent_status)→hermes/"recurrence pattern". SEV_LABEL: critical="Act now", warning="Watch", info="Consider".
- **Suggested prompts:** "What should I work on next?" · "What's blocking me?" · "Draft my standup" · "What can Hermes take off my plate?". Tool chips: @tasks · @notes · brain search · ACR.
- **localStorage keys:** `lifeos-capmode`(infer) · `lifeos-sort`(priority) — alongside existing lifeos-view/filter/favs/target/budget.
- **CSS classes** (port from `reference/styles.css`): `.capture-mode/.cm-btn/.cm-ico`, `.nav-group*/.nav-foot*/.nav-density/.nd-btn/.nav-status/.ns-item`, `.today-toolbar/.sort-*`, `.advisor-view/.adv-*/.id-chip/.sugg-*/.sev-badge`, `.notes-grid/.notes-divider/.note-*`, `.done-*`.

## Decisions (resolved with user)

- **D1 — CompletedView → Keep batch feature, restyle.** Keep grouping by `close_batch`/`closed_at` but apply the prototype's done-row visuals (green check chip `.done-check`, strikethrough `.done-title`, `.done-when`). Do NOT drop sprint-batch grouping.
- **D2 — Advisor chat → build streaming `POST /api/advisor/chat`, NOT `claude -p` one-shot.** Use the `claude` CLI in streaming mode (honors "CLI not SDK" rule). Mechanism (from Conductor investigation):
  - Spawn **native `claude.exe` by full path** (`<npmPrefix>/node_modules/@anthropic-ai/claude-code/bin/claude.exe`, fallback `%USERPROFILE%\.local\bin\claude.exe`), `shell:false`. NOT `.cmd` (EINVAL), NOT bare `spawn('claude')` (Job-Objects ENOENT).
  - Args: `-p --output-format stream-json --verbose --include-partial-messages [--resume <sessionId>] [--model <id>]`. Prompt (system brief + snapshotContext + history) via **stdin**, not argv.
  - Sanitize env: `delete env['CLAUDECODE'|'CLAUDE_CODE_ENTRYPOINT'|'CLAUDE_CODE_IS_HEADLESS'|'CLAUDE_CODE_USE_BEDROCK'|'CLAUDE_CODE_USE_VERTEX'|'ELECTRON_RUN_AS_NODE']` (delete, never set undefined).
  - Parse stdout NDJSON: emit SSE `data:` frames for `content_block_delta` text deltas; capture `session_id` from final `result` event → persist per conversation → pass `--resume` next turn.
  - Browser consumes via `EventSource`; client-side id-chip regex applied to streamed text.
  - Lifecycle: one process per turn, `settled` guard, timeout→`child.kill()`, `child.on('error')`/ENOENT → graceful SSE error event then close, kill on `req.on('close')`.
  - Offline → never error/dead; degrade to `localAdvice` keyword fallback.
  - Reference files: Conductor `brain-router.ts` (handler skeleton), `scripts/launch-claude.cmd` (binary resolution), `pty-manager.ts:16-32,105-122` (Windows PATH/env hygiene).
- **D3 — Suggestions → client-side `buildSuggestions`** (my recommendation, accepted as "what's most beneficial"). Compute from loaded TanStack Query tasks/notes; instant + auto-refresh; no new endpoint. `s-root` derives from note→task-ID references (`/\b[A-Z]{2,5}-\d+\b/g` over note bodies) rather than hardcoded demo IDs; server `GET /api/advisor/suggestions` deferred.
