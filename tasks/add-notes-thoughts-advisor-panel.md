# Add Notes, Thoughts & Advisor Panel to Enable Project-Aware Strategic Knowledge Capture

**Type**: Epic

## Description

Tasks capture *what to do* but lose the *why* — the strategic context, half-formed ideas,
and research notes that actually drive decisions about where to spend effort. There is
currently no place to record "the website is live, I've seen this workflow pattern,
here's the business opportunity I'm thinking about" alongside the tasks it relates to.
That thinking lives in your head, a disconnected notes app, or gets forced into a task
it doesn't fit.

This Epic adds **Notes** as a first-class entity (distinct from tasks — no status,
priority, or lifecycle), a smart capture flow that infers whether you're capturing a
task or a thought, and an **Advisor panel** that synthesises notes + tasks into ranked,
cited "here's what to focus on and why" recommendations. Every saved note auto-syncs to
the brain knowledge base so the Advisor has the full picture.

The end state: a cross-project, agent-accessible knowledge layer that makes the system
genuinely smart about effort prioritisation — not just a task queue.

## Domain Model

- **Aggregate root**: `Note` — owns its own markdown file and SQLite row; no parent aggregate
- **Entities**: `NoteRecord` (has identity via `id`; mutable `body`, `tags`, `task_id`)
- **Value objects**: `NoteRef` (`{ id, snippet }` used in Advisor citations and TaskPanel)
- **Invariants**:
  - `body` is non-empty and ≤ 10,000 characters
  - `project` is always set (defaults to `GEN` if not specified at capture time)
  - `id` is immutable once created
  - A `Note` has no `status`, `priority`, or `transitions` — it is context, not work
- **New terms**:
  - **Note**: a captured thought, idea, or strategic context — not a unit of work; no lifecycle
  - **Advisor**: the LLM-driven panel that synthesises notes + tasks into ranked, cited effort recommendations
  - **Inference mode**: the default capture mode where the system classifies intent (Task or Note) before the user confirms

## Acceptance Criteria

### Layer 1 — Core entity & store
- [ ] `Note` markdown files stored at `{project-dir}/notes/{id}.md` with YAML frontmatter: `id`, `project`, `task_id`, `tags[]`, `created_at`, `updated_at`; `body` is the document body below the frontmatter
- [ ] SQLite `notes` table (columns: `id`, `project`, `task_id`, `tags`, `body_hash`, `created_at`, `updated_at`); atomic write via temp-file rename; WAL + pragma hardening matching tasks table; schema migration for existing DBs
- [ ] `note_create` MCP tool: accepts `{ body, project?, task_id?, tags? }`; validates body ≤ 10,000 chars and non-empty; defaults `project` to `GEN`; returns full `NoteRecord`
- [ ] `note_list` MCP tool: accepts `{ project?, task_id?, limit? }`; returns `NoteRecord[]` sorted by `created_at` desc
- [ ] `note_get` MCP tool: accepts `{ id }`; returns `NoteRecord` or throws `McpTasksError` with code `NOT_FOUND`
- [ ] `note_search` MCP tool: accepts `{ q, project? }`; full-text search over `body`; returns matching `NoteRecord[]`
- [ ] `note_link_task` MCP tool: accepts `{ note_id, task_id }`; validates both exist; sets `task_id` on note; updates markdown frontmatter + SQLite row atomically
- [ ] CLI commands: `agent-tasks notes list [--project <prefix>] [--limit N]` and `agent-tasks notes add <body>`

### Layer 2 — Capture UX
- [ ] `CaptureOverlay` renders an `Infer | Task | Note` mode selector (pill/tab); default is `Infer`
- [ ] `Ctrl+Shift+N` opens overlay forced to Note mode; `Ctrl+Shift+T` opens overlay forced to Task mode; existing shortcut opens in Infer mode
- [ ] In Infer mode: submitting text calls `POST /api/capture/infer`; response includes `intent: 'task' | 'note'` and `confidence: number (0–1)`; if confidence ≥ 0.70, route silently; if < 0.70, show nudge banner ("Looks like a [task/note] — keep or switch?") with one-click override
- [ ] Note capture (any mode) calls `note_create` and routes to active project or `GEN`; does NOT create a task entry

### Layer 3 — Dashboard UI
- [ ] **Notes view** (new nav tab): lists all notes cross-project, each card showing project badge, tag chips, `created_at`, and first 120 chars of body; filterable by project and tag; click opens full note in a side panel with edit textarea (plain text)
- [ ] **TaskPanel** shows a "Related notes" section when the task has linked notes; each entry shows note snippet and a link to open the full note; section hidden when no linked notes
- [ ] **Advisor panel** (new nav tab): on open fires `POST /api/advisor/query`; displays max 5 ranked recommendations; each shows: rank, action text, reasoning (1–2 sentences), and cited source links (note or task IDs that open on click); project filter pill narrows scope; manual refresh button; auto-reruns within 2 seconds of any note save; shows "Advisor unavailable" state gracefully when offline

### Layer 4 — Brain integration
- [ ] On every note save (create or update), fire `syncNoteToBrain(note)` async — payload: `{ id, body, project, tags, task_id }`; does not block the write response
- [ ] Brain sync retry: 3 attempts with exponential backoff (1s, 2s, 4s); on total failure, set `brain_sync_failed: true` on SQLite row and surface a dot indicator on the note card in Notes view; server-boot hook retries all rows where `brain_sync_failed = true`
- [ ] `BrainSearch` panel results include notes (type-labelled "Note") alongside existing task results

### Testing
- [ ] Unit tests for `NoteStore`: `create`, `list`, `get`, `search`, `linkTask` — 100% coverage on public methods
- [ ] Unit tests for inference classification: mock LLM responses at ≥0.70 (silent route), <0.70 (nudge), and timeout (fallback to nudge)
- [ ] Integration test: `note_create` → brain sync fires → note body appears in `note_search` results
- [ ] Visual QA screenshots: Notes view (list + side panel), Advisor panel (with recommendations), TaskPanel related-notes section, CaptureOverlay Infer mode with nudge banner

## Technical Notes

- Follow the exact atomic write pattern in `src/store/MarkdownStore.ts` — write to `{id}.md.tmp` then rename to `{id}.md`
- New SQLite table added in `src/store/SqliteIndex.ts`; apply same WAL/pragma hardening; add migration path for existing DBs (ALTER TABLE or CREATE TABLE IF NOT EXISTS)
- MCP tool files: `src/tools/note-create.ts`, `note-list.ts`, `note-get.ts`, `note-search.ts`, `note-link-task.ts` — follow exact handler signature, error types, and `McpTasksError` usage from existing `task-*.ts` files
- New endpoint `POST /api/capture/infer` in `src/server-ui.ts`: extend the braindump LLM prompt to return `{ intent: 'task' | 'note'; confidence: number; title?: string }` — reuse the existing claude CLI spawn pattern
- New endpoint `POST /api/advisor/query` in `src/server-ui.ts`: call claude CLI with a prompt assembled from recent notes (last 20) + active tasks (in_progress + todo, capped at 50); return `AdvisorResponse`
- New function `syncNoteToBrain(note: NoteRecord): Promise<void>` — POST to `BRAIN_MCP_URL` following the `fetchBrainSearch` HTTP pattern; call fire-and-forget from write path
- `notes/` directory auto-created on first `note_create` for a project (same pattern as `agent-tasks/` in `task-init.ts`)
- Note IDs: use project-scoped counter (`{PROJECT}-N-{num}`, e.g. `MCPAT-N-001`) to stay consistent with task ID conventions and simplify routing

**Interface contracts:**

`note_create` input/output:
```ts
// input
{ body: string; project?: string; task_id?: string; tags?: string[] }
// output
{ id: string; body: string; project: string; task_id: string | null; tags: string[]; created_at: string; updated_at: string }
```

`POST /api/capture/infer` input/output:
```ts
// input
{ text: string; context?: string }  // same shape as /api/capture/quick
// output
{ intent: 'task' | 'note'; confidence: number; title?: string }
```

`POST /api/advisor/query` input/output:
```ts
// input
{ project?: string }
// output
{
  recommendations: Array<{
    rank: number;
    action: string;
    reasoning: string;
    citations: Array<{ type: 'note' | 'task'; id: string; snippet: string }>;
  }>;
  generated_at: string;
}
```

## Failure Modes

- **Brain sync offline** → silent 3× exponential retry (1s/2s/4s); `brain_sync_failed = true` on SQLite row; dot indicator on note card; server-boot retries all failed rows — note itself is always persisted regardless
- **Infer LLM call times out or errors** → treat as confidence < 0.70, show nudge UI; user can still submit; no data lost
- **Advisor LLM call fails** → show "Advisor unavailable — try again" state with last successful result + staleness timestamp; never block the user
- **`notes/` directory missing** → auto-create on first write (same as `agent-tasks/` auto-init)
- **Concurrent note writes** → atomic rename prevents partial writes; SQLite WAL handles concurrent reads; last-write-wins acceptable (single-user context, no merge risk)
- **Note body exceeds 10,000 chars** → reject at MCP tool layer with `BODY_TOO_LONG` error before any file I/O

## Out of Scope

- Notes-to-outreach automation pipeline (separate feature, builds on this Epic)
- Rich text or markdown editor UI (plain textarea only for now)
- Note versioning or edit history
- Note deletion (add in a follow-up)
- Note sharing, export, or file attachments
- Bi-directional brain sync (notes → brain only; brain does not write back to notes)
- Advisor proactive push notifications or scheduled digests
- Multi-user / collaborative notes

## Dependencies

- Brain MCP bridge running at `BRAIN_MCP_URL` (graceful offline degradation built in)
- `CaptureOverlay` at `src/ui/src/components/CaptureOverlay.tsx`
- Braindump inference at `src/server-ui.ts` (~line 2320) — extend, don't replace
- `fetchBrainSearch` HTTP helper in `src/server-ui.ts` — reuse for brain sync

## Recommended Build Phases

Break into 4 sequential PRs, each shippable independently:

1. **Phase 1 — Core entity + MCP tools** (L): `NoteStore`, SQLite table, 5 MCP tools, CLI commands, unit tests
2. **Phase 2 — Capture UX** (M): `/api/capture/infer` endpoint, `CaptureOverlay` Infer mode, shortcuts
3. **Phase 3 — Dashboard UI** (L): Notes view, TaskPanel related-notes section, Note side panel
4. **Phase 4 — Advisor + brain sync** (L): `syncNoteToBrain`, `POST /api/advisor/query`, Advisor panel, BrainSearch integration

## Effort Estimate

**XL / Epic**

Rationale: 4 distinct layers (store + MCP, capture UX, 3 UI surfaces, brain integration), new entity type with full store implementation, 2 new LLM-driven endpoints, and 20+ acceptance criteria. Recommended to execute as 4 sequential L-sized PRs (~1–2 days each). Total estimated effort: 1–2 weeks.
