# MCPAT-064 — TaskPanel footer: split button, real Claim, lucide icons

**Status:** approved
**Type:** feature
**Branch:** `feat/MCPAT-064-footer-claim-icons`
**Builds on:** MCPAT-061 (the grouped footer + status-action engine).

## Why (user feedback on the MCPAT-061 footer)
1. The primary + "Move to…" rendered as **two separate buttons** — it was meant to be a **split button**
   (`Complete │ ▾`): one main action with an attached chevron for the rest.
2. **"Start"** is the wrong verb for `todo → in_progress` — it reads as a position flip. The real step is
   taking ownership → **Claim** (wire `claimed_by`, not just relabel).
3. **"Commit today"** is scheduling, not assigning, and too wide → a **calendar icon**.
4. **Hermes/ACR emoji (⚡/▲) look bad**, Delete should be a **bin icon** → use **lucide** icons (already a dep).

## 1. Backend — `POST /api/tasks/:id/claim` (`src/server-ui.ts`, markdown-first; no TaskStore)
Body: none (or `{}`). Behaviour:
- 404 if task not found.
- Set `claimed_by = os.userInfo().username` (the local dashboard user), `claimed_at = now`.
- If `status === 'todo'`, also transition `→ in_progress` (claiming = taking it on) with a `transitions[]`
  entry `{from:'todo', to:'in_progress', at, reason:'Claimed'}`; if already in_progress/other, just set the
  claim fields (no status change). Guard: only allow claim from `todo`/`in_progress` (others → 409).
- Persist via `persistTaskDurable` (markdown + index), mirror onto the in-memory task, return the task.
- Idempotent: claiming an already-claimed-by-me task is a no-op success.

## 2. Client — `src/ui/src/api.ts`
`claimTask(id: string): Promise<Task>` → `POST /api/tasks/${id}/claim`; throw on non-2xx (rollback).

## 3. Engine — `src/ui/src/lib/task-actions.ts`
`primaryTarget`/`secondaryTargets` unchanged (status edges). The footer decides presentation:
- `todo`: primary is **Claim** (not a status label) → `handleClaim`. Secondary menu = the other valid
  todo moves (Block). So `todo`'s status-primary (`in_progress`) is *replaced* by Claim in the UI; do NOT
  also show a "Start". (Add a tiny helper or inline check `task.status === 'todo'`.)
- all other statuses: primary = `transitionLabel(status, primaryTarget)` → `handleTransition` (unchanged).

## 4. UI — `src/ui/src/components/TaskPanel.tsx`
### 4.1 Split button
Fuse the primary button + the "Move to…" caret into ONE split control:
- primary segment: `rounded-l` (rounded-r-none), the action label.
- caret segment: `rounded-r` (rounded-l-none), `border-l border-black/20`, a lucide `ChevronDown`, opens the
  existing Move-to menu (same `moveMenuOpen`/`blockDraft` state + inline Block reason). Same tone as primary.
- When there are no secondary targets, render just the primary (no caret).
- `aria-haspopup="menu"` / `aria-expanded` on the caret.

### 4.2 Claim handler + assignee
- `handleClaim()` — optimistic (mirror `handleTransition`): snapshot, optimistically set
  `status:'in_progress'` + `claimed_by` on the cached task, `await claimTask(id)`, invalidate, rollback on error.
- **Assignee badge**: when `task.claimed_by` is set, show a small `lucide User` + the name near the header
  meta row (detail mode). Reuse existing chip styling.

### 4.3 Icons (lucide-react)
Replace the command-group emoji + Delete with lucide icons (icon buttons keep `aria-label`/`title`):
| Control | Icon |
|---|---|
| Hermes (sign off) | `Send` |
| ACR (dispatch) | `Bot` |
| Delete | `Trash2` |
| Today toggle | `CalendarPlus` (unset) / `CalendarCheck` (scheduled) — tooltip "Add to today" / "Remove from today" |
| Split caret | `ChevronDown` |
Size ~14px (`size={14}`), `aria-hidden` on the glyph, label on the button.

## 5. Acceptance criteria
1. Primary + other-moves render as ONE split button (shared border, caret opens the menu); no separate
   "Move to…" text button. No caret when there are no other valid moves.
2. A `todo` task's primary is **Claim**; clicking it sets `claimed_by` to the local user AND moves the task
   to `in_progress` (one click); optimistic + rollback on error.
3. `POST /api/tasks/:id/claim` sets `claimed_by`/`claimed_at`, persists markdown-first, transitions todo→
   in_progress, 404 on unknown, 409 from an unclaimable status, idempotent re-claim.
4. The assignee (`claimed_by`) is visible in the panel when set.
5. Hermes/ACR/Delete/today render as lucide icons (no emoji); today reflects scheduled state.
6. Gates pass (incl. **security-scanner** on the new claim route, and **full vitest** — source-inspection
   tests assert the footer/icon strings, so update them to the new reality).

## 6. Tests
- **Integration** (`mutation-endpoints` or new): claim sets claimed_by + moves todo→in_progress (re-read);
  claim unknown → 404; claim from a bad status → 409; re-claim idempotent.
- **Source-inspection** (`ui-task-panel`): split-button structure (rounded-l/r + caret), `handleClaim`/
  `claimTask`, lucide imports (`Send`/`Bot`/`Trash2`/`CalendarPlus`/`ChevronDown`), assignee/`claimed_by`
  render. Update the MCPAT-061 footer assertions (Hermes/ACR aria-labels stay; emoji gone).
- Full `npx vitest run` before push.

## 7. Gates
type-check (root + UI) → full vitest → tsup + UI build → codex (≤3) → **security-scanner** (claim route) →
gated-CI merge on the status string. Windows: kill dist/server holders before tsup; `git checkout .handbook/`
before commits; no `Co-Authored-By`.

## 8. Out of scope
- Unclaim/release button, reassign-to-other-user, an assignee filter. (Single-user claim only for now.)
- Touching `task_claim` MCP tool / `ctx.sessionId` semantics.
