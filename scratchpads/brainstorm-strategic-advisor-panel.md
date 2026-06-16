# Brief: Strategic Advisor Panel

## Problem

The current Advisor panel reasons at the task level — it tells you which task to start, whether you're over capacity, what's blocked. It doesn't know your goals, can't zoom out to the portfolio, has no memory between sessions, and won't help you think about why you're spending all your time building and none on getting clients. The conversations you currently have in random Claude tabs — about strategy, blockers, distribution, finances — are unlogged, unlinked to your work, and leave no trace. Every session starts cold.

## Chosen Approach

Transform the Advisor panel into a context-aware strategic advisor system with three distinct personas (PM, Chairman, Coach), each with its own system prompt, output style, and model tier. Goal context is layered — explicit goals from a Goals config, `#goals`-tagged notes, and inferred signals from tasks/brain — and loaded at session start. Conversations are persisted as structured sessions with a synthesised summary; a nightly reflection pass on session close promotes recurring insights into "memories" the advisor reads on every future session. The suggestion cards are upgraded with portfolio-level signals anchored to active goals. The advisor can nudge you to switch modes mid-session, and can propose draft tasks, notes, and milestones from the conversation that you approve with one click.

Build order: **1 → 2 → 3 → 4** (Personas → History → Strategic Intelligence → Conversational Actions). Each phase ships as independently useful.

## Scope Boundaries

**In scope:**

### Phase 1 — Personas & Modes
- 3 advisor personas: PM (Sonnet), Chairman (Opus), Coach (Sonnet/Opus)
- Persona doc per mode: `chairman.md`, `pm.md`, `coach.md` — system prompt + output style + suggested prompts + model
- Mode selector at top of Advisor panel, switchable mid-session
- Advisor nudge: AI emits structured `[switch:chairman]` signal; UI renders "Continue with Chairman" / "Ignore" button pair inline

### Phase 2 — Conversation History & Logging
- Session persistence: `advisor-sessions/` JSONL store — `{mode, date, goal_snapshot, summary, full_log}`
- Session end triggered by navigation away from Advisor panel (background POST, non-blocking) or explicit "End session" button
- Session history tab within Advisor panel — list of past sessions, "Show more" to expand, click for full log
- Nightly reflection (on session close): lightweight LLM pass → promotes 2-3 insights to "memories"
- Memories block: collapsible "what I know about you" section visible in the panel; user can manually pin memories

### Phase 3 — Strategic Intelligence
- Goals config: combined Goals + Milestones page, two sections; Goals UI borrows Milestones patterns, upgraded where freeform goals differ
- Goal context synthesis at session start: Goals config + `#goals`-tagged notes + inferred from tasks/milestones/brain
- `buildSuggestions` upgraded with: stalled project detection, goal-gap signal, distribution neglect signal (no marketing/sales/visibility tasks in 2+ weeks), brain-surface rationale
- Suggestions scored against active goals (a client-acquisition suggestion ranks higher when financial goal is pinned)

### Phase 4 — Conversational Actions
- Backend parses advisor response for action intent: `create_task`, `create_note`, `set_milestone`
- UI renders draft action cards inline below AI message: title + type + one-click "Approve" / "Edit" / "Dismiss"
- Approve fires existing MCP tools (`task_create`, `note_create`, etc.)
- No auto-creation ever — always draft-and-confirm

**Out of scope:**
- 4th advisor persona
- Voice input
- Email / calendar integration
- Sharing or exporting sessions
- Autonomous advisor actions without confirmation
- Mobile-specific UI (follows existing responsive patterns)

## Key Decisions Made

- **Persona = prompt doc + output style + model tier**, not separate infra. Adding a 4th persona later is just a new file.
- **Goal context is layered** (Goals config + `#goals` notes + inferred) — all three feed session start context.
- **Mode selector at top, switchable mid-session** — advisor can nudge but user decides.
- **Session close = navigation away** from Advisor panel; reflection POST is non-blocking (no UI wait).
- **Goals + Milestones combined page** — two sections, shared UI patterns where they fit.
- **Coach persona is both personal and professional** — blockers, distribution, mindset, life goals.
- **Session history is a tab within the Advisor panel** — "Show more" to expand older sessions.
- **Nudge renders as two buttons** — "Continue with Chairman" / "Ignore" — inline in chat.
- **Session store is JSONL** (`advisor-sessions/`) following the artifacts pattern — not auto-created notes.
- **`buildSuggestions` extended with rule-based signals**, not replaced with LLM calls — keeps cards fast.
- **Draft-and-confirm for all conversational actions** — never silent creation.

## Open Questions (for /spec to resolve)

1. **Memory decay model** — research best approach: `last_accessed` + `pin` flag with fade after N sessions unaccessed is the leading candidate. /spec should define: decay threshold (sessions or days?), whether fading is soft (hidden) or hard (deleted), and whether the user sees a "faded memories" archive.
2. **Goals config UI details** — what fields does a Goal have? (title, description, target date, metric?) How many can be active simultaneously?
3. **`[switch:X]` signal format** — structured JSON embedded in AI response vs plain-text pattern the UI regex-matches. Affects server-side parsing complexity.
4. **Reflection LLM cost** — on session close, how large is the context passed to claude for reflection? Cap strategy needed to avoid expensive calls on long sessions.
