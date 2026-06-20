# MCPAT-102: Fix Advisor Session Model and Add History Panel

**Type**: Feature

## Description

The Advisor chat currently rebuilds the entire conversation history on every request and
sends it back to the server as a `messages[]` array. This means the stdin prompt grows
O(n) with each turn, which causes `--output-format stream-json` to hang and time out on
Windows once the conversation gets beyond a few turns. The fallback response then echoes
the top suggestion verbatim regardless of what the user asked — which is why the same
IFS stall message kept repeating.

The fix is to use Claude's native session model: inject context once on the first turn,
then use `--resume <sessionId>` with only the new user message on every subsequent turn.
Claude owns the conversation history; we stop rebuilding it.

The second part of this ticket adds the advisor history panel: past conversations are
already persisted to `sessions.jsonl` via `AdvisorSession`, but the `session/close`
endpoint is never called from the client, and there is no UI to view past sessions.
When in Advisor view, the ambient right rail (currently `<LiveFeedSection>`) is replaced
with a session history list, and clicking any entry shows a read-only transcript.

## Domain Model

- **`AdvisorSession`** (`src/types/advisor.ts`): already defined — `id`, `mode`,
  `started_at`, `ended_at`, `goal_snapshot`, `summary | null`, `full_log[]`,
  `insights_promoted[]`. No schema changes needed.
- **Server-side session log map**: `Map<sessionId, Array<{role, content}>>` held in
  process memory (see Failure Modes). Not a new domain entity — ephemeral accumulator
  between chat requests and the `session/close` call.
- **Invariant**: a session is written to `sessions.jsonl` exactly once (idempotency
  guard already present in `session/close`). The in-memory log is cleared after the
  write to prevent double-append.

## Acceptance Criteria

### Part 1 — Architecture fix

- [ ] `/api/advisor/chat` accepts `{ message: string, sessionId?: string, mode: PersonaId }`
  (`PersonaId = 'pm' | 'chairman' | 'coach'`, canonical union from `src/types/advisor.ts`)
  — the `messages[]` array is removed from the request body entirely
- [ ] First call (no `sessionId`): server builds full context prompt (system prompt +
  tasks/notes context + first user message) and spawns `claude -p --output-format
  stream-json`; the `session` SSE frame carrying the new `sessionId` is emitted to the
  client within the first few delta frames
- [ ] Subsequent calls (has `sessionId`): server spawns `claude --resume <sessionId> -p
  "<sanitized user message only>"` — no context rebuild, no conversationTurns string;
  the prompt stays small and constant-sized regardless of conversation length
- [ ] Server maintains a `Map<sessionId, log[]>` in process memory; each request appends
  `{role:'user', content}` before streaming and `{role:'assistant', content}` after the
  stream completes (concatenated delta frames)
- [ ] The 12-message cap and 4000-char-per-message truncation introduced as a workaround
  are removed — they are no longer needed
- [ ] `localAdvice` fallback (offline path) no longer returns `suggestions[0]` for
  unknown queries; it returns a clear "Claude is not reachable" message (already in
  `src/ui/src/lib/advisor.ts` from the prior fix — keep it)
- [ ] `AdvisorChat.tsx`: `send()` sends `{ message: val.trim(), sessionId, mode }` only;
  the `apiMessages` construction (building the full history array) is removed; `msgs`
  state is kept for rendering only
- [ ] A conversation of 10+ turns does not cause a timeout or repeated fallback response

### Part 2 — Session close wiring

- [ ] `AdvisorView.tsx` tracks `sessionId`, `sessionStartedAt` (ISO string, set on first
  delta frame), and `goalSnapshot` (first active goal title, or empty string)
- [ ] On unmount (`useEffect` cleanup), if a `sessionId` exists, `POST
  /api/advisor/session/close` is called with `{ session_id, mode: PersonaId, started_at,
  goal_snapshot }` — no `messages[]` in the body (server reads from its in-memory log)
- [ ] `session/close` on the server: reads `sessionLogs.get(session_id)` for `full_log`;
  if the key is missing (e.g. server restarted), saves the session with `full_log: []`
  rather than rejecting; cleans up the map entry after saving
- [ ] Async reflection (existing `claude -p` call that extracts insights) still fires
  post-close when `full_log.length > 0`; skipped silently when log is empty

### Part 3 — History panel

- [ ] `GET /api/advisor/sessions/:id` endpoint returns the full `AdvisorSession` object
  including `full_log`; responds 404 with `{ error: 'NOT_FOUND' }` if the id is unknown
- [ ] `api.ts` exports: `fetchAdvisorSessions(limit?, offset?)` → `GET
  /api/advisor/sessions`, `fetchAdvisorSession(id)` → `GET /api/advisor/sessions/:id`,
  `closeAdvisorSession(sessionId, mode, startedAt, goalSnapshot?)` → `POST
  /api/advisor/session/close`
- [ ] In `App.tsx`, when `view === 'advisor'`, the `<aside className="ambient">` renders
  `<AdvisorHistory onSelectSession={...} />` instead of `<LiveFeedSection>`; all other
  views continue to show `<LiveFeedSection>` unchanged
- [ ] `AdvisorHistory` list view: each row shows (a) auto-title = `summary` if non-null,
  else first user message from `full_log` truncated to 60 chars, else "Conversation";
  (b) coloured persona chip matching existing `ModeSelector` colours (`PM` / `Chairman`
  / `Coach`); (c) relative date (`Today`, `Yesterday`, `N days ago`); rows are sorted
  newest-first
- [ ] Clicking a row fetches the full session and switches to detail view within the same
  aside panel (no page navigation)
- [ ] `AdvisorHistory` detail view: read-only chat bubbles using existing `.adv-msg
  .user` / `.adv-msg .assistant` CSS; header shows persona chip + formatted date; back
  button (`←`) returns to list view; no editing
- [ ] Detail view footer has two buttons: "Copy transcript" (formats `full_log` as
  `Role: content\n---\n` plaintext and writes to clipboard via `navigator.clipboard`)
  and "Copy path" (writes the absolute path to `sessions.jsonl` to clipboard)
- [ ] Empty state in list view: "No past conversations yet — start chatting with the
  Advisor." with no broken layout
- [ ] Sessions with `full_log: []` (server-restart edge case) show in the list with
  title "Conversation" and detail view shows "Transcript unavailable" instead of an
  empty bubble list

### Testing

- [ ] Unit tests for the updated `streamAdvisorChat` in `api.ts` (sends `message` not
  `messages[]`; correct body shape for first call vs. resume call)
- [ ] Unit test: `closeAdvisorSession` sends correct body shape (no `messages[]`)
- [ ] Unit test: `AdvisorHistory` list renders title/chip/date correctly for sessions
  with and without `summary`, and for the `full_log: []` edge case
- [ ] Visual QA: Advisor right rail (list view, detail view, empty state) across the
  three persona chip colours

## Technical Notes

- **Files changed**: `src/server-ui.ts` (chat endpoint, close endpoint, new sessions/:id
  endpoint), `src/ui/src/api.ts`, `src/ui/src/components/AdvisorChat.tsx`,
  `src/ui/src/views/AdvisorView.tsx`, `src/ui/src/App.tsx` (aside conditional),
  new `src/ui/src/components/AdvisorHistory.tsx`
- **Server-side log map**: declare at module scope alongside existing process-level state
  (e.g. near `projectIndexes`): `const advisorSessionLogs = new Map<string, Array<{role:
  'user'|'assistant'; content: string}>>()`. Cap entries at 200 turns (already the
  `full_log` cap in the close endpoint); discard oldest on overflow
- **`--resume` flag guard**: only pass `--resume <sessionId>` when `sessionId` is a
  non-empty string matching the existing `/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/` pattern
  (already validated on the client's session frame). Do NOT pass `--resume` on first call
- **Context prompt (first call only)**: the existing `contextStr` + `systemContent` +
  `persona.output_style` + `ACTION_EXTRACTION_INSTRUCTION` remain unchanged. On resume
  calls, the prompt is just `sanitizeForPrompt(message.slice(0, 4000))` with no system
  context wrapping — Claude already has it from the first turn
- **Aside conditional**: `App.tsx` line ~774. Pass `view` to the aside region:
  `{view === 'advisor' ? <AdvisorHistory /> : <LiveFeedSection onOpenPanel={setPanel} />}`
- **Relative date helper**: write a simple `fmtRelDate(iso: string): string` in
  `AdvisorHistory.tsx` — `Today` if same calendar day, `Yesterday`, `N days ago`
- **Persona chip colours**: reuse whatever CSS classes `ModeSelector` already applies for
  `pm` / `chairman` / `coach`
- **`sessions/:id` endpoint**: read all entries from `readSessionsJsonl()`, find by `id`,
  return full object. No secondary index needed at current scale

## Failure Modes

- **Server restart between chat turns**: `advisorSessionLogs` is cleared; subsequent
  `--resume <sessionId>` call still works (Claude's JSONL persists independently); the
  `session/close` call gets an empty log and saves with `full_log: []` rather than
  failing. Reflection is skipped. Known limitation, acceptable for a local server.
- **`--resume` with a stale/expired sessionId**: Claude starts a new conversation
  silently. The client still gets delta frames and a new `session` frame with a new
  sessionId. The advisor session in memory is now orphaned. Mitigation: client replaces
  its stored `sessionId` with whatever arrives in the `session` frame — this already
  happens because the client updates `sessionId` state on every `session` frame.
- **Close called with unknown sessionId** (server restart): `advisorSessionLogs.get(id)`
  returns `undefined`; server saves session with `full_log: []` and returns `{ ok: true
  }`. Not an error condition.
- **Clipboard API unavailable** (non-HTTPS or denied): "Copy transcript" / "Copy path"
  buttons catch the rejection and show a transient error label on the button ("Failed")
  for 2 seconds, then reset.
- **Reflection spawn fails (ENOENT / timeout)**: the session is already persisted to
  `sessions.jsonl` before reflection fires; a failed or timed-out `claude -p` spawn is
  caught and resolved silently (existing behaviour, `server-ui.ts:3338–3350`), no
  insights promoted, no impact on the close response.
- **`sessions.jsonl` grows large**: `readSessionsJsonl()` is called on every list and
  close request. At current scale (personal tool, dozens of sessions) this is fine.
  Flag for future indexing if it becomes a concern.

## Out of Scope

- Searching or filtering history by keyword or date range
- Deleting or archiving individual sessions from the UI
- Exporting sessions to a separate file (copy path is sufficient)
- Pagination UI in the history panel (offset/limit query params exist on the server but
  no pagination controls in the panel — load latest 20, that's enough for now)
- Persisting the server-side log to disk between restarts (the in-memory map is
  intentionally ephemeral; `sessions.jsonl` is the durable store)
- Cross-session memory management UI (that's `MemoriesSection`, already built)
- Changing the suggestions layout or moving suggestions elsewhere
- Mobile layout for the history panel

## Dependencies

- `src/types/advisor.ts` and `src/store/advisor-memory.ts` — already exist, no changes
- `sessions.jsonl` storage and `session/close` server logic — already exist; this ticket
  wires them up and fixes the close body shape
- Existing `.adv-msg` CSS classes in the advisor stylesheet — reused for read-only view

## Effort Estimate

**L** (3–5 days)

Rationale: Server refactor of the chat endpoint (~1 day), close endpoint body change and
log map (~0.5 day), new `sessions/:id` endpoint (~0.5 day), client API changes and
`AdvisorChat` refactor (~0.5 day), `AdvisorHistory` component + App.tsx wiring (~1.5
days), tests + QA (~0.5 day).
