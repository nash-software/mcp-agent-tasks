# Rubric: MCPAT-102 — Advisor session model fix + history panel

**Goal:** Fix the Advisor chat to use Claude's native session model (`--resume` instead of
rebuilding the `messages[]` history every turn), and add the advisor session history panel
that replaces the ambient right rail when in Advisor view.

**Source of truth:** `tasks/mcpat-102-advisor-session-model-and-history-panel.md`

**Out of scope:** searching/filtering history, deleting sessions from the UI, exporting to a
separate file, pagination UI controls, persisting the server log map to disk, cross-session
memory management UI, mobile layout for the history panel, changing the suggestions layout.

## Must Pass — Blocking

- [ ] **Type-check clean** — verify: `npm run type-check` exits 0
- [ ] **messages[] history rebuild removed from chat endpoint** — the per-turn
  conversation-history string is gone — verify: `grep -c "conversationTurns" src/server-ui.ts`
  returns 0
- [ ] **12-message cap workaround removed** — verify: `grep -c "slice(-12)" src/server-ui.ts`
  returns 0
- [ ] **In-memory session log map added** — server accumulates `{role,content}` per session —
  verify: `grep -c "advisorSessionLogs" src/server-ui.ts` >= 2
- [ ] **Resume path used on subsequent turns** — chat spawns claude with `--resume` when a
  sessionId is present — verify: chat handler passes `sessionId` into the spawn so a
  `--resume` flag is emitted (`grep -c "resume" src/server-ui.ts` >= 1) AND the first turn
  injects full context while resume turns send only the new message
- [ ] **New single-session endpoint** — `GET /api/advisor/sessions/:id` returns the full
  AdvisorSession (incl. full_log), 404 on unknown id — verify:
  `grep -c "advisor/sessions/" src/server-ui.ts` >= 1
- [ ] **AdvisorHistory component created** — verify:
  `test -f src/ui/src/components/AdvisorHistory.tsx`
- [ ] **Client API functions added** — verify:
  `grep -cE "fetchAdvisorSessions|fetchAdvisorSession|closeAdvisorSession" src/ui/src/api.ts` >= 3
- [ ] **App.tsx aside swaps to AdvisorHistory for the advisor view only** — other views still
  render LiveFeedSection — verify: `grep -c "AdvisorHistory" src/ui/src/App.tsx` >= 1
- [ ] **AdvisorChat sends a single message, not a history array** — `apiMessages` history
  construction removed — verify: `grep -c "apiMessages" src/ui/src/components/AdvisorChat.tsx`
  returns 0
- [ ] **AdvisorView wires session close on unmount** — `closeAdvisorSession` called from a
  useEffect cleanup when a sessionId exists — verify:
  `grep -c "closeAdvisorSession" src/ui/src/views/AdvisorView.tsx` >= 1
- [ ] **Advisor unit tests added/updated & green (scoped)** — verify:
  `npx vitest run advisor` passes (advisor-scoped, NOT the full suite — keeps VPS load low)

## Should Pass — Non-blocking

- [ ] **localAdvice offline fallback no longer echoes suggestions[0]** for unknown queries —
  verify: `grep -cE "reachable" src/ui/src/lib/advisor.ts` >= 1
- [ ] **Full vitest suite + dual build green** — gated by PR CI on Linux; NOT run on the VPS
  (VPS-OOM avoidance)
- [ ] **Visual QA screenshots** of the history panel — list view, detail view, empty state,
  and the three persona chip colours (PM / Chairman / Coach)
- [ ] **Copy buttons work** — "Copy transcript" and "Copy path" with graceful failure label
  when clipboard is unavailable

## Observed Baseline

- Type errors: 0
- Lint: pass
- Tests + build: CI-gated (not run locally / not run on VPS per VPS-OOM learnings)
- Branch base: `feat/mcpat-102-setup` (rubric + ticket only)

## Loop Configuration

```
max_iterations: 20
no_progress_threshold: 3
budget_ceiling_pct: 80
memory_file: scratchpads/memory-mcpat-102-advisor-session-history.md
```

## Notes for the loop

- The chat endpoint is partially scaffolded already: `sessionId`, the `--resume` regex guard
  (`server-ui.ts` ~3563), the `session` SSE frame, and `spawnClaudeStream({sessionId})` exist.
  The work is removing the `messages[]` rebuild + caps and adding the `advisorSessionLogs` map.
- `AdvisorSession` type, `sessions.jsonl` store, and the `session/close` endpoint already exist
  (MCPAT-097). This loop wires them to the client and fixes the close body shape (read from the
  in-memory log map, not a posted `messages[]`).
- Reuse existing `.adv-msg .user` / `.adv-msg .assistant` CSS for the read-only transcript.
- Do NOT run full `npm test` or `npm run build` on the VPS — let PR CI gate those.
