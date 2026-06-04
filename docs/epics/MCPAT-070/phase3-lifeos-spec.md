# Spec: Life OS — Phase 3 UI Reskin (MCPAT-070)

**Type:** Feature (Epic — 6 phased work-streams) · **Size:** L · **Priority:** high
**Task:** MCPAT-070 · **Feeds:** `run-pipeline` via relay orchestrate
**Companion:** `scratchpads/phase3-lifeos-picture.md` (exhaustive delta map, prototype contracts, CSS selector list, resolved decisions). This spec is the authoritative work definition; the picture doc is the reference appendix.

## Description

The Life OS dashboard (`src/ui/src/`) shipped Phases 1–2. Phase 3 layers six UI changes from the design handoff (`C:\Users\micha\Downloads\Life OS (1)\design_handoff_life_os\`) onto it, to **match the prototype exactly** (screenshots `08-advisor.png`, `09-notes.png` are the canonical full-shell visual targets). Tokens, shell grid, and Phases 1–2 anti-patterns are unchanged. Several pieces are partially built and need adjustment, not greenfield work.

The single largest item is the **Advisor redesign** (flat recommendations list → chat panel + proactive suggestion cards) and its **streaming chat backend** over the `claude` CLI.

## Resolved Decisions

- **D1 (Completed):** Keep the existing `close_batch` sprint-grouping feature; only restyle rows to the prototype's done-row visuals (green check chip, strikethrough title, `done-when`). Do **not** drop batch grouping.
- **D2 (Advisor chat backend):** Build streaming `POST /api/advisor/chat` over the `claude` CLI in stream-json mode (honors the "CLI not SDK" rule). Replaces the one-shot `claude -p` buffered spawn. Full mechanism in picture doc §Decisions/D2.
- **D3 (Suggestions):** `buildSuggestions` runs **client-side** from TanStack Query data. `s-root` derives from note→task-ID references, not hardcoded demo IDs. Server `GET /api/advisor/suggestions` deferred (out of scope).
- **D4 (SortControl scope):** Builder resolves from code. Read `App.tsx` SortControl usage first: if `SortControl` is shared across other filterable views (Board/Artifacts/etc.), keep their existing sort keys intact and render the 4 Phase-3 keys (Priority/Area/Estimate/Project) **only on the Today toolbar** — do not change sorting on any other view. If Today-only, swap freely. No regression to non-Today views either way.
- **D5 (Note submit endpoint):** Capture Note-mode and Infer→note both submit to the **existing `POST /api/capture/note`** (already populates `fresh:true` + area inference). Phase E still adds `POST /api/notes` + `DELETE /api/notes/:id` for NotesView CRUD parity, but NotesView's "New note" affordance routes through `focusCapture('note')` → capture bar → `/api/capture/note`, so the create path is single and consistent.

## Domain Model / Contracts (the parts the UI depends on)

- **Capture mode:** `CaptureMode = 'infer' | 'task' | 'note'` (discriminated, no bare string). Persisted `localStorage('lifeos-capmode')`, default `'infer'`.
- **Sort key:** `SortKey = 'priority' | 'area' | 'estimate' | 'project'`. Persisted `localStorage('lifeos-sort')`, default `'priority'`. (Phase-3 sort keys **replace** the current Created/Updated/Scheduled/Title/Complexity options for the Today toolbar — see Out of Scope note.)
- **Suggestion:** `{ rank: number; id: 's-crit'|'s-cap'|'s-block'|'s-root'|'s-auto'; severity: 'critical'|'warning'|'info'; title: string; rationale: string; taskIds: string[]; actions: ('commit'|'hermes'|'open')[]; basis: string }`. `SEV_LABEL = { critical:'Act now', warning:'Watch', info:'Consider' }`.
- **Chat SSE wire contract** (`POST /api/advisor/chat`): request `{ messages: {role:'user'|'assistant', content:string}[], sessionId?: string }`. Response `Content-Type: text/event-stream`, frames: `event: delta\ndata: {"text":"…"}` (token deltas), `event: session\ndata: {"sessionId":"…"}` (once, to persist for `--resume`), `event: done\ndata: {}`, `event: error\ndata: {"message":"…"}`. Client applies id-chip regex `/\b[A-Z]{2,5}-\d+\b/g` to assembled text.
- **id-chip regex** (client, all surfaces): `/\b[A-Z]{2,5}-\d+\b/g` → clickable `.id-chip` → `navigateToTask(id)`.
- **Constants (verbatim):** `PRI_RANK={critical:0,high:1,medium:2,low:3}`, `AREA_ORDER={client:0,personal:1,internal:2,outsource:3}`. Infer route regex `/^(note|idea|remember|thought|todo think)[:\-]/i`; note strip regex `/^(note|idea|remember|thought)[:\-]\s*/i`.

---

## PHASES (pipeline work-streams)

Each phase is independently shippable, has its own branch `feat/MCPAT-070-p3<x>-<slug>`, and ends with `npm run type-check` (root `tsc -b`) + a visual check against the target screenshot. Phases A–C are low-risk and can run in parallel; D depends on nothing but is the largest; E/F are independent. **No cross-phase file collisions** except `App.tsx` and `index.css`/`tailwind` token file — see Concurrency.

### Phase A — Capture modes finish (S)
**Files:** `components/CaptureOverlay.tsx`, `hooks/useCaptureOverlay.ts`, `hooks/useGlobalKeyboard.ts`, `App.tsx`, `index.css`.
**AC:**
- [ ] Capture mode persists to `localStorage('lifeos-capmode')` (default `'infer'`); restored on load.
- [ ] `focusCapture(mode?: CaptureMode)` focuses the input AND switches mode when `mode` passed; no-arg focuses only. Wired to: Ctrl+Space (no arg), nav "New task" (`'task'`), Notes "New note" (`'note'`).
- [ ] Lead-glyph tint per mode via `.capture-input-wrap[data-mode]`: `task`→accent, `note`→amber, `infer`→muted.
- [ ] Submit routing/flash unchanged in behaviour: infer uses route regex (note vs task) + strips note token; flash text `Captured as task`/`Captured`/`Noted` with mode icon, ~700ms.
- [ ] Placeholders match prototype `PLACEHOLDER` map exactly per mode.

### Phase B — Sidebar regroup + footer (M)
**Files:** `components/Nav.tsx`, `lib/nav.ts`, `App.tsx`, `index.css`.
**AC:**
- [ ] Nav renders 3 labelled groups: **Workspace** [today, board, braindump, notes] · **Assistants** [advisor, agent] · **Library** [artifacts, roadmap, activity, completed]. Flat `NAV`/`NAV_BY_ID` stays the source of truth for shortcuts/counts; `NAV_GROUPS` drives render order/labels (keep in sync).
- [ ] Number shortcuts `1`–`9` map to indices 0–8, `0` maps to index 9 (Completed).
- [ ] Per-item count badges shown when defined (today, board, agent, artifacts, notes, completed, advisor=#client-suggestions); items without a count show their kbd hint.
- [ ] Footer (`.nav-foot`): New task primary button (`focusCapture('task')`), Search button (opens palette, `⌘K` right-aligned), density switch, ACR+Brain status dots with tooltips.
- [ ] Density switch labels Compact/Cozy/Spacious set `[data-density]` to `compact`/`balanced`/`airy`; add the `balanced` + `airy` density token values to CSS (currently only `compact`/`cozy`/`spacious` exist — `cozy`/`spacious` retired in favour of `balanced`/`airy`). Cozy (`balanced`) is default.
- [ ] Favourites group preserved, re-spaced per `.nav-pinned` styles.

### Phase C — Today filter+sort toolbar (M)
**Files:** `views/TodayView.tsx`, `components/FilterBar.tsx` (no behaviour change), `components/SortControl.tsx`, `lib/sort.ts`, `App.tsx`, `index.css`.
**AC:**
- [ ] `.today-toolbar` row wraps FilterBar (`flex:1`) + Sort control (pinned right). FilterBar loses its own bottom margin.
- [ ] SortMenu options exactly **Priority / Area / Estimate / Project**; persisted `localStorage('lifeos-sort')`; button reads `↕ Sort: <b>{label}</b> ⌄`; right-aligned popover, selected row accent check, closes on outside-click.
- [ ] **D4:** Before editing, read `App.tsx` SortControl usage. If `SortControl` is shared with other views, keep their keys and render the 4-key menu only on Today; if Today-only, swap freely. No sort-behaviour change on non-Today views.
- [ ] `taskCmp(sortBy)` implemented per contract: area uses `AREA_ORDER`, estimate descending, project A→Z prefix; **priority is always the tiebreaker**.
- [ ] Applied to committed list (with `done` sinking to bottom first) and within each candidate area-group; area-grouping of candidates is structural and preserved.
- [ ] Hero + capacity gauge are NOT sort/filter-scoped.

### Phase D — Advisor chat + suggestions (L)  ← largest
**Files:** `views/AdvisorView.tsx`, new `components/AdvisorChat.tsx`, `components/SuggestionCard.tsx`, `lib/advisor.ts` (buildSuggestions, snapshotContext, localAdvice, renderWithChips), `lib/api.ts` (chat client), `index.css`; backend `src/server-ui.ts` + a new `src/lib/claude-stream.ts` helper.
**AC (frontend):**
- [ ] AdvisorView = `AdvisorChat` on top, `.sugg-section` (suggestion cards) below.
- [ ] `AdvisorChat`: header (wand avatar, "Advisor"/"Reasons over your tasks, notes & brain", context chips `Claude · live`/`Claude` per reachability, `brain CLI`, `N tasks`); thread with assistant/user bubbles + synthesised opening greeting naming top flag; suggested prompts (4, shown until first send); tool chips (@tasks · @notes · brain search · ACR); auto-grow composer (Enter send, ⇧Enter newline, send disabled when empty/busy, foot hint reflects connection).
- [ ] Task IDs in any rendered message → clickable `.id-chip` (regex above) → open task.
- [ ] `buildSuggestions(tasks, notes, target)` client-side: 5 types (s-crit/s-cap/s-block/s-root/s-auto) per the trigger/severity/title/actions/basis table in picture doc §buildSuggestions; max 5; rank = insertion order; `s-root` derives shared root cause from note→task-ID references (not hardcoded IDs).
- [ ] `SuggestionCard`: severity left-rail + `data-sev`, 2-digit rank, dismiss × (local), title, ≤72ch rationale, task-id chips, action buttons (`commit`→commit first task, `hermes`→sign off, `open`→detail), basis line. Section refresh clears dismissals + recomputes.
- [ ] Offline degradation: chat never errors/goes dead — falls back to `localAdvice(prompt, tasks, suggestions)` keyword reasoning when stream unavailable.
**AC (backend — `POST /api/advisor/chat`, streaming):**
- [ ] SSE endpoint per the wire contract above. Context (open tasks `id [pri/status/today] title`, notes, advisor flags) injected **server-side** from the store — client sends only the chat messages, not the whole workload.
- [ ] Spawns native `claude.exe` by full path (`<npmPrefix>/.../claude-code/bin/claude.exe`, fallback `%USERPROFILE%\.local\bin\claude.exe`), `shell:false`, args `-p --output-format stream-json --verbose --include-partial-messages [--resume <sessionId>] [--model]`; prompt via stdin.
- [ ] Env sanitized: delete `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_IS_HEADLESS`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `ELECTRON_RUN_AS_NODE` (delete — never set undefined; EINVAL on Windows).
- [ ] stdout NDJSON parsed line-by-line; `content_block_delta` text → SSE `delta` frames; final `result.session_id` → SSE `session` frame; client persists and returns it as `sessionId` next turn (multi-turn continuity).
- [ ] Lifecycle: one process per turn, `settled` guard, timeout → `child.kill()`, `child.on('error')`/ENOENT → SSE `error` frame then close; kill child on `req.on('close')` (client disconnect).
- [ ] The old `POST /api/advisor/query` may remain for back-compat but AdvisorView no longer depends on it for chat.

### Phase E — Notes pinned-grid (M)
**Files:** `views/NotesView.tsx`, new `components/NoteCard.tsx`, `lib/api.ts`, `index.css`; backend `src/server-ui.ts` (`POST /api/notes`, `DELETE /api/notes/:id`).
**AC:**
- [ ] Head: h1 "Notes", sub `{shown.length} captured`, New note button (top-right) → `focusCapture('note')`.
- [ ] FilterBar present (same `matchFilter`). Pinned notes render first in a 2-col `.notes-grid`; if both pinned and rest exist, a `.notes-divider`; then rest in a 2-col grid.
- [ ] `NoteCard`: head (PrefixBadge project · area dot · ⭐ amber if pinned · `.note-at` timestamp), title (14/600), body (text-2), `.note-tags` (#tag chips).
- [ ] Empty state points at the capture-bar Note mode.
- [ ] Backend: `POST /api/notes {title, body?, project?, tags?}` (create, for CRUD parity), `DELETE /api/notes/:id`. `GET/PATCH /api/notes(/:id)` already exist.
- [ ] **D5:** Capture Note-mode + Infer→note submit to the **existing `POST /api/capture/note`** (keeps `fresh:true`/area inference). NotesView "New note" routes via `focusCapture('note')` → capture bar → `/api/capture/note` — single canonical create path. `POST /api/notes` is added but is not the capture path.

### Phase F — Completed restyle (S–M)
**Files:** `views/CompletedView.tsx`, `index.css`.
**AC:**
- [ ] Keep the existing `close_batch`/`closed_at` sprint-batch grouping and "Nh burned" headings (D1).
- [ ] Restyle each row to `.done-row`: `.done-check` green check chip, `.done-title` strikethrough (muted, ellipsis), area dot + project badge + `.done-when` timestamp. Click opens the task.
- [ ] Remains filter-aware via existing `useTasks()`.

---

## Technical Notes

- **Stack:** React 18 + TS strict, TanStack Query, Tailwind against existing tokens, Vite. No `any`; discriminated unions for mode/sort/severity. Components <200 lines, functions <50.
- **CSS:** port the Phase-3 selectors from `reference/styles.css` into the project's CSS (class list + properties enumerated in picture doc §CSS). Reuse existing tokens; add only `data-density` `balanced`/`airy` values.
- **Authoritative type-check:** root `npm run type-check` (`tsc -b`) — `tsc --noEmit` inside `src/ui` gives false greens (project refs). Gate every phase on `tsc -b`.
- **Icons:** `lucide-react` — Wand2, CheckCircle2, FileText, Send, Repeat, Beaker/FlaskConical, plus existing set.
- **Streaming backend reference impls:** Conductor `brain-router.ts` (handler skeleton: env clean, spawn shell:false, stdin prompt, settled guard, timeout, ENOENT graceful), `scripts/launch-claude.cmd` (binary resolution), `pty-manager.ts:16-32,105-122` (Windows registry-PATH + env-delete hygiene).
- **Optimistic mutations:** flip only client-known fields; let server-computed values come from the response (no placeholder flash) — per project memory.

## Failure Modes

- **claude.exe missing / spawn fails** → SSE `error` frame, chat falls back to `localAdvice`; context chip shows `Claude` (not `· live`). Never a dead panel.
- **Stream stalls / timeout** → kill child, emit `error`, preserve thread; user can resend.
- **Client disconnect mid-stream** → `req.on('close')` kills the child (no orphan claude processes — Windows zombie risk per platform notes).
- **`POST /api/notes` fails** → capture flash shows failure, input preserved; never lose typed text.
- **buildSuggestions on empty/partial data** → renders "All clear" empty state, never throws on missing fields (null-guard estimate_hours, tags, etc.).
- **localStorage unavailable/corrupt** → fall back to defaults (`infer`, `priority`), don't crash mount.

## Concurrency / Pipeline ordering

- Shared-file hazard: `App.tsx` (A, B, C, D wiring) and `index.css` (all phases add CSS). Sequence shared-file edits or use claims (`scratchpads/.agent-run/claims.lock`); prefer running A→B→C sequentially for App.tsx, with D/E/F's `App.tsx` touches merged last. New component/lib files have no collision.
- Recommended pipeline order: **A, B, C** (sequential, share App.tsx) → **E, F** (parallel, isolated) → **D** (largest, isolated frontend + backend; its App.tsx wiring merges last).

## Testing

- [ ] Unit: `lib/sort.ts` `taskCmp` for all 4 keys incl. tiebreak + estimate-desc + done-sink (per existing `sortTasks` test patterns).
- [ ] Unit: `lib/advisor.ts` `buildSuggestions` — each of 5 suggestion types triggers/severity/order; `renderWithChips` id parsing; `localAdvice` keyword branches.
- [ ] Unit: capture infer route + strip regex behaviour.
- [ ] Backend: `POST /api/advisor/chat` SSE happy path (delta+session+done frames) and ENOENT/timeout error frame; `POST/DELETE /api/notes` validation (per existing server-ui test style).
- [ ] Visual QA (Playwright MCP): Advisor view vs `08-advisor.png`; Notes vs `09-notes.png`; sidebar groups + footer; Today toolbar; Completed rows. Run the full vitest suite before any PR (source-inspection tests break on changed strings — per project memory).

## Out of Scope

- `GET /api/advisor/suggestions` server endpoint (D3 — client-side for now).
- Brain-derived `s-root` beyond note→task-ID reference detection (no new brain query).
- Removing/replacing the sprint `close_batch` feature (D1 — restyle only).
- Changing sort options on non-Today filterable views (the Created/Updated/Scheduled/Title/Complexity sorts elsewhere stay; only the Today toolbar uses the 4 Phase-3 keys — confirm during build whether SortControl is shared).
- New design tokens beyond the `balanced`/`airy` density values.
- Voice/mic capture changes, command-palette changes (unchanged from P1/P2).
- Mobile/tablet responsive rework beyond what existing breakpoints already provide.

## Dependencies

- `claude.exe` installed and authenticated (Claude Max) for Advisor streaming; otherwise local fallback.
- Existing endpoints `GET/PATCH /api/notes`, `GET /api/today`, `GET /api/tasks`, brain/ACR status — already shipped.

## Open Questions

_Both resolved with user (2026-06-04) — see Resolved Decisions D4/D5._
