# Phase 3: Strategic Intelligence Upgrade — Goal-Anchored Suggestions and Portfolio Signals

**Type**: Feature
**Epic**: Strategic Advisor Panel

## Description

The current `buildSuggestions` function produces 5 task-level signals: critical idle, capacity, blocked, shared root cause, and automation candidate. These are useful for daily operations but miss the strategic layer entirely — they cannot tell you that you have no tasks related to your financial goal, that you've spent 3 weeks building and zero minutes on distribution, or that a whole project has gone quiet. Phase 3 adds goal context (a combined Goals + Milestones page), extends `buildSuggestions` with 4 new portfolio-level signals anchored to active goals, and injects the goal context block into the Chairman persona's system prompt.

## Domain Model

- **Goal** — An active objective the user is working toward. Fields: `id` (uuid), `title` (string, ≤200 chars), `description` (string, optional), `metric` (string, e.g. "£5k MRR", optional), `target_date` (ISO date, optional), `status` (`active` | `achieved` | `paused`), `created_at`. Max 5 active goals simultaneously.
- **GoalContext** — The synthesised context block built at advisor session start. Combines: active Goals records + `#goals`-tagged notes (body, truncated to 200 chars each) + inferred signals (top 3 by priority from open tasks and milestones). Used as a preamble in the system prompt.
- **Invariants**: Goals are user-managed (no auto-creation). A goal can only be `achieved` by the user explicitly, not by the advisor. The Goals config page shows Goals and Milestones in two separate sections.

## Acceptance Criteria

- [ ] A combined Goals + Milestones settings page exists, accessible from the nav or Projects modal; it has two clearly labelled sections: "Goals" and "Milestones"
- [ ] Goals section supports create, edit, and achieve (soft-complete) for up to 5 active goals; each goal has: title (required), description (optional), metric (optional, e.g. "£5k MRR"), target date (optional)
- [ ] Goals UI borrows existing Milestones UI patterns (card layout, status badge, date display) where structurally similar; Goals are more freeform and do not require a linked project
- [ ] At advisor session start, `GoalContext` is assembled from: all `active` Goals + notes tagged `#goals` (up to 3, body truncated to 200 chars) + top 3 open tasks by priority (as inferred signals); assembled context is injected into the Chairman system prompt preamble
- [ ] `buildSuggestions` emits 4 new signal types (first-match wins per slot, appended after existing 5 signals, total cap remains 5):
  - `s-goal-gap`: no open tasks linked to any active goal (by keyword match between goal title and task title/tags) → severity: warning
  - `s-stall`: a project with 3+ open tasks has had no `in_progress` task in 14+ days → severity: warning
  - `s-distribution`: no tasks tagged `marketing`, `sales`, `distribution`, `clients`, `visibility` are `in_progress` or scheduled within 7 days → severity: info (only surfaces when a financial/client goal is active)
  - `s-brain-surface`: the brain search returns a relevant node for the top active goal → severity: info, rationale includes the brain excerpt
- [ ] New suggestion signals are scored against active goals: if the active goal mentions revenue or clients, `s-distribution` ranks above `s-stall`
- [ ] `#goals`-tagged notes are visible in the Notes view with no special treatment beyond the tag (no new UI needed)

### Testing
- [ ] Unit tests for Goals CRUD: create (validation: title required, max 5 active), achieve (status → achieved), list (active only vs. all)
- [ ] Unit tests for `GoalContext` assembly: correct ordering (Goals → notes → inferred), token cap behaviour, empty-goals fallback
- [ ] Unit tests for each new suggestion signal: `s-goal-gap` (no linked tasks), `s-stall` (14-day inactivity threshold), `s-distribution` (tag-based detection + goal-presence guard), `s-brain-surface` (brain unavailable → signal skipped)
- [ ] Unit tests for suggestion scoring: distribution ranks higher than stall when financial goal present
- [ ] Visual QA: Goals + Milestones combined page (both sections, create flow, achieve action)

## Technical Notes

- Goals config storage: `advisor-sessions/goals.json` (array of Goal records), read/written by new `GET /api/goals` and `POST /api/goals` (create) and `PATCH /api/goals/:id` (update/achieve) routes in `src/server-ui.ts`.
- `buildSuggestions` in `src/ui/src/lib/advisor.ts` gains a `goals: Goal[]` and `brainSnippet?: string` parameter. The server pre-fetches the brain snippet (via brain MCP search on the top goal title) before the SSE chat starts.
- `s-stall` detection: group tasks by project prefix, find projects where all tasks have `status !== 'in_progress'` and `last_activity` < 14 days ago. Requires `last_activity` field to be available in the task list response (already present in the task schema).
- `s-distribution` tag detection: check `tags` array of open tasks for any of `['marketing', 'sales', 'distribution', 'clients', 'visibility', 'outreach']`. Extend the list at implementation based on real task data.
- `s-brain-surface` uses the existing brain MCP endpoint (`GET /api/brain/search?q=...`) with the top active goal title as the query. If the brain is offline, skip the signal silently.
- Goals + Milestones page: the existing Milestones UI lives in `src/ui/src/views/` — reuse its card/form patterns. Goals cards are simpler (no project linkage required). Implement Goals section as a new component `GoalsList.tsx` alongside existing Milestones UI.

## Failure Modes

- **Brain search unavailable** → `s-brain-surface` signal is skipped; `GoalContext` brain section is omitted; advisor session proceeds without it.
- **Goals file missing or corrupt** → treat as empty goals list; log warning; do not crash session start.
- **`s-stall` detection with large task set** → cap stall check at 20 projects (most recent by `last_activity`); beyond that, skip rather than scan.
- **Goal context exceeds token budget** → truncate notes and inferred signals first; always include Goals records (they are short).

## Out of Scope

- AI-suggested goals (goals are user-defined only in Phase 3)
- Goal progress tracking / percentage completion
- Goal-to-task linking UI (linkage is inferred by keyword match, not explicit)
- Goal templates
- Financial modelling or projections
- Conversational action cards to create goals from chat (Phase 4)

## Dependencies

- Phase 1 (Personas & Modes) — `GoalContext` is injected into the Chairman system prompt; persona docs must exist.
- Existing brain search endpoint (`/api/brain/search`) — used by `s-brain-surface`.
- Existing Milestones UI — reused as pattern for Goals section.

## Open Questions

- [ ] **Keyword match for `s-goal-gap`** — simple substring match (goal title words ∩ task title/tags), or something more robust (fuzzy)? Start with simple; can upgrade later.
- [ ] **Goals page placement** — accessible from the main nav (new nav item) or from within the Projects/Settings modal (second section)? Lean toward Projects modal to avoid adding a nav item.

## Effort Estimate

**M** (1-2 days)

Rationale: 3 new API routes (Goals CRUD) + new Goals UI section (reusing Milestones patterns) + 4 new `buildSuggestions` signals + `GoalContext` assembly. No new infra; extends existing patterns throughout.
