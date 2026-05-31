# Bundle B + C Handoff — Life OS dashboard (mcp-agent-tasks)

**For the next agent / a fresh window.** Self-contained — read it fully before touching code. It covers the
two remaining net-new features after Phase 5 (which is **complete**): **Bundle B** (status transitions +
Block button) and **Bundle C** (projects/settings cog). It tells you what exists, what to build, the
file:line anchors, the acceptance criteria, and the **process conventions you must follow** (each learned
the hard way — see §5).

> Deeper background on the dashboard, stack, and Phases 1–5 lives in `docs/life-os/PHASE5-HANDOFF.md`.
> Read that §1 (what this is) + §5 (conventions) if you want the full picture; this doc repeats the
> load-bearing parts.

---

## 1. What this is (1 paragraph)

`mcp-agent-tasks` is a file-based task manager for AI agents (markdown source-of-truth + a rebuildable
SQLite index, ~22 MCP tools). The **Life OS dashboard** is a React 18 + TS-strict + TanStack Query +
Tailwind v3 UI (`src/ui/src/`) over a raw-HTTP backend (`src/server-ui.ts`, the `serve-ui` command, port
4242). Markdown is the source of truth; `src/store/` holds MarkdownStore (writes), SqliteIndex (derived),
Reconciler (rebuilds index from markdown).

## 2. Current state (read this)

- **Phase 5 is DONE.** P5-01…P5-08 + P5-09 (bug sweep) + P5-10 (ID-collision integrity) are all merged to
  `main` (PRs #60–#69). `main` is green. Tests: **1097 passing**.
- **Already exists that you'll build on:**
  - **Transitions:** server state machine `src/types/transitions.ts` (`VALID_TRANSITIONS`); client mirror
    `src/ui/src/lib/transitions.ts`. Current edges incl. `todo→[in_progress,blocked]`,
    `in_progress→[done,blocked,todo,approved]`, `blocked→[in_progress,todo]`, `draft→[approved,blocked]`,
    `approved→[in_progress,draft,blocked]`, `closed→[todo,in_progress]` (P5-05), `archived→[]`.
  - **Transition route:** `POST /api/tasks/:id/transition { to, reason? }` (`server-ui.ts`, P4-01) —
    bridges `isValidTransition`; returns 409 on invalid. Client: `transitionTask(id, to, reason?)`
    (`src/ui/src/api.ts`).
  - **TaskPanel footer buttons** (`src/ui/src/components/TaskPanel.tsx`): Start (todo/blocked→in_progress),
    Done (in_progress→done), Reopen/Resume (closed→todo/in_progress), Remove-today, Hermes, ACR, and a
    guarded Delete. **There is NO Block button and NO promote for drafts** — that's Bundle B.
  - **Block plumbing already half-exists:** `useToday.blockTask(taskId, reason?)`
    (`src/ui/src/hooks/useToday.ts:276`) is wired to a `block_reason` flow, but it's only used by the Today
    **HeroTask** (`TodayView.tsx:185,286 onBlock`). The panel doesn't expose Block at all.
  - **Projects:** `GET /api/projects` (`server-ui.ts:1111`) returns `{ prefix, path }[]` via
    `buildProjectsList` (`src/projects-list.ts`); GEN is included (P5-09). Config lives at
    `~/.config/mcp-tasks/config.json`, typed as `GlobalConfig` (`src/types/config.ts`), projects =
    `{ prefix, path, storage }` — **no `name` field, no create/rename/init HTTP endpoint**. MCP tool
    `task_register_project` (`src/tools/task-register-project.ts`, inputs `{prefix, path}`) does the
    register-a-project work for the MCP layer — reuse its logic for the HTTP endpoint.

---

## 3. Bundle B — status transitions + Block button

### Why
A `todo`/`in_progress` task can't be **blocked** from the panel (only the Today hero can, or by dragging to
the Board's Blocked column). And a `draft`/`spec` task has **no status button at all** in the panel — the
user can't move it along the chain. The user hit both ("we have a Blocked column but no Blocked button";
"Remove today exists but no other way of moving it along the chain").

### Scope
1. **Block button in TaskPanel** — for `todo`/`in_progress` tasks, a "Block" control that prompts for a
   **reason** and calls `transitionTask(id, 'blocked', reason)`. Optimistic + rollback + error surface
   (mirror the P5-05 `handleReopen` optimistic pattern in TaskPanel). The panel already renders
   `block_reason ?? why` for blocked tasks, so the reason will show.
   - **Verify:** does the `/transition` route persist `reason` into the task's `block_reason` field (not
     just the `transitions[]` entry)? If not, extend the route (markdown-first via `persistTaskDurable`)
     so a Block reason lands in `block_reason`. Check `block_reason` handling (P4-06).
2. **Promote/advance for drafts** — for `draft` tasks, a "Promote" control (`draft→approved` or
   `draft→todo`; there's also a legacy `POST /api/tasks/:id/promote` for draft→todo). Decide: use
   `/transition` (consistent) over `/promote`. For `approved`, offer `→in_progress`.
3. **Optional (confirm with user): a generic status dropdown** in the panel that offers exactly the valid
   next states from `VALID_TRANSITIONS[task.status]` — this would subsume Start/Done/Block/Reopen/Promote
   into one affordance. Cleaner, but a bigger refactor of the footer. Default: **add discrete Block +
   Promote buttons** (smaller, matches existing Start/Done/Reopen pattern); raise the dropdown idea as an
   option.

### Files
- `src/ui/src/components/TaskPanel.tsx` — add `canBlock` (todo/in_progress) + `canPromote` (draft/approved)
  flags near `canReopen` (~line 405); add `handleBlock(reason)` + `handlePromote(to)` mirroring
  `handleReopen` (optimistic snapshot + rollback); add the buttons in the footer action row.
- `src/server-ui.ts` — **only if** the transition route doesn't already persist `reason→block_reason`;
  extend the `/transition` handler (markdown-first, no `TaskStore`).
- Tests: unit on any transition-map change (none expected — block edges already exist); integration on the
  `/transition` reason→block_reason persistence if you touch the route; source-inspection for the panel
  buttons (RTL unavailable — see §5).

### Acceptance criteria (sketch — write a real spec first, see §5)
1. Block button shows for `todo`/`in_progress`, hidden otherwise; clicking prompts for a reason and
   transitions to `blocked`; the reason persists to `block_reason` and renders in the panel.
2. Promote shows for `draft` (→todo/approved) and `approved` (→in_progress); fires `transitionTask`.
3. Optimistic + rollback + visible error on each (overview §5).
4. Invalid transitions still 409 server-side and roll back client-side.
5. Gates pass (§5).

---

## 4. Bundle C — projects / settings cog (FULL scope — user chose this)

### Why
Projects can only be created/registered via MCP tools (`task_init` / `task_register_project`) or by hand-
editing `~/.config/mcp-tasks/config.json`. There's **no in-app way** to see what projects exist, rename
them, or initialise a new one at a folder. And badges show only the prefix ("ACR") — the user wants full
names ("ACR — Agent Control Room", "COND — Conductor").

### Scope (the user explicitly chose "list + rename + init-from-folder")
1. **Add a `name` field to projects.** Extend the project config type (`src/types/config.ts` `GlobalConfig`
   projects) with optional `name`; thread it through `ConfigLoader` (`src/config/loader.ts`),
   `buildProjectsList` (`src/projects-list.ts`), and the `/api/projects` response.
2. **New backend endpoints** (`src/server-ui.ts`, markdown-first / no `TaskStore`; write config atomically
   — there's an existing "atomic config write via temp-file rename" pattern, see `critical-rules.md` and
   the project-router):
   - `POST /api/projects` — register + init a project: body `{ prefix, path, name? }`. Validate prefix
     uniqueness + format, validate the folder path exists, create its `agent-tasks/` dir, init the
     SqliteIndex, append to `config.projects`, return the new project. Reuse `task_register_project` logic.
   - `PATCH /api/projects/:prefix` — rename: update `name` (and/or other mutable fields). **Renaming the
     `prefix` itself is harder** (it's the task-ID prefix → would require migrating every task ID, i.e.
     P5-02's `migrateTaskId` primitive). Default: **allow editing `name` only; keep `prefix` immutable**
     (note it as deferred, like P5-03's project-reassignment deferral). Confirm with user.
3. **UI: a settings cog** (in `Nav`, near the `+ New task` / `Search` buttons) → a **ProjectsModal**
   (mirror `NewTaskModal.tsx` from P5-04 for the modal pattern): list all projects (prefix, name, path,
   open-task count), edit the full name inline, and an "Add project" form (prefix + folder path + name →
   `POST /api/projects`). Invalidate `['projects']` on success.
4. **Full names in badges** — once `/api/projects` returns `name`, surface "PREFIX — Name" where it helps:
   the FilterBar popover already shows a `name` (defaults to prefix, `App.tsx`), and the project chips.
   Keep the compact prefix on dense task rows; show the full name in the filter list + the projects panel.

### Open questions (raise with user before/while building)
- **Folder picker.** A browser dashboard can't open a native folder dialog. Options: (a) a **path text
  input** (simplest; validate the path exists server-side) — recommended to start; (b) a server-side
  **directory-browser endpoint** (`GET /api/fs/list?path=`) for click-to-pick — nicer UX but more work
  **and a path-traversal surface** (must sandbox to allowed roots). Default: ship (a), offer (b) as a
  follow-up.
- **Prefix rename.** Immutable for now (renaming the prefix = re-ID every task; that's P5-02/MCPAT migrate
  territory). Confirm.
- **Init vs register.** "Init at a folder" = create `<folder>/agent-tasks/` + index + config entry. An
  existing folder that already has tasks → just register (reconcile to pick up existing markdown).

### Acceptance criteria (sketch — write a real spec first)
1. `/api/projects` returns `name` (falls back to prefix when unset); badges/filter show "PREFIX — Name".
2. `POST /api/projects` registers + inits a new project (dir + index + config); it appears in the list and
   the filter without a server restart (it's added to the live `projectIndexes`).
3. `PATCH /api/projects/:prefix` updates the name; persists to config atomically.
4. Settings cog opens a panel listing projects with edit-name + add-project; errors surface; invalid
   prefix/duplicate/bad-path → visible error.
5. Config writes are atomic (temp-file rename); a malformed write can't corrupt config.
6. Gates pass.

> **Backend note:** adding a project to the **live** server means pushing into the in-memory
> `projectIndexes` array (see how `createProjectIndexes` builds it, `server-ui.ts` ~556-583) — not just
> writing config. Otherwise the new project won't show until restart. Handle both (config + live index).

---

## 5. Process conventions — FOLLOW THESE (each is a scar from the Phase-5 run)

1. **Write a spec first, then build.** Each bundle should get a spec in `docs/life-os/specs/` (mirror the
   P5-xx specs: Why / Scope / Data shapes / ACs / Build steps / Failure modes). Then implement against it.
   Task IDs continue the **MCPAT** sequence (Phase 5 ended at MCPAT-060; next free is **MCPAT-061**).
   Branch naming: `feat/MCPAT-0XX-bundle-b-...` / `...-bundle-c-...`. No `Co-Authored-By` in commits.
2. **The real gate (run every spec):** `npm run type-check` (root `tsc --noEmit` **+** UI `tsc -b`) →
   **full** `npx vitest run` → `npx tsup` + `npm --prefix src/ui run build` → **codex**
   (`node ~/.claude/skills/codex-review/scripts/codex-diff-review.mjs "main..HEAD" "<specPath>" <round>`,
   up to 3 rounds; fix real findings, **document dismissals**). Add **security-scanner** for any
   backend/route/input change (Bundle C's new endpoints qualify — path validation, config write).
3. **Gated-CI merge — do NOT trust `gh run watch | tail`** (it returns tail's exit code, masking red CI).
   `gh run watch "$RUN" --exit-status >/dev/null 2>&1` then gate on the **status string**:
   `STATUS=$(gh pr checks <N> | grep '^ci' | awk '{print $2}'); [ "$STATUS" = pass ] && gh pr merge <N> --squash --admin --delete-branch`.
   CI **is** the acceptance test for infra changes.
4. **Run the FULL `npx vitest run` before every push.** ~⅓ of the suite is **source-inspection** tests
   (`readFileSync` + `toContain('literal')`); they break when you change an implementation string (a
   className, a label, a function name). A subset run misses them. When you legitimately change a string a
   source-inspection test asserts, **update the test to the new reality** (not weaken it) — that's correct,
   not cheating.
5. **`server-ui.ts` is the dashboard layer — markdown-first via `persistTaskDurable`. Do NOT add
   `TaskStore` there.** Codex will repeatedly suggest the store-layer "SQLite-first" write protocol; the
   server-ui convention is **markdown-first** (and it self-heals via reconcile). Dismiss with that rationale.
6. **RTL is NOT installed** (`@testing-library/react`). UI behaviour is tested by: (a) **behavioral** tests
   of extracted pure functions / API helpers (fetch-mocked) where possible — prefer this; (b)
   **source-inspection** for pure JSX wiring. Codex will flag "use RTL" every time — dismiss (documented
   limitation), but push as much logic into testable pure functions as you can (see P5-09's
   `buildProjectsList` / `isCommittedBucket`, P5-06's fetch-mocked `quickCapture` test).
7. **Codex can flip-flop and can be wrong vs the backend.** Two real cases this phase: (a) P5-06 — the spec
   said `context` was an object, but the **backend reads it as a string** (`server-ui.ts:1961`); the code
   was right, the spec wrong — **backend is source of truth**. (b) P5-07 — codex round 1 said "replace
   PointerSensor with MouseSensor", round 2 said "restore PointerSensor". **Anchor on the technical/code
   evidence, not the spec wording or a single codex round.** Document the deviation in the spec when you
   correct it.
8. **Optimistic mutation pattern** for panel actions: snapshot `queryClient.getQueriesData(['tasks'])`,
   apply the optimistic change with `setQueriesData`, await the mutation, **roll back the snapshot on
   error** and surface the message. See `handleReopen` / `handleDelete` in `TaskPanel.tsx` for the template
   (Bundle B's Block/Promote should mirror it). For single-value selects the panel uses commit-then-
   invalidate (no optimistic state) — that's the established convention, defensible against codex.
9. **Windows gotchas:** vitest uses `pool:'forks'` (configured). Before `npx tsup`, kill holders:
   `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'mcp-agent-tasks.dist.server' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`.
   **`npm run build` is now decoupled** (P5-08) — it compiles only and no longer wipes `src/ui/node_modules`;
   use `npm run build:ui` for a from-scratch UI install. Never `git checkout` across branches while the
   mcp-agent-tasks MCP server holds the SQLite WAL lock — use a fresh branch off `main`. The **Edit/Write
   tools can silently embed a literal control byte (NUL)** when you intend an escape in a regex/string
   (turns the file binary); if `grep` reports "Binary file matches", byte-scan and fix via a dedicated
   `.cjs` script, not inline `node -e`.
10. **`.handbook/` churn** is auto-generated — `git checkout .handbook/` before every commit. Don't commit
    `dist/` or `scratchpads/` (both gitignored).
11. **Restart `agent-tasks serve-ui`** to see changes in the running dashboard (dev server transpiles but
    you rebuild dist for the server). Mention this to the user when a UI/route change lands.

## 6. Suggested order
1. **Bundle B first** (smaller, no new endpoints): spec → Block button + Promote in TaskPanel → verify
   `reason→block_reason` persistence → gates → PR → gated merge.
2. **Bundle C** (bigger, new endpoints + config writes + a settings panel): spec → `name` field through
   config/api → `POST`/`PATCH /api/projects` (+ security-scanner) → settings-cog modal → full-name badges →
   gates → PR → gated merge. Decide the folder-picker approach (path input first) and prefix-immutability
   with the user early.

Each: branch from fresh `main`, write the spec, build, full gates, codex, gated-CI merge, sync `main`.
