# P2-04 — Hermes backend (`agent_status`, sign-off, skills, agent log)

**Type:** Feature
**Phase:** Phase 2 — Additive
**Epic:** MCPAT-022 (Life OS — UI Reskin + Agent Layer)
**Size:** L
**Depends on:** none (can build in parallel with Phase 1)
**Owners:** data-specialist (task field + store) · api-specialist (endpoints + file stores)

> Read `docs/life-os/specs/00-epic-overview.md` first — §2 (missing endpoints), §4 (data shapes,
> `agent_status` field), §7.4 from `design_handoff_life_os/README.md`. This is the **backend/data**
> spec for the Hermes agent layer. The Hermes **UI** is P2-05; the flywheel UI is P2-06. This spec
> ships **only** the persistent data + HTTP surface they consume.

---

## Description (why the agent layer needs persistent state)

The Hermes agent layer (P2-05/P2-06) is built on a **sign-off gate**: the agent only ever touches
tasks the user has explicitly handed it. That handoff cannot be client-only state — it must survive a
page reload, an index rebuild, and be queryable by the server (and, later, by an out-of-process agent
runner). Three pieces of state therefore need a real home on the backend:

1. **`agent_status` on the task** — the sign-off marker. A task with no `agent_status` is invisible to
   Hermes. `'scheduled'` means "the user signed it off; Hermes may triage and act on it." This is a
   first-class task field, so it must round-trip through markdown ↔ SQLite and survive `rebuild-index`
   exactly like `scheduled_for` and `area` do today.

2. **A Skills library** — reusable automations promoted from tasks. Skills are **app-level, not
   per-project tasks**: a skill like "SEO Audit Suite" matches tasks across every project. They do not
   belong in the per-project markdown task store. They get a dedicated JSON file store, mirroring the
   `artifacts-opened.json` pattern already in `server-ui.ts`.

3. **An agent activity log** — append-only record of what Hermes has done (runs, research, promotions)
   with per-entry time saved. This is the visible payoff of the flywheel. Append-only JSONL, mirroring
   the `artifacts.jsonl` pattern.

The optional `triage`/`research` endpoints are thin server stubs; the epic decision (overview §11) is
that **triage stays a client-side heuristic in P2-05** (`lib/triage.ts`). They are documented here as
OPTIONAL so a future LLM upgrade has a defined contract, but they are **not required** for P2-05/P2-06
to function.

---

## Domain Model

### `agent_status` lifecycle

`agent_status?: 'scheduled' | 'running' | 'done'` — optional. Absence = "not signed off to Hermes".

```
(absent)  ──POST /signoff──▶  scheduled  ──(agent picks it up; P2-06)──▶  running  ──▶  done
   ▲                              │
   └────────DELETE /signoff───────┘   (un-sign-off: only allowed while 'scheduled')
```

- **`scheduled`** — set by `POST /api/tasks/:id/signoff`. The only transition this spec performs.
- **`running` / `done`** — written later by the agent runner / ACR integration (P2-06). This spec
  defines the field and persistence but does **not** drive these transitions server-side.
- **Independent of `status`.** `agent_status` is orthogonal to the task lifecycle (`todo`/`in_progress`
  /…). A `todo` task can be `agent_status: 'scheduled'`. Do not couple them.
- **The sign-off invariant:** *Hermes only ever acts on tasks where `agent_status` is set.* The backend
  enforces persistence of the marker; the agent layer (P2-05/06) enforces the "don't touch un-signed"
  rule. This spec must make the marker durable so that rule is enforceable.

### `block_reason`

`reference/data.js` and overview §4 show `block_reason?: string` (shown when `status === 'blocked'`).
**Check `src/types/task.ts` first** — at time of writing it is **absent** from `TaskFrontmatter`. Add
it alongside `agent_status` through the same 5 files (it is a plain optional string column — no enum,
no migration constraint). If a later spec already added it, skip; do not duplicate.

### Skill aggregate (app-level)

```ts
type Engine = 'hermes' | 'n8n' | 'acr';
interface Skill {
  id: string;            // "sk-<slug>" — server-generated on promote
  name: string;          // "SEO Audit Suite"
  project: string;       // owning project prefix, or "—" for cross-project
  engine: Engine;        // who runs it
  desc: string;          // one-line description
  match: string[];       // lowercase substrings the triage classifier matches against a task
  runs: number;          // lifetime run count; starts at 0 on promote
  minutesSaved: number;  // lifetime minutes saved; starts at 0
  lastRun: string;       // human/ISO timestamp, "" until first run
  origin: string;        // "promoted from <TASK-ID>, <date>" provenance string
}
```

- **Identity:** `id`. Stored as a JSON array (whole-file rewrite on every mutation, atomic temp-rename).
- **Promotion** is the only write this spec implements: a Proposal (from P2-05/06) becomes a Skill with
  `runs: 0`, `minutesSaved: 0`, `lastRun: ""`. `runs`/`minutesSaved`/`lastRun` increments are P2-06.

### AgentLog (append-only)

```ts
interface AgentLog {
  id: string;            // "al-<timestamp>-<rand>" — server-generated
  kind: 'run' | 'research' | 'promote';
  title: string;         // "Ran Briefing Digest for Herald"
  project: string;       // prefix or "—"
  savedMin: number;      // minutes saved by this action (0 for research/promote)
  at: string;            // ISO-8601 timestamp
  skill?: string;        // skill name, when kind === 'run'
}
```

- **Append-only JSONL.** One JSON object per line. `GET /api/agent/log` reads, parses, and returns
  newest-first. Writing log entries is done by P2-06 actions; this spec ships the **read** endpoint and
  the append helper. (The endpoint is required; an entry-writing endpoint is not — P2-06 appends via the
  helper from within `signoff`/`skills`/future action handlers as needed.)

---

## Acceptance Criteria

1. **`agent_status` field added across all 5 store layers** (`types/task.ts`, `types/tools.ts`,
   `sqlite-index.ts` column + migration, `markdown-store.ts` frontmatter, `schema/task.schema.json`)
   with the union `'scheduled' | 'running' | 'done'`. `npm run type-check` passes (strict, no `any`).
2. **`agent_status` round-trips markdown ↔ SQLite:** a task written with `agent_status: 'scheduled'`
   reads back identical from both the markdown file and a fresh `SqliteIndex.getTask()`; a task with no
   `agent_status` reads back with the field absent (not `null`, not `''`).
3. **`agent_status` survives `rebuild-index`:** delete the SQLite DB, run `rebuild-index`, and the
   reconciled task still reports `agent_status: 'scheduled'` from the rebuilt index.
4. **`POST /api/tasks/:id/signoff`** sets `agent_status: 'scheduled'`, bumps `updated`/`last_activity`,
   upserts (SQLite **and** markdown frontmatter write-through, so the field survives `rebuild-index`),
   and returns the full updated task (200). On a nonexistent ID returns 404 `TASK_NOT_FOUND`.
   **`DELETE /api/tasks/:id/signoff`** clears `agent_status` (field removed) and returns the task (200);
   404 on nonexistent ID.
   **Lifecycle guard:** both POST and DELETE return **409 `INVALID_TRANSITION`** when the task is
   already `running` or `done` — sign-off and un-sign-off are only valid while absent/`scheduled`
   (un-sign-off only while `scheduled`). So the contract is **200 | 404 | 409**.
5. **`GET /api/skills`** returns the skills array (`[]` when the store file is missing — never an error).
   **`POST /api/skills`** validates the proposal body, creates a `Skill` (id generated, `runs: 0`),
   appends it atomically, and returns the created skill (201). Rejects missing `name`/`engine` with 400.
6. **`GET /api/agent/log`** returns `AgentLog[]` newest-first (`[]` when the log file is missing — never
   an error). Malformed lines are skipped, not fatal.
7. **Skill write is atomic and concurrent-safe:** two near-simultaneous `POST /api/skills` calls both
   land (no lost write, no truncated file) via temp-file write + `renameSync`.
8. **Schema validation passes:** `schema/task.schema.json` accepts `agent_status` ∈ the enum (+ `null`
   tolerated like other optionals) and `block_reason` as an optional string; a task with a bad
   `agent_status` value fails validation.

---

## Technical Notes

### A. The `agent_status` (+ `block_reason`) field — the EXACT 5 files

The project rule: adding a task field requires updating **all five** of these. Mirror exactly how
`scheduled_for` was threaded (verified file:line references below).

| # | File | Change |
|---|------|--------|
| 1 | `src/types/task.ts` | Add `export type AgentStatus = 'scheduled' \| 'running' \| 'done';` near the other unions (line ~4). In `TaskFrontmatter` (after `scheduled_for`, line ~93) add `agent_status?: AgentStatus;` and `block_reason?: string;` (if `block_reason` not already present). |
| 2 | `src/types/tools.ts` | No new field is needed on `TaskCreateInput` (tasks are not created signed-off). Add **nothing** here unless you choose to expose `agent_status` on `TaskUpdateInput` — recommended **not** to (the dedicated signoff endpoint owns this transition). Document the deliberate no-op in the PR. (Listed for completeness per the 5-file rule; the decision is "intentionally unchanged".) |
| 3 | `src/store/sqlite-index.ts` | (a) Add `agent_status: string \| null;` and `block_reason: string \| null;` to the `TaskRow` interface (near line 46, after `scheduled_for`). (b) In the migration block (near line 132) add `addColumnIfNotExists("ALTER TABLE tasks ADD COLUMN agent_status TEXT CHECK(agent_status IN ('scheduled','running','done') OR agent_status IS NULL)");` and `addColumnIfNotExists('ALTER TABLE tasks ADD COLUMN block_reason TEXT');`. (c) In `rowToTask` (near line 246) add `...(row.agent_status !== null ? { agent_status: row.agent_status as AgentStatus } : {})` and the same for `block_reason`. (d) In the upsert `INSERT` column list + `VALUES` (near lines 271–283) add `agent_status, block_reason` and `@agent_status, @block_reason`. (e) In the bound-params object (near line 318) add `agent_status: t.agent_status ?? null, block_reason: t.block_reason ?? null`. |
| 4 | `src/store/schema.sql` | After `scheduled_for TEXT` (line ~56) add `agent_status TEXT CHECK(agent_status IN ('scheduled','running','done') OR agent_status IS NULL)` and `block_reason TEXT`. Keep `schema.sql` and the migration in `sqlite-index.ts` in lockstep (fresh-DB path vs upgrade path). |
| 5 | `src/store/markdown-store.ts` | (a) In the frontmatter input type (near line 86, after `scheduled_for`) add `agent_status?: AgentStatus;` and `block_reason?: string;`. (b) In the frontmatter-build block (near line 153) add `...(fm.agent_status !== undefined ? { agent_status: fm.agent_status } : {})` and the same for `block_reason`. (c) In the cleanup block (near line 196) delete the key when undefined: `if (task.agent_status === undefined) delete frontmatterToWrite['agent_status'];` and same for `block_reason`. |
| + | `schema/task.schema.json` | (the 5th store-layer file) After `scheduled_for` (line ~69) add `"agent_status": { "type": ["string", "null"], "enum": ["scheduled", "running", "done", null] }` and `"block_reason": { "type": ["string", "null"] }`. |

> Note: `src/store/task-factory.ts` initialises `scheduled_for: null` at create time (line ~68). Do
> **not** initialise `agent_status` there — its absence is the correct default ("not signed off").
> Leaving it unset keeps new tasks invisible to Hermes by default, which is the intended invariant.

### B. `server-ui.ts` routing insertion points

`server-ui.ts` uses raw `http.createServer` with a flat `if (pathname === … && req.method === …)`
chain ending in a `sendError(res, 404, …)` fallthrough (line ~1133). Insert new route blocks **before**
that fallthrough. Mirror the existing handlers precisely.

**Sign-off** — insert immediately after the `schedule` block (ends line ~774). Mirror that handler
(regex match → resolve project index via `projectIndexes.find(p => taskId.startsWith(p.prefix + '-'))`
→ `pIdx.index.getTask` → 404 if absent → mutate → bump `updated`/`last_activity` → `upsertTask` → return
task). One regex serves both methods:

```ts
const signoffMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/signoff$/);
if (signoffMatch && (req.method === 'POST' || req.method === 'DELETE')) {
  const taskId = signoffMatch[1];
  const pIdx = projectIndexes.find(p => taskId.startsWith(p.prefix + '-'));
  const task = pIdx ? pIdx.index.getTask(taskId) : null;
  if (!task) { sendError(res, 404, 'TASK_NOT_FOUND'); return; }
  const now = new Date().toISOString();
  if (req.method === 'POST') task.agent_status = 'scheduled';
  else delete task.agent_status;           // DELETE clears it
  task.updated = now;
  task.last_activity = now;
  pIdx!.index.upsertTask(task);
  sendJson(res, 200, task);
  return;
}
```

POST takes no body (the action is unambiguous); if a future variant needs `{ to: 'running' }` it can
parse a body like the `schedule` handler does. Keep it bodyless for now.

**Skills + agent log** — insert near the `/api/artifacts` blocks (lines ~1099–1131), since they use the
same file-store helpers:

```ts
if (pathname === '/api/skills' && req.method === 'GET') {
  sendJson(res, 200, readSkills());                 // [] when file missing
  return;
}
if (pathname === '/api/skills' && req.method === 'POST') {
  const chunks: Buffer[] = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      const b = JSON.parse(Buffer.concat(chunks).toString()) as ProposalBody;
      if (!b.name || typeof b.name !== 'string' || !isEngine(b.engine)) {
        sendJson(res, 400, { error: 'MISSING_FIELDS', message: 'name and engine are required' });
        return;
      }
      const skill = createSkillFromProposal(b);     // assigns id, runs:0, minutesSaved:0, lastRun:""
      appendSkill(skill);                            // atomic whole-file rewrite
      sendJson(res, 201, skill);
    } catch (err) {
      sendJson(res, 400, { error: 'INVALID_BODY', message: err instanceof Error ? err.message : String(err) });
    }
  });
  return;
}
if (pathname === '/api/agent/log' && req.method === 'GET') {
  sendJson(res, 200, readAgentLog());               // [] when file missing, newest-first
  return;
}
```

### C. Skills + agent-log file-store design (mirror `artifacts-opened.json`)

Reuse the constants block at `server-ui.ts` line ~140 (`MCP_TASKS_DIR = join(homedir(), '.mcp-tasks')`).
Add two store files alongside the artifacts stores:

```ts
const SKILLS_JSON   = join(MCP_TASKS_DIR, 'skills.json');     // Skill[] — whole-file, atomic rewrite
const AGENT_LOG_JSONL = join(MCP_TASKS_DIR, 'agent-log.jsonl'); // AgentLog, one per line, append-only
```

Helpers (copy the shape of `loadOpenedStore`/`saveOpenedStore`/`readArtifacts`):

- `readSkills(): Skill[]` — `existsSync` guard → `readFileSync` → `JSON.parse` → return; any error → `[]`.
- `writeSkills(skills: Skill[]): void` — `mkdirSync(recursive)` → write to `SKILLS_JSON + '.tmp.' + process.pid`
  → `renameSync` over `SKILLS_JSON`. This is the **atomic, concurrent-safe** write (AC-7).
- `appendSkill(skill): void` — `const all = readSkills(); all.push(skill); writeSkills(all);` (read-modify-write;
  the temp-rename makes the final swap atomic).
- `createSkillFromProposal(b): Skill` — generate `id = 'sk-' + slug(b.name)` (dedupe-suffix on collision),
  set `runs: 0, minutesSaved: 0, lastRun: ''`, `project: b.project ?? '—'`, `match: b.match ?? []`,
  `desc: b.desc ?? ''`, `origin: b.origin ?? ('promoted from ' + (b.taskId ?? 'a task'))`.
- `readAgentLog(): AgentLog[]` — JSONL read, split on `\n`, filter blanks, `JSON.parse` each in a
  try/catch (skip bad lines), return **reversed (newest-first)**.
- `appendAgentLog(entry): void` — `mkdirSync(recursive)` → `appendFileSync(AGENT_LOG_JSONL, JSON.stringify(entry) + '\n')`.
  (Used by P2-06 actions; export it so later handlers can log runs/promotes. The signoff handler MAY
  append a `{kind:'promote'…}` entry on skill creation — optional, decide in P2-06.)

Add a small `isEngine(x): x is Engine` guard (`x === 'hermes' || x === 'n8n' || x === 'acr'`) — no `any`.

### D. Interface contracts (request / response JSON per endpoint)

| Endpoint | Method | Request body | Success | Errors |
|---|---|---|---|---|
| `/api/tasks/:id/signoff` | POST | *(none)* | 200 → full `Task` with `agent_status:'scheduled'` | 404 `TASK_NOT_FOUND` |
| `/api/tasks/:id/signoff` | DELETE | *(none)* | 200 → full `Task` with `agent_status` absent | 404 `TASK_NOT_FOUND` |
| `/api/skills` | GET | — | 200 → `Skill[]` (`[]` if none) | — (never errors) |
| `/api/skills` | POST | `ProposalBody` (below) | 201 → created `Skill` | 400 `MISSING_FIELDS` / `INVALID_BODY` |
| `/api/agent/log` | GET | — | 200 → `AgentLog[]` newest-first (`[]` if none) | — (never errors) |
| `/api/agent/triage` *(OPTIONAL)* | POST | `{ taskId, title, why?, tags? }` | 200 → `{ bucket, rationale, skillId?, acr?, engine? }` | 400 |
| `/api/agent/research` *(OPTIONAL)* | POST | `{ taskId, title, why? }` | 200 → `Proposal` | 400 |

`ProposalBody` (request to `POST /api/skills`, from a P2-05/06 Proposal):
```ts
interface ProposalBody {
  name: string;                 // required
  engine: 'hermes'|'n8n'|'acr'; // required
  desc?: string;
  match?: string[];
  project?: string;             // defaults "—"
  taskId?: string;              // originating task, for origin string
  origin?: string;              // overrides generated origin
}
```

`Proposal` (response shape of OPTIONAL `/api/agent/research`, per overview §4):
```ts
interface Proposal {
  id: string; taskId: string; project: string; skillName: string; taskTitle: string;
  summary: string; steps: string[]; savedPerRun: number; frequency: string; engine: Engine;
}
```

### E. REQUIRED vs OPTIONAL endpoints

| Required (build in this spec) | Optional (stub or defer) |
|---|---|
| `POST /api/tasks/:id/signoff` | `POST /api/agent/triage` |
| `DELETE /api/tasks/:id/signoff` | `POST /api/agent/research` |
| `GET /api/skills` | |
| `POST /api/skills` | |
| `GET /api/agent/log` | |

**Recommendation:** ship the 5 required endpoints. **Triage stays a client-side heuristic in P2-05**
(`lib/triage.ts` per overview §11). Implement `/api/agent/triage` and `/api/agent/research` only as
thin heuristic stubs *if* time allows — they must not block P2-05/06, which assume client-side triage.
If stubbed: `triage` returns `{ bucket: 'manual', rationale: 'heuristic stub' }` and `research` echoes a
minimal `Proposal` derived from the task title. Do **not** spawn a real LLM here.

---

## Failure Modes

- **Concurrent skill writes (lost update / truncated file).** Two `POST /api/skills` racing. Mitigation:
  every write goes through `writeSkills` = write-to-temp + `renameSync` (atomic on NTFS + POSIX), as the
  store layer does. A read-modify-write race can still drop one of two simultaneous appends in the
  pathological case; acceptable for a single-user localhost dashboard, but the file is never corrupted or
  truncated. Document this limitation. (Do not introduce a lockfile unless P2-06 needs multi-writer.)
- **Sign-off on a nonexistent task.** `getTask` returns null → `sendError(res, 404, 'TASK_NOT_FOUND')`,
  exactly like the `schedule` handler. No write attempted.
- **Sign-off on an ID with no matching project prefix.** `projectIndexes.find(...)` returns undefined →
  `task` is null → same 404 path.
- **Store file missing / unreadable.** `GET /api/skills` and `GET /api/agent/log` return `[]` (never 500).
  All read helpers wrap parse in try/catch and fall back to empty, like `readArtifacts`/`loadOpenedStore`.
- **Malformed JSONL line in agent-log.** `readAgentLog` skips unparseable lines (per-line try/catch).
- **Malformed `POST` body.** `JSON.parse` throws → 400 `INVALID_BODY`. Missing required fields → 400
  `MISSING_FIELDS`.
- **`DELETE /signoff` on a task that isn't signed off.** Idempotent no-op: `delete task.agent_status`
  on an already-absent field is harmless; still returns 200 with the task.

---

## Out of Scope

- The Hermes **UI / view** (`HermesView`, `AgentTaskCard`) — **P2-05**.
- The **automation flywheel** UI (`ProposalCard`, `SkillCard`) and ACR live integration — **P2-06**.
- **Real LLM triage/research.** Triage is a client-side heuristic (`lib/triage.ts`, P2-05). The
  `/api/agent/triage` + `/api/agent/research` endpoints are optional heuristic stubs at most.
- **Driving `agent_status` to `running`/`done`** — the field is defined and persisted here, but the
  transitions are owned by the agent runner / ACR integration (P2-06).
- **Skill run/minutesSaved increments** (P2-06) and a skill **edit/delete** endpoint (not needed yet).
- Replacing the task store, MCP tools, or git-hook layer (epic-wide out of scope, overview §10).

---

## Dependencies

- **None.** This spec is self-contained and can be built **in parallel with Phase 1** (overview §7,
  critical path). It touches `src/types/`, `src/store/`, `schema/`, and `src/server-ui.ts` only —
  no dependency on any reskinned UI surface.

---

## Testing

Mirror the existing test layout (`tests/unit/`, `tests/integration/`) and the patterns in the existing
`server-ui` and store tests.

**Unit — store / field round-trip (data-specialist):**
- `agent_status: 'scheduled'` written via `MarkdownStore` reads back identical from the markdown file.
- A task with no `agent_status` has the key **absent** from the written frontmatter (not `null`/`''`).
- `SqliteIndex.upsertTask` + `getTask` round-trips `agent_status` and `block_reason`.
- **`rebuild-index` survival:** seed a markdown task with `agent_status: 'scheduled'`, delete the DB,
  rebuild, assert the field is still `'scheduled'` from the rebuilt index (AC-3).
- `task.schema.json` validation: accepts valid `agent_status`; rejects `agent_status: 'bogus'` (AC-8).

**Integration — endpoints (api-specialist), mirroring existing `server-ui` tests (boot server on an
ephemeral port, `fetch` the routes):**
- `POST /signoff` → 200, task has `agent_status:'scheduled'`; re-`getTask` confirms persistence.
- `DELETE /signoff` → 200, `agent_status` absent; persistence confirmed.
- `POST /signoff` on unknown ID → 404 `TASK_NOT_FOUND`.
- `GET /api/skills` with no file → `[]`; after `POST /api/skills` → array contains the created skill with
  `runs:0`, generated `id`.
- `POST /api/skills` missing `name` or bad `engine` → 400.
- Two concurrent `POST /api/skills` → both present, file valid JSON (AC-7).
- `GET /api/agent/log` with no file → `[]`; after `appendAgentLog`, returns the entry newest-first; a
  hand-written malformed line is skipped, not fatal.

**Gate:** `npm run type-check` (strict, no `any`) + `npm test` green before PR.

---

## Open Questions

- **Triage/research: client vs server?** Default per overview §11: **client-side heuristic** in P2-05
  (`lib/triage.ts`); the two endpoints stay optional stubs. Revisit if/when an LLM triage upgrade is
  scoped — the response contracts in §D are the forward-compatible target.
- **Skill `id` collision strategy.** Slug + numeric suffix on collision (`sk-seo`, `sk-seo-2`)? Or reject
  duplicate names with 409? Default: suffix-on-collision (additive, never fails a promote). Confirm in P2-06.
- **Should signing off a task also append a `promote`/`signoff` agent-log entry?** Leaning no for plain
  sign-off (it's not an agent *action* yet); yes when a skill is promoted. Resolve when wiring P2-06.
- **Multi-writer hardening.** Single-user localhost makes the read-modify-write skill race acceptable.
  If P2-06 introduces an out-of-process agent runner that also writes skills/log, add a lockfile then.
