# Phase 5 Handoff — Life OS dashboard (mcp-agent-tasks)

**For the next agent.** This is self-contained — read it fully before touching code. It tells you what's shipped, what's left, the exact resume step, and the **process conventions you must follow** (each was learned the hard way this session).

---

## 1. What this is

`mcp-agent-tasks` is a file-based task manager for AI agents (markdown source-of-truth + a rebuildable SQLite index, 20 MCP tools). The **Life OS dashboard** is a React UI (`src/ui/src`) over a raw-HTTP backend (`src/server-ui.ts`, the `serve-ui` command, port 4242). Phases 4–5 turn that dashboard from a read-only shell into a working app.

- UI: React 18 + TS strict + TanStack Query + Tailwind v3 — `src/ui/src/`
- Backend dashboard: `src/server-ui.ts` (raw `http.createServer`)
- Store: `src/store/` (MarkdownStore = source of truth; SqliteIndex = derived; Reconciler rebuilds index from markdown)

## 2. Already shipped this session (all merged to `main`, full CI + codex)

- **MCPAT-049** — SQLite index hardening (the index had bloated to 5.6 GB; now self-healing/capped). PR #51.
- **Phase 4 (MCPAT-041…048)** — editable tasks + `PATCH`/`POST /transition` routes, Done→Completed sprint-closure tab, board drag-and-drop (`@dnd-kit`), commit-to-Today estimate prompt, roadmap task↔milestone linking, UI bug batch, enablement/infra. PRs #52–59.
- **P5-01 (MCPAT-051)** — fixed the **blind UI type-check gate** (it was `tsc --noEmit` on a solution-style tsconfig → compiled 0 files → 22 errors shipped green) to `tsc -b`, and fixed all 22. PR #60. **Consequence for you: the UI gate now actually works — keep `tsc -b` green.**
- **P5-02 (MCPAT-052)** — `rerouteTask` data-loss fix (`migrateTaskId`, markdown-first + behavioral test) + prompt-injection hardening of the routing/braindump prompts. PR #61.

`main` is currently at the P5-02 merge and is green. Backfilled task records: MCPAT-041…048 exist in the store.

## 3. The Phase 5 spec set (your work)

All specs are on `main` in **`docs/life-os/specs/`**. The epic overview (`00-epic-overview.md` §13) has shared tokens (§3), data shapes (§4), client conventions (§5), and the build-order DAG. The driving audit is **`docs/life-os/audit/2026-05-31-post-phase4-gaps.md`** (file:line evidence for every gap).

| Spec file | Task | What it does | Status |
|---|---|---|---|
| `P5-01-typecheck-gate-and-errors.md` | MCPAT-051 | tsc -b gate + 22 fixes | ✅ merged #60 |
| `P5-02-backend-correctness-prompt-hardening.md` | MCPAT-052 | rerouteTask markdown-first + prompt hardening | ✅ merged #61 |
| `P5-03-task-field-editing.md` | MCPAT-053 | edit area/tags/type/milestone from the panel | 🔶 **WIP — start here** |
| `P5-04-new-task-and-delete.md` | MCPAT-054 | New-task modal + `DELETE /api/tasks/:id` | ⏳ pending |
| `P5-05-reopen-closed-interactive-completed.md` | MCPAT-055 | reopen closed tasks + clickable Completed tab | ⏳ pending |
| `P5-06-capture-context-error-toast.md` | MCPAT-056 | wire capture `context` (dormant COND fix) + roadmap error toast | ⏳ pending |
| `P5-07-mobile-board.md` | MCPAT-057 | TouchSensor + responsive board grid | ⏳ pending |
| `P5-08-build-hygiene.md` | MCPAT-058 | decouple `npm ci` from the build script | ⏳ pending |

**Build order / DAG:** P5-01 → P5-02 are done. P5-03/04/05/06/07 are otherwise independent but **ship SEQUENTIALLY** — they each touch `server-ui.ts` / `TaskPanel.tsx` / `api.ts`, so concurrent branches collide. P5-08 is an independent chore (any time). **Do NOT run two builders in parallel on the same working tree** (it caused a git collision this session).

**Deferred (noted, not in scope unless asked):** task `project` *reassignment* (needs P5-02's `migrateTaskId` extended to cover subtask/git ref surfaces — see P5-02 codex F2 follow-up), `draft`/`approved` board columns (design call), RTL test migration (the suite is ~33% brittle source-inspection tests; `@testing-library/react` is NOT installed), structured routing confidence.

## 4. ⏭️ Resume here: finish P5-03

**Branch:** `feat/MCPAT-053-p5-03-task-field-editing` (pushed; has a WIP commit). It is **NOT mergeable yet** — `tsc -b` currently fails on unused declarations because the editor controls aren't rendered.

**Done on this branch:**
- Backend `src/server-ui.ts`: `PATCH /api/tasks/:id` accepts + validates `area`/`tags`/`type` (+ `milestone`), markdown-first. ✅ correct.
- `src/ui/src/api.ts`: `TaskUpdateFields` extended with `area?`/`tags?`/`type?`. ✅
- `src/ui/src/components/TaskPanel.tsx`: edit state (`editArea`/`editType`/`editMilestone`/`tagInput`), `AREAS`/`TASK_TYPES` consts, `useMilestones()`, and `commitField` extended to accept the new fields. ✅ **scaffold only.**

**The one remaining step:** render the editor controls in `TaskPanel.tsx` (detail mode), wired to the existing state + `commitField`:
- **area** `<select>` (the 4 areas + clear) → `commitField({ area })`
- **type** `<select>` (`TASK_TYPES`) → `commitField({ type })`
- **tags** chip editor (render tags with × to remove; `tagInput` + Enter to add) → `commitField({ tags: [...] })`
- **milestone** `<select>` of `milestones` filtered to the task's project + clear → `commitField({ milestone }, ['milestones'])`

Follow the panel's EXISTING edit pattern (how title/why/priority/estimate are edited). Once rendered, the "unused decl" errors clear.

**Then:** `npm --prefix src/ui run type-check` (tsc -b) green → extend the PATCH test in `tests/integration/mutation-endpoints.test.ts` for area/tags/type (set + reject-invalid) → full suite → build → PR → merge.

## 5. Process conventions — FOLLOW THESE (each is a scar)

1. **Gates per spec (the "real pipeline"):** `npm run type-check` (root tsc **+** UI `tsc -b`) → **full** `npx vitest run` → `npx tsup` + `npm --prefix src/ui run build` → **codex** (`node ~/.claude/skills/codex-review/scripts/codex-diff-review.mjs "main..HEAD" "<specPath>" <round>`). Run codex up to 3 rounds; fix real findings, document dismissals. Add **security-scanner** for backend/security-touching phases.
2. **Gated CI merge — do NOT trust `gh run watch | tail`.** That returns *tail's* exit code (0), masking a red CI (it caused an admin-merge over red CI this session). Always: `gh run watch "$RUN" --exit-status >/dev/null 2>&1` then gate on the **status string**: `STATUS=$(gh pr checks <N> | grep '^ci' | awk '{print $2}'); [ "$STATUS" = pass ] && gh pr merge <N> --squash --admin --delete-branch`.
3. **Run the FULL `npx vitest run` before every push.** ~24/72 test files are **source-inspection** (`readFileSync` + `toContain('literal')`). They break when you change an implementation string (a className, `v <= 0`, stub text). A subset run misses them. (PR #55 broke CI exactly this way.)
4. **server-ui.ts is the dashboard layer — markdown-first via `persistTaskDurable`. Do NOT introduce `TaskStore` there.** Codex will repeatedly suggest it; dismiss with this rationale (TaskStore isn't wired into this layer; persistTaskDurable is the convention since P2-04). This is consistent and correct.
5. **Windows:** vitest needs `pool:'forks'` (already configured). Before `npx tsup`, kill holders: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'mcp-agent-tasks.dist.server' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`. The root `npm run build` runs `npm --prefix src/ui ci` (wipes UI node_modules) — for iterating, prefer `npx tsup` + `npm --prefix src/ui run build` directly. Never `git checkout` across branches while the mcp-agent-tasks MCP server holds the SQLite WAL lock.
6. **Builders hit a ~49-tool-use ceiling** and return PARTIAL with uncommitted work, often mid-edit. After every builder: check `git status`, run **ground-truth `tsc`/`tsc -b`** (the LSP over-reports stale `'cancelled'`/unused-import errors that tsc doesn't enforce — trust tsc, not the inline diagnostics), finish the tail, then commit. Watch for **bogus files** from botched shell redirects (e.g. a file literally named `detail` or `chunks.push(c))`) — delete them.
7. **`.handbook/` churn** is auto-generated — `git checkout .handbook/` before committing. Don't commit `dist/` (gitignored) or `scratchpads/` (gitignored).
8. **Config protection hook:** a PreToolUse hook blocks edits to tsconfig that look like weakening (e.g. adding `skipLibCheck`/`lib`). If you need a type from a dep's `.d.ts`, prefer a **file-scoped** `/// <reference lib="..." />` (see `src/ui/vite.config.ts` for the webworker example).
9. **Branch/commit naming:** `feat/MCPAT-0XX-p5-YY-slug`; commit messages end with NO `Co-Authored-By`. The post-merge hook auto-links commits by branch task-id.
10. **Don't run two builders in parallel on the same checkout.** Sequential only (or use `isolation: worktree`).

## 6. State / tracking

- Run-phases session state: `scratchpads/.run-phases/20260531-p5/state.json` (gitignored — local only; recreate if needed). It records P5-01/02 completed, P5-03 wip, P5-04…08 pending.
- Task store: `~/.mcp-tasks/tasks/` (markdown). The MCP `task_*` tools flap when builds kill `dist/server.js` — if disconnected, you can `node dist/cli.js rebuild-index` / `list` directly, or write task markdown + rebuild.

## 7. Suggested order for the next session
1. Finish **P5-03** (render the editor JSX — §4) → PR → merge.
2. **P5-04** (new-task modal + delete) → … sequential through **P5-07**.
3. **P5-08** (build hygiene) any time.
Each: branch from fresh `main`, build, full gates, gated-CI merge, sync `main`.
