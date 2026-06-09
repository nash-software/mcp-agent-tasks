# MCPAT-085 — Artifacts: surface task-linked docs + open-in-default-app

## Problem

The dashboard Artifacts table is always empty, and task-linked documents never appear there. The user
wants linked docs (specs/plans/touched files) to show up in Artifacts and to click a row to open the
document in the OS default app, so they can review and tick work off.

## Findings (confirmed)

- `GET /api/artifacts` reads ONLY `~/.mcp-tasks/artifacts.jsonl` — `src/server-ui.ts:343,372-434`.
  `readArtifacts()` returns `[]` if the file is missing (`:373`) and filters records older than 30 days (`:398`).
- That JSONL is written ONLY by the passive-capture hook (`hooks/passive-capture.js:209-258`), installed
  via `agent-tasks install-claude-hooks`. If never installed/triggered -> file absent -> empty table.
- Task-linked docs are stored as task frontmatter: `spec_file`, `plan_file` (`src/types/task.ts:86-87`)
  and `files[]` (`:103`). None are surfaced in Artifacts — the source is purely the JSONL.
- serve-ui binds 127.0.0.1/localhost only (`src/server-ui.ts:3600`).
- An OS-open pattern already exists (`src/server-ui.ts:3603-3609`): `start "" "<x>"` on win32, `open` on
  darwin, `xdg-open` on Linux.
- A path-traversal guard exists and is in use: `isPathWithinRoots()` (`src/fs-sandbox.ts:15`, used at
  `server-ui.ts:1494` with `realpathSync` symlink resolution and a `roots` list defined ~`:1476`).

## Approach

### 1. Surface task-linked docs in GET /api/artifacts (src/server-ui.ts)

- After `readArtifacts()` (JSONL), iterate all tasks across `projectIndexes`.
- For each present `spec_file`, `plan_file`, and entry in `files[]`, synthesize an `ArtifactEntry`
  (existing type, already has the needed fields incl. `task_id`):
  - `task_id` = task id, `project` = task prefix, `created_at` from the task's `updated` timestamp,
    `path` = the doc path (resolve relative paths against the project root), and a `source` marker
    distinguishing `linked-doc` from passive `capture` (add optional `source?: 'capture' | 'linked-doc'`
    to `ArtifactEntry` if absent; default JSONL entries to `'capture'`).
- Merge + dedup synthesized entries with JSONL entries (dedup by resolved absolute path).
- Linked-doc entries are NOT subject to the 30-day passive-capture filter (they reflect live task state).

### 2. New POST /api/artifacts/open (src/server-ui.ts)

- Body `{ path: string }`. `realpathSync(path)` then `isPathWithinRoots(real, roots)` using the same
  `roots` as the fs-list endpoint. Reject traversal/out-of-root with 403; missing file with 404.
- Open via the existing platform switch (`start ""` / `open` / `xdg-open`), fire-and-forget. Respond `{ ok: true }`.

### 3. Client (src/ui/src/api.ts)

- `openArtifact(path: string): Promise<void>` -> POST /api/artifacts/open. Surface errors to the caller.

### 4. UI (src/ui/src/views/ArtifactsView.tsx)

- Render merged artifacts incl. linked-doc rows; show a distinct badge for `linked-doc` vs `capture`.
- A row (or explicit "Open" affordance) calls `openArtifact(path)`; show a toast/inline error on failure.
- Keep the empty-state copy only when there are genuinely zero artifacts of any source.

## Acceptance Criteria

- AC1: with tasks that have spec_file/plan_file/files set, GET /api/artifacts returns those as entries
  (correct task_id, project, path, source:'linked-doc'), even when the JSONL is absent.
- AC2: JSONL passive-capture entries still appear tagged source:'capture'; a doc in both sources appears
  once (deduped by resolved path).
- AC3: POST /api/artifacts/open opens an in-root file ({ok:true}) and rejects traversal/out-of-root (403)
  and missing file (404). No shell-injection surface (reuse the existing exec pattern).
- AC4: ArtifactsView renders linked-doc rows with a distinguishing badge and a working open action;
  errors surfaced, not swallowed.
- AC5: `npm run type-check`, `npm run build`, UI `tsc -b`, and `npm test` pass; new endpoint tests cover AC1-AC3.

## Tests

- Server: artifacts merge includes linked docs from a fixture store; dedup works; open endpoint accepts
  in-root, rejects traversal (403) and missing (404).
- UI: type-check + build; optional render test for the badge + open call.

## Out of scope

- No change to the passive-capture hook. No new dependencies. Open-only (no editing from the UI).

## Files

- `src/server-ui.ts` — /api/artifacts merge + new /api/artifacts/open
- `src/ui/src/api.ts` — openArtifact client
- `src/ui/src/views/ArtifactsView.tsx` — linked-doc rows, badge, open action
- tests — endpoint coverage for AC1-AC3
