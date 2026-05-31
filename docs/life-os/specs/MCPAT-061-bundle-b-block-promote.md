# MCPAT-061 — Bundle B: TaskPanel status transitions (Block + Promote) + footer redesign

**Status:** approved
**Type:** feature
**Branch:** `feat/MCPAT-061-bundle-b-block-promote`
**Depends on:** Phase 5 (merged). Supersedes the Bundle-B sketch in `docs/life-os/BUNDLE-BC-HANDOFF.md §3`.

---

## 1. Why

Two gaps in `TaskPanel`'s footer:

1. A `todo`/`in_progress` task **cannot be Blocked from the panel** — only the Today hero or a Board
   drag-to-Blocked can block. We have a Blocked column but no Block button.
2. A `draft`/`approved` task has **no status control at all** in the panel — the user can't move it along
   the chain (`Remove today` exists but nothing advances status).

Separately, the footer is a flat row of 6+ equal-weight buttons (Start, Done, today-toggle, Hermes, ACR,
Delete) that mixes three different *kinds* of action. Adding Block + Promote to that flat row makes it
worse. We redesign the footer into three semantic groups at the same time.

## 2. Design — the "V4 + a touch of V3" footer

Reference mockup: `scratchpads/bundle-b-action-mockup.html` (V4 backbone, V3 icon commands). Three groups,
left→right, with hairline dividers:

```
[ <Primary>  Move to… ▾ ]   [ ⚡  ▲  📅 ]            [ Delete ]
   status group              command group (icons)   danger (right)
```

- **Status group** — one **primary** button (the obvious forward step for the current status) + a
  **"Move to…" ▾** menu listing the *other* valid transitions from `VALID_TRANSITIONS[status]`,
  semantically labelled. Picking **Block** swaps the menu body to an inline **reason input** before firing.
- **Command group** — `today` toggle, **Hermes**, **ACR** rendered as **icon buttons** with `title` +
  `aria-label` (reclaim width; they're rarely the main action). Divider separates them from status.
- **Danger** — Delete stays a guarded two-step control, pushed right (`ml-auto`), unchanged behaviour.

### 2.1 The shared engine (pure, testable) — `src/ui/src/lib/task-actions.ts` (NEW)

All presentation variants share one engine. Extract it to a pure module so it's unit-testable without RTL
(per handoff §6 — push logic into pure functions):

```ts
import type { TaskStatus } from '../types';            // reuse the canonical union — no new literals

export type TransitionTarget = Exclude<TaskStatus, never>;

/** Mirror of server VALID_TRANSITIONS, client-side. Keep in sync with src/ui/src/lib/transitions.ts. */
// (reuse the existing client mirror in transitions.ts; do NOT duplicate the map here —
//  import isValidTransition / the edge map from there.)

/** Intent label for an edge. from-aware where it matters (Resume vs Start, Reopen vs Send to todo). */
export function transitionLabel(from: TaskStatus, to: TaskStatus): string;
//  → in_progress: from closed|blocked ? 'Resume' : 'Start'
//  → done:        'Mark done'
//  → blocked:     'Block'           (the panel appends the reason affordance)
//  → todo:        from closed ? 'Reopen' : 'Send to todo'
//  → approved:    'Promote'
//  → draft:       'Back to draft'
//  → fallback:    to

/** The single obvious forward step per status (null if none valid). */
export function primaryTarget(status: TaskStatus): TaskStatus | null;
//  todo→in_progress, in_progress→done, blocked→in_progress, draft→approved,
//  approved→in_progress, closed→todo ; only returned if actually in VALID_TRANSITIONS[status]

/** Valid targets minus the primary — these populate "Move to…". */
export function secondaryTargets(status: TaskStatus): TaskStatus[];

/** Does this edge require a reason prompt? (block) */
export function requiresReason(to: TaskStatus): boolean;   // to === 'blocked'
```

`primaryTarget` and `secondaryTargets` are derived from the existing client transition map
(`src/ui/src/lib/transitions.ts`) — **do not** hard-code a second copy of the edges. If `transitions.ts`
only exports `isValidTransition`, add an exported `validTargets(status)` there and build on it.

## 3. Backend — extend `POST /api/tasks/:id/transition` (`src/server-ui.ts:1556`)

Two concrete gaps (verified in code):

1. **Allowed-target set is too narrow** (`server-ui.ts:1571`):
   `VALID_TRANSITION_TARGETS = new Set(['todo','in_progress','done','blocked'])`.
   Promote (`draft→approved`) and any `→draft` move 400 today. **Add `'approved'` and `'draft'`** to the
   set. (`isValidTransition` still guards which edges are legal per status — this set is only the outer
   allow-list of values the route will accept.)

2. **`reason` is not persisted to `block_reason`** — the handler writes `reason` only into the
   `transitions[]` entry (`:1589`, `:1596`). The panel renders `block_reason ?? why` for blocked tasks, so
   a panel Block reason would not show. Inside the `persistTaskDurable` mutator (`:1596`):
   - when `to === 'blocked'` and a `reason` is present → `md.block_reason = reason` (and set on the
     in-memory `task` too).
   - when `to !== 'blocked'` → **clear** stale `block_reason` (`delete md.block_reason` / set undefined) so
     a resumed task doesn't carry an old reason.

   Mirror both on the in-memory `task` object returned in the 200 response so the client's optimistic
   reconcile matches the server.

**Markdown-first** via `persistTaskDurable` — **no `TaskStore` in this layer** (handoff §5; codex will
suggest SQLite-first — dismiss with that rationale). Confirm `block_reason` is a known field on the Task
type / MarkdownStore / SqliteIndex round-trip (P4-06 added it — verify it persists through markdown and
survives reconcile; add coverage if missing).

## 4. Frontend — `src/ui/src/components/TaskPanel.tsx`

Near `canReopen` (~`:410`), replace the discrete `canStart`/`canDone`/`canReopen` button cluster with the
grouped footer driven by the engine:

- Compute `primary = primaryTarget(task.status)` and `secondary = secondaryTargets(task.status)`.
- **Primary button**: label `transitionLabel(task.status, primary)`, tone by target
  (done=green, in_progress/todo/approved=blue, blocked=amber); onClick → `handleTransition(primary)`.
- **"Move to…" menu**: one entry per `secondary`, label `transitionLabel(...)`. A `blocked` entry opens the
  inline reason input; confirm → `handleBlock(reason)`. Others → `handleTransition(to)`.
- **Command group**: today toggle (keep `commitLabel`), Hermes (icon, gated on `agent_status==='scheduled'`
  exactly as today), ACR (icon). Preserve all existing handlers/labels in `aria-label`/`title`.
- **Delete**: unchanged guarded two-step, `ml-auto`.

### Handlers (mirror `handleReopen` optimistic pattern, `TaskPanel.tsx:207`)

```
handleTransition(to)            // optimistic snapshot → setQueriesData(status=to) → transitionTask →
                                // rollback on error + surface message
handleBlock(reason)             // handleTransition('blocked', reason); also optimistically set block_reason
handlePromote(to)               // = handleTransition(to)  (draft→approved / approved→in_progress)
```

Use the established optimistic template (handoff §8): snapshot `queryClient.getQueriesData(['tasks'])`,
apply with `setQueriesData`, await `transitionTask(id, to, reason?)`, **roll back on error** and show the
message. 409 (invalid transition) → roll back, surface "Can't move … to …".

## 5. Acceptance criteria

1. **Primary button** shows the correct forward step per status: `todo`→Start, `in_progress`→Mark done,
   `blocked`→Resume, `draft`→Promote, `approved`→Start, `closed`→Reopen. Hidden when no valid forward edge.
2. **Move to… menu** lists exactly the other valid targets from the client transition map, semantically
   labelled. No invalid target ever appears.
3. **Block** (todo/in_progress, and via menu elsewhere where valid) prompts for a reason; transitions to
   `blocked`; the reason **persists to `block_reason`** and renders in the panel after reconcile.
4. **Promote** fires for `draft`→`approved` (and `approved`→`in_progress`) via `/transition` (not
   `/promote`); the route accepts `approved`/`draft` targets (no 400).
5. Leaving `blocked` (Resume/Send-to-todo) **clears** `block_reason`.
6. Every status action is optimistic with rollback + a visible error; invalid transitions 409 server-side
   and roll back client-side.
7. Command group (Hermes/ACR/today) and guarded Delete retain current behaviour; Hermes still disabled when
   `agent_status==='scheduled'`.
8. **Gates pass** (§7).

## 6. Tests

- **Unit (pure, new)** `tests/unit/...task-actions...`: `primaryTarget` / `secondaryTargets` /
  `transitionLabel` / `requiresReason` across every status incl. from-aware labels (Resume vs Start, Reopen
  vs Send-to-todo) and the empty case (`archived`/`done` with no forward edge).
- **Integration (route)**: `POST /transition` with `to:'blocked', reason` → markdown + index show
  `block_reason`; `to:'approved'` accepted (was 400); transition out of blocked clears `block_reason`;
  invalid edge → 409.
- **Source-inspection**: TaskPanel renders the three groups, the primary button, the "Move to…" menu, and
  the Block reason input wiring. (RTL unavailable — handoff §6.)
- Run the **full** `npx vitest run` before push (≈⅓ are source-inspection; changing a className/label may
  require updating those tests to the new reality — handoff §4).

## 7. Gates (handoff §2, §3)

`npm run type-check` (root `tsc --noEmit` **+** `tsc -b` UI) → **full** `npx vitest run` →
`npx tsup` + `npm --prefix src/ui run build` → **codex** (`codex-diff-review.mjs "main..HEAD" <specPath>`,
≤3 rounds; fix real findings, document dismissals) → **security-scanner** (backend route change: validate
target allow-list, reason handling) → gated-CI merge on the **status string** (not `gh run watch | tail`).
Windows: kill `dist/server` node holders before `tsup`; `git checkout .handbook/` before each commit; no
`Co-Authored-By`.

## 8. Out of scope / deferred

- Generic status **dropdown** that subsumes the primary button (we chose primary + Move-to-…).
- `prefix` rename, project `name` field, settings cog → **Bundle C** (next).
- The `rebuild-index` global-store gap noticed during setup → separate MCPAT task.
