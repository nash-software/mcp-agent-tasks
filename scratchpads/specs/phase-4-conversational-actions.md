# Phase 4: Conversational Action Cards — Draft Task/Note/Milestone Creation from Chat

**Type**: Feature
**Epic**: Strategic Advisor Panel

## Description

When the advisor recommends something actionable — "you should write a cold email sequence for Made by Atlas", "block out time to talk to 3 potential clients this week", "capture this decision about your pricing model" — there is currently no way to act on it without leaving the panel and manually creating a task or note. Phase 4 parses advisor responses for action intent and surfaces inline draft cards: a structured proposal the user can approve (one click), edit, or dismiss. Approve fires the existing MCP tools (`task_create`, `note_create`, etc.). Nothing is ever auto-created.

## Domain Model

- **ActionDraft** — A proposed action extracted from an advisor response. Fields: `id` (uuid), `type` (`create_task` | `create_note` | `set_milestone`), `title` (string), `project` (string, optional — inferred from context), `priority` (Priority, optional), `body` (string, optional), `source_response_id` (string), `status` (`pending` | `approved` | `edited` | `dismissed`). Value object — not persisted unless approved.
- **ActionCard** — The UI component that renders an ActionDraft. Appears inline below the advisor message that generated it. Shows: type icon, draft title, [Approve] [Edit] [Dismiss] buttons.
- **Invariants**: A user can only approve, edit, or dismiss an ActionDraft — never have it acted on silently. Once dismissed, an ActionDraft cannot be re-surfaced in the same session. Approval fires exactly one MCP tool call; double-approval is prevented by setting `status: approved` before the async call.

## Acceptance Criteria

- [ ] The server parses each completed advisor response for action signals using a structured extraction step (a second lightweight LLM call or regex on a defined output format — see Technical Notes); detected actions are appended to the SSE stream as `action_draft` events
- [ ] Each `action_draft` SSE event carries an `ActionDraft` payload: `{id, type, title, project?, priority?, body?}`
- [ ] The UI renders an `ActionCard` component inline below the advisor message that generated it; the card shows: type badge (Task / Note / Milestone), proposed title, and three buttons: "Approve", "Edit", "Dismiss"
- [ ] Clicking "Approve" immediately fires the corresponding MCP tool (`task_create`, `note_create`/`POST /api/notes`, or `PATCH /api/tasks/:id/milestone`) with the draft fields; on success the card collapses to a confirmation chip ("Task created: MCPAT-NNN")
- [ ] Clicking "Edit" opens an inline edit form within the card (title, project selector, priority selector for tasks); "Save & Create" fires the MCP tool with the edited fields
- [ ] Clicking "Dismiss" collapses the card immediately; dismissed cards do not reappear in the same session
- [ ] A maximum of 3 action cards are shown per advisor response (if the response generates more, the extras are silently dropped)
- [ ] Action cards persist visually within the session (scrolling back shows them) but are not persisted across sessions
- [ ] If the MCP tool call fails (network, validation), the card shows an inline error with a "Retry" button; the `status` resets to `pending`

### Testing
- [ ] Unit tests for action extraction: known response patterns → correct `ActionDraft` payload (type, title, project inferred)
- [ ] Unit tests for `ActionCard` component: approve → fires correct MCP call, dismiss → collapses, edit → save updates payload before call
- [ ] Unit tests for double-approval guard: second click on "Approve" is a no-op
- [ ] Unit tests for max-3 cap: 4 detected actions → only 3 cards rendered
- [ ] Integration test: full flow — advisor response with action intent → SSE event → card render → approve → task created → confirmation chip
- [ ] Visual QA: ActionCard in pending, confirmed, error, and dismissed states

## Technical Notes

- **Extraction approach**: Structured output — append to the advisor system prompt: "At the end of your response, if you are recommending a concrete action, output a JSON block: ```actions [{type, title, project?, priority?, body?}]```. Max 3 actions. Omit if no concrete action." The server strips the JSON block from the streamed response (so the user never sees raw JSON), parses it, and emits one `action_draft` SSE event per action.
- This avoids a second LLM call. The system prompt instruction is appended only for Chairman and PM personas (Coach responses are more reflective and less task-generating).
- New SSE event types in `src/server-ui.ts`: `action_draft` `{id, type, title, project?, priority?, body?}` and `action_confirmed` `{id, created_id}`.
- `ActionCard.tsx` is a new component in `src/ui/src/components/`; `AdvisorChat.tsx` maps `action_draft` events to `ActionCard` renders below the corresponding message.
- Approve path for `create_task`: calls `POST /api/tasks` (the existing task create endpoint) or the `mcp__mcp-agent-tasks__task_create` tool if accessible from the browser context. More likely: a new thin endpoint `POST /api/advisor/actions/approve` that delegates to the appropriate store method server-side.
- Project inference for `create_task`: if the conversation mentions a project prefix or project name, extract it. If ambiguous, leave `project` blank and show the project selector in the Edit flow.
- `set_milestone` action: maps to `PATCH /api/tasks/:id/milestone` (Phase 4-07, already implemented). Requires a task ID — only suggest this action when a specific task ID was mentioned in the conversation.

## Failure Modes

- **Action JSON block malformed** (model output doesn't parse) → emit no `action_draft` events; the response text is still shown normally. Log parse error. Do not surface an error to the user.
- **Approve MCP call fails** (validation error, network) → card shows inline error "Couldn't create — [reason]" with Retry; `status` resets to `pending`.
- **Double-approve race** (user clicks Approve twice quickly) → client sets `status: 'approved'` synchronously on first click; second click is disabled by `status !== 'pending'` guard.
- **Parsing produces >3 actions** → silently truncate to first 3; no user-visible effect.

## Out of Scope

- Creating goals from the chat (Goals are user-managed; auto-suggestion deferred)
- Bulk approval (approve all cards at once)
- Editing notes in the action card (note creation is title-only; full editing happens in the Notes view)
- Persisting dismissed/approved cards across sessions
- Action suggestions from the Coach persona (intentionally excluded — Coach is reflective, not task-generating)

## Dependencies

- Phase 1 (Personas & Modes) — system prompt injection of action extraction instruction is persona-specific.
- Phase 2 (Conversation History) — approved actions are included in `full_log` as assistant messages; no additional work needed.
- Existing `POST /api/notes` and `POST /api/tasks` endpoints (or their store equivalents).
- Existing `PATCH /api/tasks/:id` milestone endpoint.

## Open Questions

- [ ] **Server-side vs client-side approval** — should the "Approve" button call the MCP tool directly from the browser, or POST to a new `/api/advisor/actions/approve` endpoint that delegates? Lean toward server-side to keep MCP calls in one place and avoid CORS/auth complexity.

## Effort Estimate

**M** (1-2 days)

Rationale: System prompt addition (small) + SSE event parsing and stripping (moderate) + `ActionCard.tsx` component with 3 states (moderate) + approval endpoint (small). No new store or schema changes.
