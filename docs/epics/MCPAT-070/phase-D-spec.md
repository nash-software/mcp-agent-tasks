# Spec: MCPAT-070 Phase D — Advisor chat + suggestions (L) ← largest

**Epic:** MCPAT-070 Life OS Phase 3 UI Reskin · **Branch:** `feat/MCPAT-070-p3d-advisor-chat`
**Pipeline:** `/run-pipeline docs/epics/MCPAT-070/phase-D-spec.md --phase D --auto`
**Depends on:** Phases A, B, C, E, F merged (shares `App.tsx` with A/B/C; shares `lib/api.ts` + `src/server-ui.ts` with E). Branch from fresh `origin/main` which contains all of them — your App.tsx + api.ts + server-ui.ts edits layer on top cleanly.
**Reference appendix:** `phase3-lifeos-picture.md` §D2/D3 + §buildSuggestions · prototype `design_handoff/reference/advisor.jsx` (chat + cards — the canonical contract) · `styles.css` (`.advisor-view`, `.adv-*`, `.id-chip`, `.sugg-*`, `.sev-badge`) · visual target `08-advisor.png` (canonical full Advisor view).
**Streaming backend reference impls:** Conductor `brain-router.ts` (handler skeleton), `scripts/launch-claude.cmd` (binary resolution), `pty-manager.ts:16-32,105-122` (Windows PATH/env hygiene). Project memory: `claude.exe` spawn on Windows, env-delete (never set undefined → EINVAL), Windows Job Objects.

## Scope boundary — ONLY these files

UI root is `src/ui/src/`; backend at repo `src/`. Touch **only**:
- `views/AdvisorView.tsx`
- `components/AdvisorChat.tsx` (new)
- `components/SuggestionCard.tsx` (new)
- `lib/advisor.ts` (new — `buildSuggestions`, `snapshotContext`, `localAdvice`, `renderWithChips`)
- `lib/api.ts` (chat client only — append; do not disturb E's notes client)
- `index.css` (append `.advisor-*`/`.sugg-*`/`.id-chip` selectors)
- `src/server-ui.ts` (add `POST /api/advisor/chat` — append; do not disturb E's notes routes)
- `src/lib/claude-stream.ts` (new helper)

## Shared contracts (authoritative)

- **Suggestion:** `{ rank:number; id:'s-crit'|'s-cap'|'s-block'|'s-root'|'s-auto'; severity:'critical'|'warning'|'info'; title:string; rationale:string; taskIds:string[]; actions:('commit'|'hermes'|'open')[]; basis:string }`. `SEV_LABEL = { critical:'Act now', warning:'Watch', info:'Consider' }`.
- **buildSuggestions:** 5 types, max 5, rank=insertion order. s-crit(critical task !in_progress)→commit/"priority + status"; s-cap(committed hrs vs target; over=warning/under=info)/"capacity model"; s-block(blocked task)→open/"status age"; s-root(shared root cause via note→task-ID refs `/\b[A-Z]{2,5}-\d+\b/g` over note bodies)→commit/"brain · patterns/dispatch.md"; s-auto(weekly tag, no agent_status)→hermes/"recurrence pattern".
- **id-chip regex** (client, rendered text): `/\b[A-Z]{2,5}-\d+\b/g` → clickable `.id-chip` → `navigateToTask(id)`.
- **Suggested prompts (4):** "What should I work on next?" · "What's blocking me?" · "Draft my standup" · "What can Hermes take off my plate?". Tool chips: @tasks · @notes · brain search · ACR.
- **Chat SSE wire contract** (`POST /api/advisor/chat`): request `{ messages:{role:'user'|'assistant',content:string}[], sessionId?:string }`. Response `Content-Type: text/event-stream`; frames `event: delta\ndata:{"text":"…"}`, `event: session\ndata:{"sessionId":"…"}` (once), `event: done\ndata:{}`, `event: error\ndata:{"message":"…"}`.

## AC (frontend)

- [ ] AdvisorView = `AdvisorChat` on top, `.sugg-section` (suggestion cards) below.
- [ ] `AdvisorChat`: header (wand avatar, "Advisor"/"Reasons over your tasks, notes & brain", context chips `Claude · live`/`Claude` per reachability, `brain CLI`, `N tasks`); thread with assistant/user bubbles + synthesised opening greeting naming top flag; suggested prompts (4, shown until first send); tool chips; auto-grow composer (Enter send, ⇧Enter newline, send disabled when empty/busy, foot hint reflects connection).
- [ ] Task IDs in any rendered message → clickable `.id-chip` → open task.
- [ ] `buildSuggestions(tasks, notes, target)` client-side per the table; max 5; rank=insertion order; `s-root` derives from note→task-ID references (not hardcoded IDs). Null-guard estimate_hours/tags/etc. — never throw on partial data; empty → "All clear" state.
- [ ] `SuggestionCard`: severity left-rail + `data-sev`, 2-digit rank, dismiss × (local), title, ≤72ch rationale, task-id chips, action buttons (`commit`→commit first task, `hermes`→sign off, `open`→detail), basis line. Section refresh clears dismissals + recomputes.
- [ ] Offline degradation: chat never errors/goes dead — falls back to `localAdvice(prompt, tasks, suggestions)` keyword reasoning when stream unavailable. Context chip shows `Claude` (not `· live`).

## AC (backend — `POST /api/advisor/chat`, streaming)

- [ ] SSE endpoint per the wire contract. Context (open tasks `id [pri/status/today] title`, notes, advisor flags) injected **server-side** from the store — client sends only chat messages.
- [ ] Spawns native `claude.exe` by full path (`<npmPrefix>/node_modules/@anthropic-ai/claude-code/bin/claude.exe`, fallback `%USERPROFILE%\.local\bin\claude.exe`), `shell:false`, args `-p --output-format stream-json --verbose --include-partial-messages [--resume <sessionId>] [--model]`; prompt via stdin.
- [ ] Env sanitized: **delete** `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_IS_HEADLESS`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `ELECTRON_RUN_AS_NODE` (delete — never set undefined; EINVAL on Windows).
- [ ] stdout NDJSON parsed line-by-line; `content_block_delta` text → SSE `delta` frames; final `result.session_id` → SSE `session` frame; client persists and returns as `sessionId` next turn.
- [ ] Lifecycle: one process per turn, `settled` guard, timeout → `child.kill()`, `child.on('error')`/ENOENT → SSE `error` frame then close; kill child on `req.on('close')` (no orphan claude processes — Windows zombie risk).
- [ ] Old `POST /api/advisor/query` may remain for back-compat but AdvisorView no longer depends on it for chat.

## Tests

- [ ] Unit: `lib/advisor.ts` `buildSuggestions` — each of 5 types triggers/severity/order; `renderWithChips` id parsing; `localAdvice` keyword branches.
- [ ] Backend: `POST /api/advisor/chat` SSE happy path (delta+session+done frames) and ENOENT/timeout error frame — follow existing `server-ui` test style.
- [ ] Run the FULL vitest suite before PR.

## Gate

- [ ] Root `npm run type-check` (`tsc -b`). No `any`; discriminated unions for severity; components <200 lines, functions <50; try/catch all async; logger not console.log in backend.
