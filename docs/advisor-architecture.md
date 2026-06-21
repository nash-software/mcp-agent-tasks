# Advisor Panel Architecture

## Overview

The Advisor is a multi-persona AI chat panel inside the Life OS dashboard. It reasons over the user's live tasks, notes, goals, and brain index. It streams responses from the Claude CLI, extracts structured actions (task/note creation), detects memory-worthy facts, and persists sessions with LLM-reflection post-close.

---

## Component Tree

```
AdvisorView (src/ui/src/views/AdvisorView.tsx)
├── ModeSelector           — persona tab bar (pm / chairman / coach)
├── AdvisorChat            — the live chat panel
│   ├── ChatHeader         — avatar, context chips (live, task count)
│   ├── thread div         — message list
│   │   ├── adv-msg user   — user bubble
│   │   └── adv-msg assistant
│   │       ├── adv-bubble    — renderWithChips() renders task ID links
│   │       ├── ActionCard[]  — max 3 per message (pending → editing → confirmed)
│   │       └── MemoryChip    — max 1 per message (save/dismiss)
│   ├── adv-suggested      — SUGGESTED_PROMPTS chips (shown only on first message)
│   ├── adv-nudge          — persona switch suggestion (fires from nudge SSE frame)
│   └── adv-composer       — textarea + send button
├── sugg-section           — proactive suggestions below chat
│   ├── project filter chips (if >1 project)
│   └── SuggestionCard[]   — up to 5, dismissable
└── MemoriesSection        — collapsible; pin/delete controls
```

**Right-rail integration:** `AdvisorHistory` (`src/ui/src/components/AdvisorHistory.tsx`) is mounted elsewhere in App as the right-rail when on the advisor view. It shows past sessions (list → detail drill-down, read-only transcript, copy-to-clipboard).

---

## Personas (`src/ui/src/advisor/personas/*.json`)

Three JSON files, each loaded into `PERSONAS` in `lib/advisor.ts`:

| ID | Label | Model | Character |
|---|---|---|---|
| `pm` | PM | `claude-sonnet-4-6` | Structured bullets, prioritisation-first, references task IDs |
| `chairman` | Chairman | `claude-opus-4-8` | Situation → recommendation → risk, opportunity-cost framing |
| `coach` | Coach | `claude-sonnet-4-6` | Conversational, empathetic, asks one clarifying question |

Each persona has: `system_prompt`, `output_style`, `suggested_prompts[]`, `model`.

Persona is stored in `localStorage` key `lifeos-advisor-mode` and defaults to `pm`.

---

## Data Flow: A Chat Turn

```
User types → send() in AdvisorChat
  │
  ├─ POST /api/advisor/chat { message, sessionId?, mode }
  │
  └─ server-ui.ts handles:
       1. Validate body (sessionId format guard against argument injection)
       2. Build context snapshot:
          - contextTasks: up to 16 open tasks across all projectIndexes
          - noteLines:    up to 5 recent notes (GEN index)
          - For chairman: activeGoals + goal-tagged notes + brain snippet + top tasks
       3. Load & inject memories:
          - selectMemoriesForContext(allMemories) → up to 5 non-faded memories
          - formatMemoryBlock() → appended to system prompt
          - Update access_count + last_accessed_at for selected memories
       4. Build prompt:
          - First turn:  systemContent + persona.output_style + context + "User: <msg>"
          - Resume turn: only sanitizedMessage (Claude has context from session history)
       5. Memory candidate detection (heuristic regex on message)
          → emit SSE: memory_candidate { id, text }
       6. spawnClaudeStream({ bin, prompt, sessionId, model })
          → AsyncGenerator<delta|session|done|error>
       7. Action block streaming:
          - Buffer text after ```actions marker
          - emitText() strips [switch:pm|chairman|coach] → emits nudge event
          - On done: parse JSON action block → emit action_draft SSE events (max 3)
       8. Session log accumulation (in-memory Map advisorSessionLogs):
          - Append user and assistant turns per sessionId (cap 200 entries)
  │
  SSE stream → streamAdvisorChat() generator in api.ts
    yields: delta | session | nudge | action_draft | memory_candidate | done | error
  │
  AdvisorChat.send() consumes frames:
    delta         → append to last assistant Msg
    session       → setSessionId + call onSessionStart(id, startedAt)
    nudge         → setNudge(targetMode) → show persona switch banner
    action_draft  → push to actionDraftMap[msgIdx] (max 3 per message)
    memory_candidate → push to memoryCandidateMap[msgIdx] (first only)
    done          → break
    error         → localAdvice() fallback (offline response from local data)
```

---

## Session Lifecycle

**Start:** First delta frame received → `session` frame returns `sessionId` from Claude CLI. `AdvisorView` stores this in `sessionIdRef` (a ref, not state, so cleanup closure always reads latest).

**Accumulation:** Each turn appends user + assistant to `advisorSessionLogs` Map (server-side, in-memory). Cap: 200 entries.

**Close:** `AdvisorView` `useEffect` cleanup fires on unmount (navigating away). Calls `closeAdvisorSession(id, mode, startedAt, goalSnapshot)` → `POST /api/advisor/session/close`.

Server-side close handler:
1. Reads `advisorSessionLogs.get(sessionId)`
2. Writes to `~/.mcp-tasks/advisor-sessions/sessions.jsonl` (one JSON per line)
3. Fires async reflection: spawns `claude -p <reflect_prompt>` → extracts 2-3 insight strings → writes each to `memories.jsonl` as `AdvisorMemory` with `source: 'reflection'`
4. Deletes session from in-memory log

**Persistence paths:**
- Sessions: `~/.mcp-tasks/advisor-sessions/sessions.jsonl`
- Memories: `~/.mcp-tasks/advisor-sessions/memories.jsonl`
- Goals: `~/.mcp-tasks/advisor-sessions/goals.json`

---

## Memory System (`src/store/advisor-memory.ts`)

### Types (`src/types/advisor.ts`)

```typescript
interface AdvisorMemory {
  id: string
  content: string           // ≤150 chars
  source: 'reflection' | 'user'
  source_session_id?: string
  created_at: string
  last_accessed_at: string
  access_count: number
  pinned: boolean
  faded: boolean
}

interface AdvisorSession {
  id: string
  mode: 'pm' | 'chairman' | 'coach'
  started_at: string
  ended_at: string
  goal_snapshot: string
  summary: string | null
  full_log: Array<{ role: 'user' | 'assistant'; content: string }>
  insights_promoted: string[]
}
```

### Selection algorithm (`selectMemoriesForContext`)
1. Filter out faded memories
2. Sort pinned by `last_accessed_at` desc → take up to `MEMORY_PINNED_MAX = 3`
3. Fill remaining slots from unpinned by `last_accessed_at` desc → up to total `MEMORY_CONTEXT_MAX = 5`

### Decay algorithm (`computeDecay`)
- Non-pinned memories with `access_count === 0` where sessions since creation ≥ `MEMORY_DECAY_SESSIONS (10)` → set `faded: true`
- Pinned memories are immune

### Injection
`formatMemoryBlock(selected)` → `"Things I know about you: [c1]. [c2]."` — hard-truncated at `MEMORY_BLOCK_MAX_CHARS = 550` — appended to system prompt on every chat turn.

### API endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/advisor/memories` | list all |
| POST | `/api/advisor/memories` | create user-saved memory |
| PATCH | `/api/advisor/memories/:id` | toggle pinned |
| DELETE | `/api/advisor/memories/:id` | delete |

UI flow: `MemoryChip` appears below an assistant message when `memory_candidate` SSE frame fires. User clicks "Save" → `createMemory(text, sessionId)` → POST memories. `MemoriesSection` renders collapsible list with pin/delete.

---

## Proactive Suggestions (`src/ui/src/lib/advisor.ts → buildSuggestions`)

Pure function — no side effects. Called on every render of `AdvisorView` with current tasks, notes, goals, optional brainSnippet.

**Nine suggestion slots (first-match-wins per slot, max 5 returned):**

| ID | Trigger |
|---|---|
| `s-crit` | Critical tasks not `in_progress` |
| `s-cap` | Today's scheduled tasks vs `target` (hours) |
| `s-block` | First blocked task |
| `s-root` | Task IDs appearing in 2+ notes |
| `s-auto` | Weekly-tagged task with no `agent_status` or `scheduled_for` |
| `s-goal-gap` | No open tasks with keyword match to any active goal |
| `s-stall` | Project with 3+ open tasks, nothing `in_progress` for 14+ days |
| `s-distribution` | No marketing/sales tasks active when a financial goal exists |
| `s-brain-surface` | Brain snippet for top active goal (passed in externally) |

Financial-goal scoring override: swaps `s-distribution` before `s-stall` when a revenue/client goal is active.

Returned as `Suggestion[]`: `{ rank, id, severity ('critical'|'warning'|'info'), title, rationale, taskIds[], actions[], basis }`.

---

## Action Cards (`src/ui/src/components/ActionCard.tsx`)

Rendered below assistant messages when `action_draft` SSE frames arrive (PM and Chairman personas only; Coach never emits actions).

**States:** `pending → editing → approved (confirmed)` or `dismissed`.

**Action types:** `create_task`, `create_note`, `set_milestone`.

**Approve flow:** calls `POST /api/advisor/actions/approve { type, title, project?, priority?, body? }`. Server creates the task/note/milestone and returns `{ success, created_id? }`. Double-click guarded: status transitions to `approved` before the API call.

---

## SSE Frame Types

```typescript
type AdvisorChatFrame =
    { type: 'delta'; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'nudge'; targetMode: string }
  | { type: 'action_draft'; id: string; draftType: string; title: string; project?: string; priority?: string; body?: string }
  | { type: 'memory_candidate'; id: string; text: string }
```

---

## Server-side API Surface (all in `src/server-ui.ts`)

| Method | Path | Description |
|---|---|---|
| POST | `/api/advisor/chat` | SSE stream (delta, session, nudge, action_draft, memory_candidate, done, error) |
| POST | `/api/advisor/query` | One-shot LLM recommendations (legacy, non-streaming) |
| POST | `/api/advisor/session/close` | Persist session + fire async memory reflection |
| GET | `/api/advisor/sessions` | List sessions (limit/offset) from sessions.jsonl |
| GET | `/api/advisor/sessions/:id` | Single session detail |
| GET | `/api/advisor/memories` | List all memories |
| POST | `/api/advisor/memories` | Create user memory |
| PATCH | `/api/advisor/memories/:id` | Toggle pinned |
| DELETE | `/api/advisor/memories/:id` | Delete memory |
| POST | `/api/advisor/actions/approve` | Execute an ActionDraft |

---

## Offline Fallback

When `streamAdvisorChat` throws (Claude offline / ENOENT), `AdvisorChat.send()` calls `localAdvice(text, tasks, suggestions)` — a pure keyword-dispatch function:
- `block|stuck|waiting` → lists blocked tasks
- `standup|update|summar|week|recap` → done/wip/next/watchout summary
- `automat|hermes|delegate|agent` → finds s-auto suggestion or generic hint
- default → top suggestion rationale or generic "start highest-priority" message

---

## Key Invariants / Gotchas

1. **Session resume vs first-turn prompt shape** — First turn sends full `systemContent + context + "User: <msg>"`. Resume turns send only `sanitizedMessage` (Claude session already has context). The `sessionId` guard controls this.
2. **`sessionId` format guard** — Must match `/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/` before being passed as `--resume` CLI arg to prevent argument confusion.
3. **`res.on('close')` not `req.on('close')`** — Request close fires when body finishes reading (right away), which would abort the generator. Guard on `!res.writableEnded` ensures only genuine client disconnects kill the stream.
4. **Action block buffering** — Text is held in `holdBuffer` while scanning for the ` ```actions ` marker so JSON is never sent as delta text to the client.
5. **`[switch:pm|chairman|coach]` nudge protocol** — Claude can embed this tag in its response to recommend a persona switch; `emitText()` strips it and emits a `nudge` SSE frame.
6. **Chairman-only goal context** — Brain search pre-fetch, goal notes, and inferred signals are injected only when `activeMode === 'chairman'`.
7. **Memory decay** — Only run at context-selection time; `computeDecay` is not automatically called on writes.
8. **`CLAUDE_CLI_DISABLED=1`** — Test environment guard. When set, `resolveClaudeBinary()` returns a nonexistent path so any LLM endpoint fails fast with ENOENT.

---

## Files Reference

| File | Purpose |
|---|---|
| `src/ui/src/views/AdvisorView.tsx` | Container: data fetching, session refs, suggestion engine, project filter |
| `src/ui/src/components/AdvisorChat.tsx` | Chat UI: thread state, SSE consumption, action/memory tracking |
| `src/ui/src/components/AdvisorHistory.tsx` | Right-rail: session list + transcript detail |
| `src/ui/src/components/ActionCard.tsx` | Draft card: approve/edit/dismiss, calls approve API |
| `src/ui/src/components/ModeSelector.tsx` | Persona tab bar |
| `src/ui/src/components/MemoriesSection.tsx` | Collapsible memory list with pin/delete |
| `src/ui/src/components/MemoryChip.tsx` | Inline save/dismiss widget below assistant messages |
| `src/ui/src/lib/advisor.ts` | Pure logic: buildSuggestions, renderWithChips, localAdvice, PERSONAS, SUGGESTED_PROMPTS |
| `src/ui/src/advisor/personas/pm.json` | PM persona definition |
| `src/ui/src/advisor/personas/chairman.json` | Chairman persona definition |
| `src/ui/src/advisor/personas/coach.json` | Coach persona definition |
| `src/ui/src/api.ts` (lines 301–492) | Client-side API: streamAdvisorChat generator, memory/session/action fetchers |
| `src/types/advisor.ts` | Domain types: AdvisorSession, AdvisorMemory, PersonaId |
| `src/store/advisor-memory.ts` | Pure memory logic: selectMemoriesForContext, computeDecay, formatMemoryBlock |
| `src/server-ui.ts` (lines 3155–3945+) | All advisor HTTP endpoints: chat, query, session/close, sessions, memories, actions/approve |
