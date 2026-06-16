# Epic: Strategic Advisor Panel — Context-Aware AI Counsel with Personas, Memory, and Goals

**Type**: Epic

## Description

The current Advisor panel reasons at the task level — capacity, blocked tasks, critical items. It has no memory between sessions, no understanding of your goals, and cannot zoom out to portfolio or strategic questions. High-value conversations (why am I not getting clients? where is my biggest leverage? what should I stop doing?) currently happen in random Claude tabs, unlogged and unlinked to your work. Every session starts cold.

This epic transforms the Advisor into a context-aware strategic counsel system: three distinct personas (PM, Chairman, Coach) backed by goal-anchored context, persistent session memory, portfolio-level signals, and the ability to propose actionable tasks and notes from the conversation.

## Phases

| Phase | Ticket | Size | Dependency |
|-------|--------|------|------------|
| 1 | Advisor Personas & Modes | M | None |
| 2 | Conversation History & Memory | L | Phase 1 |
| 3 | Strategic Intelligence Upgrade | M | Phase 1 |
| 4 | Conversational Action Cards | M | Phase 2 + 3 |

**Recommended build order**: 1 → 2 → 3 → 4. Each phase ships independently useful functionality.

## Scope Boundaries

**In scope:**
- 3 advisor personas: PM (Sonnet), Chairman (Opus), Coach (Sonnet/Opus)
- Goal context layer: Goals config + `#goals`-tagged notes + inferred from tasks/brain
- Session persistence: JSONL store with nightly reflection → long-term memories
- Session history tab within the Advisor panel
- Upgraded `buildSuggestions` with portfolio-level, goal-anchored signals
- Draft-and-confirm action cards for task/note/milestone creation from chat

**Out of scope (entire epic):**
- 4th advisor persona
- Voice input
- Email/calendar integration
- Sharing or exporting sessions
- Autonomous advisor actions without confirmation
- Mobile-specific UI

## Key Decisions

- Persona = prompt doc + output style + model tier. No separate infra per persona.
- Goal context is layered: explicit Goals config + `#goals` notes + inferred signals.
- Session close = navigation away from Advisor panel (background POST, non-blocking).
- Goals + Milestones combined on one settings page (two sections).
- Coach persona covers both personal and professional blockers.
- Draft-and-confirm for all conversational actions — never silent creation.

## Effort Estimate

**XL** (2-3 weeks total across 4 phases)

Rationale: 4 independent but sequenced phases. Phase 1 is M, Phase 2 is L, Phases 3 and 4 are M each. Total: ~8-10 days of implementation.
