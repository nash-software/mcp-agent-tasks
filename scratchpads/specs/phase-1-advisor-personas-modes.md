# Phase 1: Advisor Personas & Modes — PM, Chairman, Coach with Per-Mode System Prompts

**Type**: Feature
**Epic**: Strategic Advisor Panel

## Description

The Advisor panel currently uses a single generic system prompt and suggested questions. There is no way to talk to it as a strategic thinker vs. a tactical task manager. Phase 1 introduces three named personas — PM, Chairman, Coach — each with its own system prompt, output style, suggested prompts, and model tier. A mode selector at the top of the panel lets you choose before a session and switch mid-session. The advisor can nudge you to switch when your question is better suited to a different persona.

## Domain Model

- **Persona** — A named advisory mode. Fields: `id` (`pm` | `chairman` | `coach`), `label`, `model` (claude model id), `system_prompt`, `output_style`, `suggested_prompts[]`. Stored as a persona doc file (`src/advisor/personas/{id}.md` or JSON).
- **AdvisorMode** — The currently active persona for a session. Value object: `{personaId, switchedAt}`.
- **NudgeSignal** — A structured hint emitted in the AI response body when the advisor detects a mode mismatch. Format: `[switch:chairman]` token parsed by the backend/frontend.
- **Invariants**: A session always has exactly one active persona. Persona docs are read-only at runtime (no UI to edit them).

## Acceptance Criteria

- [ ] Mode selector renders at the top of the Advisor panel with three options: "PM", "Chairman", "Coach" — each with a short descriptor (e.g. "tasks & milestones", "strategy & goals", "blockers & growth")
- [ ] Selecting a mode loads the corresponding persona doc into the system prompt for the next message (current conversation thread is preserved, system prompt swaps)
- [ ] Active mode is visually indicated (highlighted/selected state) in the selector
- [ ] The `chairman.md` persona prompts Opus, reasons against active goals, uses 2-3 sentence strategic output style with opportunity-cost framing
- [ ] The `pm.md` persona prompts Sonnet, reasons across tasks/milestones/capacity, uses structured list output style
- [ ] The `coach.md` persona prompts Sonnet (or Opus for deep sessions), covers both professional blockers and personal growth, uses conversational empathetic output style
- [ ] When the AI response contains a `[switch:X]` token, the UI renders an inline nudge: "Continue with [X]" / "Ignore" button pair; clicking "Continue with [X]" switches the active mode
- [ ] Suggested prompts in the chat input area update to reflect the active persona's `suggested_prompts[]`
- [ ] Mode selection persists to `localStorage` so reopening the panel restores last-used mode

### Testing
- [ ] Unit tests for persona doc loading and system prompt assembly
- [ ] Unit tests for `[switch:X]` token detection and nudge rendering logic
- [ ] Visual QA: mode selector states (default, active, hover), nudge chip appearance

## Technical Notes

- Persona docs live in `src/ui/src/advisor/personas/` (or loaded via the server). Each is a structured JSON or markdown file — JSON is preferable for typed loading.
- `src/server-ui.ts` `/api/advisor/chat` handler accepts a `mode` field in the request body; the server selects the persona's system prompt and model accordingly.
- Output style hints (e.g. "respond in 2 sentences with: situation, recommendation, risk") are appended to the system prompt, not injected into the user message.
- `[switch:X]` token: server strips it from the streamed response before it reaches the UI; separately emits a `nudge` SSE event `{type:'nudge', targetMode:'chairman'}` that the frontend handles.
- Suggested prompts are per-persona; `SUGGESTED_PROMPTS` constant in `src/ui/src/lib/advisor.ts` becomes a `Record<PersonaId, string[]>`.
- `AdvisorChat.tsx` needs a `mode` prop and `onModeChange` callback; the mode selector is a new `ModeSelector.tsx` component.

## Failure Modes

- **Persona doc missing or malformed** → fall back to existing default system prompt; log warning; do not crash the session.
- **Model tier unavailable** (e.g. Opus rate-limited) → fall back to Sonnet; surface a non-blocking notice in the panel.
- **`[switch:X]` token in unexpected position** → nudge event is emitted but UI only renders it once per response (dedup by response id).

## Out of Scope

- 4th advisor persona
- User-editable persona prompts (read-only in Phase 1)
- Persistent mode per project/goal (just localStorage)
- Voice or keyboard shortcut to switch modes
- Conversation history (Phase 2)
- Goal context loading (Phase 3)

## Dependencies

- Existing SSE chat pipeline in `src/server-ui.ts` (`/api/advisor/chat`)
- Existing `AdvisorChat.tsx` and `AdvisorView.tsx`
- Claude CLI spawn path (already working via `src/lib/claude-spawn.ts` or equivalent)

## Open Questions

- [ ] Should the mode selector be a tab bar (compact) or a dropdown (space-efficient)? Decide at implementation based on the panel width budget.

## Effort Estimate

**M** (1-2 days)

Rationale: Mostly config + prompt engineering + UI selector component. No new storage, no new backend routes beyond extending the existing chat endpoint. The SSE pipeline is already built.
