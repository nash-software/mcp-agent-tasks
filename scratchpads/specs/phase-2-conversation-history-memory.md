# Phase 2: Advisor Session History & Memory — Persistent Conversations with Synthesis

**Type**: Feature
**Epic**: Strategic Advisor Panel

## Description

Every advisor session currently starts cold — no memory of what was discussed, what was decided, or what the user is working toward. Phase 2 introduces session persistence: each conversation is saved as a structured JSONL record. On session close (navigation away from the Advisor panel), a lightweight LLM reflection pass extracts 2-3 key insights and promotes them to "memories" — short, durable facts the advisor reads at the start of every future session. A history tab in the Advisor panel shows past sessions with summaries; clicking in reveals the full log.

## Domain Model

- **AdvisorSession** — A single conversation with the advisor. Fields: `id` (uuid), `mode` (PersonaId), `started_at` (ISO), `ended_at` (ISO), `goal_snapshot` (serialised active goals at session start), `summary` (string, LLM-generated), `full_log` (message array), `insights_promoted` (string[]).
- **AdvisorMemory** — A durable extracted insight. Fields: `id` (uuid), `content` (string, ≤150 chars), `source_session_id`, `created_at`, `last_accessed_at`, `access_count`, `pinned` (bool), `faded` (bool). Stored separately from sessions.
- **Memory decay** — A memory becomes `faded=true` after `access_count` stays at 0 for N sessions (threshold to be determined at implementation — see Open Questions). Faded memories are excluded from the advisor context but retained in the store (soft delete). User can manually `pinned=true` to exempt a memory from decay.
- **Invariants**: A session record is immutable once `ended_at` is set. Memories are append-only (no edit, only pin/fade). `summary` is generated exactly once on session close; it is never regenerated.

## Acceptance Criteria

- [ ] On navigation away from the Advisor panel, a background POST to `/api/advisor/session/close` fires non-blocking; the UI does not wait for it before navigating
- [ ] Closed session is persisted to `advisor-sessions/sessions.jsonl` as a single JSON line: `{id, mode, started_at, ended_at, goal_snapshot, summary, full_log[]}`
- [ ] The reflection LLM call extracts 2-3 insights from the session (capped input: last 4000 tokens of the conversation to control cost); insights are appended to `advisor-sessions/memories.jsonl`
- [ ] A "History" tab is visible within the Advisor panel, showing sessions in reverse-chronological order with: date, mode badge, summary text, message count
- [ ] Clicking a session in the History tab expands an inline full log view; "Show more" loads older sessions (initial load: 10, show more: +10)
- [ ] At session start, the advisor's system prompt includes a "Memories" block: up to 5 non-faded memories retrieved by recency of `last_accessed_at`, each ≤150 chars, capped at ~550 tokens total
- [ ] A collapsible "What I know about you" section in the Advisor panel lists active memories; each has a pin/unpin toggle
- [ ] Pinning a memory sets `pinned=true`; pinned memories are never faded and always included in the context block (up to 3 pinned + 2 unpinned = 5 total)
- [ ] `access_count` increments each time a memory appears in a session's context block

### Testing
- [ ] Unit tests for session serialisation/deserialisation roundtrip (JSONL read/write)
- [ ] Unit tests for memory decay logic: `faded` flag set correctly after N zero-access sessions; pinned memories exempt
- [ ] Unit tests for memory context assembly: correct cap (5 memories, ≤550 tokens), recency ordering, pinned-first
- [ ] Integration test: session close → reflection call → memories written → next session reads them
- [ ] Visual QA: History tab (session list, expanded log), memories block (collapsed/expanded, pin toggle)

## Technical Notes

- Store location: `advisor-sessions/` at the project root (parallel to `agent-tasks/`). Two files: `sessions.jsonl` (append-only) and `memories.jsonl` (append-only; `faded`/`pinned` updated in-place via full rewrite on change — memories file stays small).
- New server routes needed: `POST /api/advisor/session/close`, `GET /api/advisor/sessions`, `GET /api/advisor/memories`, `PATCH /api/advisor/memories/:id` (pin/unpin).
- Reflection prompt: system = "You are extracting key insights from an advisor session. Return JSON: {insights: string[]}. Max 3. Each ≤150 chars. Focus on durable facts about the user's goals, blockers, and decisions — not task-specific details." User = last 4000 tokens of `full_log`.
- Memory context assembly runs in `src/server-ui.ts` at `/api/advisor/chat` before building the system prompt. Load memories, sort by `last_accessed_at` desc, take top 5 (pinned first), format as "Things I know about you: [memory1]. [memory2]..."
- The `AdvisorView.tsx` fires the close POST in a `useEffect` cleanup / `beforeunload` event handler, or on React Router navigation events.
- **Memory decay model** (open — see Open Questions): leading candidate is decay based on session count since last access. Implement as a check run at session close: for each memory where `access_count === 0` since last N sessions, set `faded=true`.

## Failure Modes

- **Reflection LLM call fails** (ENOENT, timeout, API error) → session is still persisted without a `summary` field (null); memories are not written for this session; no retry. Next session starts without new memories — acceptable degradation.
- **`sessions.jsonl` write fails** → log error, session is lost; UI shows no error (background operation). Non-critical.
- **Memories file corrupt or invalid JSON** → on load, filter out invalid lines and log; partial memories are better than a crash.
- **Close POST fires multiple times** (double navigation) → idempotent by `session_id`; second call is a no-op if `ended_at` already set.

## Out of Scope

- Searching session history (search across full logs)
- Exporting sessions
- Multi-device sync
- Session sharing
- Editing or deleting sessions or memories (read-only history, manual pin only)
- Automatic memory merging/deduplication (handled by the LLM's natural variation)
- Goal context loading (Phase 3)

## Dependencies

- Phase 1 (Personas & Modes) — session records include `mode` field; must be set.
- Existing `claude` CLI spawn path for the reflection call.

## Open Questions

- [ ] **Memory decay threshold** — how many sessions without access before `faded=true`? Research best approach: options are (a) fixed count (e.g. 10 sessions), (b) time-based (e.g. 30 days), (c) adaptive (based on total memory count). Recommend starting with fixed count = 10 and revisiting.
- [ ] **Reflection call timing** — on session close (synchronous risk if user immediately reopens panel) vs. deferred (next session open, if `summary` is null)? Lean toward deferred to avoid blocking the close event.

## Effort Estimate

**L** (3-5 days)

Rationale: New JSONL store, 4 new API routes, LLM reflection job, history tab UI with expand/collapse, memories block with pin toggle, decay logic. Moderate backend + moderate frontend, plus the reflection integration.
