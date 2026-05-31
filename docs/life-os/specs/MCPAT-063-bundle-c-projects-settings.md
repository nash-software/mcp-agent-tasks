# MCPAT-063 — Bundle C: project `name` field + settings cog (projects CRUD)

**Status:** approved
**Type:** feature
**Branch:** `feat/MCPAT-063-bundle-c-projects-settings`
**Supersedes:** the Bundle-C sketch in `docs/life-os/BUNDLE-BC-HANDOFF.md §4`.

## Decisions (confirmed with user)
- **Folder picker:** a **sandboxed directory-browser endpoint** `GET /api/fs/list?path=` (click-to-navigate),
  NOT a plain path input. Path-traversal is the key risk → must sandbox to allowed roots (security gate).
- **Prefix:** **immutable**. `PATCH` edits `name` only. Prefix rename = re-ID every task (P5-02 `migrateTaskId`
  territory) → deferred, noted here.

---

## 1. Why
Projects can only be created by MCP tools (`task_register_project` / `task_init`) or by hand-editing
`~/.config/mcp-tasks/config.json`. There's no in-app way to see what projects exist, give them a friendly
name, or add a new one. Badges show only the prefix ("ACR"); the user wants "ACR — Agent Control Room".

## 2. Data shapes

```ts
// src/types/config.ts — ProjectConfig (config.ts:6-10) gains optional name
interface ProjectConfig { prefix: string; name?: string; path: string; storage: StorageMode }

// src/projects-list.ts — ProjectListEntry (projects-list.ts:11-14) gains name
interface ProjectListEntry { prefix: string; name?: string; path: string }
```
- `schema/config.schema.json` (projects items, ~:15-25): add `"name": { "type": "string", "maxLength": 80 }`
  to `properties` — NOT in `required` (back-compat: existing configs without `name` stay valid).
- `name` falls back to `prefix` at the render layer (don't materialise a default into config).

## 3. Backend — `src/server-ui.ts` (markdown-first; **no TaskStore** — handoff §5)

Routes added after the GET `/api/projects` handler (`server-ui.ts:1111-1118`). Route-matching mirrors the
existing style: `pathname` (string/regex) + `req.method`; body via the existing read+`JSON.parse`; errors via
`sendError(res, code, msg)`, success via `sendJson(res, code, data)`.

### 3.0 Reusable atomic config write — `src/config/loader.ts`
Add `export function writeConfig(config: GlobalConfig, configPath?: string): void` using **temp-file +
atomic rename** (mirror MarkdownStore's atomic write; satisfies critical-rules "atomic config write").
Resolve `configPath` from `MCP_TASKS_CONFIG` or `~/.config/mcp-tasks/config.json` (same as `loadConfig`).
Route the new POST/PATCH through it. (Optionally refactor `task-register-project.ts:67-73` to use it too —
keep that change minimal/secondary.)

### 3.1 `POST /api/projects` — register + init a project
Body `{ prefix, path, name?, storage? }`. Reuse `task_register_project` logic
(`src/tools/task-register-project.ts`: validate :33-51, uniqueness :55, push :61-65):
1. Validate `prefix` format (existing validator) + **uniqueness** vs `config.projects` → 409/400 on dup.
2. Validate `path` is an existing directory (server-side) → 400 if missing.
3. Validate `name` (optional, ≤80 chars) → 400 if too long.
4. Create `<path>/agent-tasks/` (or the configured `tasksDirName`) + init `SqliteIndex`.
5. `config.projects.push({ prefix, name, path, storage: storage ?? 'global' })`; persist via `writeConfig`.
6. **Push into the live `projectIndexes` array** (build a `ProjectIndex` — `{prefix,index,milestoneRepo,
   tasksDir}`, `server-ui.ts:549-554` — exactly as `openProjectIndexes` :556-584 constructs each one) so the
   project is queryable **without a server restart** (handoff §4 backend note).
7. Return the new `ProjectListEntry`.

### 3.2 `PATCH /api/projects/:prefix` — edit name (prefix immutable)
1. Find project by `:prefix` → 404 if absent.
2. Body `{ name? }` (reject `prefix` changes with a clear 400 — deferred). Validate `name` ≤80.
3. Update the config entry; persist via `writeConfig`; mirror onto the live config in memory.
4. Return the updated `ProjectListEntry`.

### 3.3 `GET /api/fs/list?path=` — **sandboxed** directory browser (SECURITY)
Returns subdirectories of `path` for the click-to-navigate picker.
- **Allowed roots:** the set of existing `config.projects` path **parents** + the user home dir. Resolve the
  requested `path` with `fs.realpathSync` and require it to be **inside** an allowed root (string-prefix on the
  resolved, separator-normalised path). Reject `..` traversal, non-absolute paths, symlink escapes → **403**.
- Read with `fs.readdirSync(path, { withFileTypes: true })`, return `{ path, dirs: string[] }` (directory
  names only, sorted; hidden dirs optional). 400 on unreadable, 404 on missing.
- No write, no file contents — listing only. This is the one new attack surface → **security-scanner gate**.

## 4. Client — `src/ui/src/api.ts` + `src/ui/src/types.ts`
- `types.ts`: ensure `ProjectListEntry` includes `name?: string` (mirror config).
- `api.ts`: `createProject(fields)` (POST), `updateProject(prefix, { name })` (PATCH), `listDir(path)` (GET
  `/api/fs/list`, queryKey `['fs-list', path]`, `staleTime: 0`). Mutations invalidate `['projects']`.

## 5. UI — settings cog → ProjectsModal + full-name badges
- **`src/ui/src/components/ProjectsModal.tsx`** (new) — mirror `NewTaskModal.tsx` (modal shell `w-[440px]`,
  `fieldClass` :82, useMutation + invalidate + error surface, return null when closed):
  - **List** existing projects (prefix · name · path · open-task count) with inline **edit-name** (PATCH).
  - **Add project** form: prefix + name + **folder via the directory browser** (`listDir`) + storage →
    POST. Surface validation/dup/bad-path/403 errors.
- **`src/ui/src/App.tsx`**: `projectsModalOpen` state + pass open/close to `Nav` and `ProjectsModal`.
- **`src/ui/src/components/Nav.tsx`**: add a **settings cog** button in the footer cluster (near `+ New task`
  / Search, ~:195-202). Render **"PREFIX — Name"** where a name exists: Nav favourites (~:136 prefix span;
  :127 title already uses `proj.name`) and the FilterBar project chips/popover. Keep the **compact prefix**
  on dense task rows.

## 6. Acceptance criteria
1. `/api/projects` returns `name` (falls back to `prefix` when unset); badges/filter show "PREFIX — Name".
2. `POST /api/projects` registers + inits a new project (dir + index + config entry); it appears in the list
   and filter **without a server restart** (pushed into live `projectIndexes`).
3. `PATCH /api/projects/:prefix` updates `name`, persisted atomically; attempting to change `prefix` → 400.
4. `GET /api/fs/list` returns subdirectories **only within allowed roots**; traversal / outside-root /
   symlink-escape → 403; missing → 404.
5. Settings cog opens the ProjectsModal: list + edit-name + add-project (with folder browser); invalid
   prefix / duplicate / bad path → visible error.
6. Config writes are **atomic** (temp-file rename); a malformed/interrupted write can't corrupt config.
7. Gates pass (§8), incl. **security-scanner** on the fs/list + config-write surfaces.

## 7. Tests
- **Unit (pure):** path-sandbox predicate (extract `isPathWithinRoots(path, roots)` → reject `..`, outside
  root, non-absolute; accept in-root) — fully testable without a server. `buildProjectsList` name passthrough.
- **Integration (live server, mirror `mutation-endpoints.test.ts`):** POST creates+lists a project (temp
  dirs); duplicate prefix → 4xx; bad path → 400; PATCH name persists (re-read); PATCH prefix → 400; fs/list
  returns in-root dirs and **403s** on `..`/outside-root; config file is valid JSON after writes (atomicity).
- **Source-inspection:** ProjectsModal structure (list + add form + folder browser + error surface), Nav cog
  button, "PREFIX — Name" rendering, api.ts new functions. (RTL unavailable — handoff §6.)
- Run the **full** `npx vitest run` before push.

## 8. Gates (handoff §2, §3)
`npm run type-check` (root + UI) → **full** `npx vitest run` → `npx tsup` + `npm --prefix src/ui run build`
→ **codex** (≤3 rounds) → **security-scanner** (fs/list traversal + atomic config write) → gated-CI merge on
the `gh pr checks` **status string**. Windows: kill `dist/server` node holders before `tsup`;
`git checkout .handbook/` before each commit; no `Co-Authored-By`.

## 9. Build order (phases, commit each)
1. **name field** — config.ts + config.schema.json + projects-list.ts + types.ts (+ unit: buildProjectsList).
2. **atomic `writeConfig`** in loader.ts (+ unit if practical).
3. **POST /api/projects** + live-index push (+ integration).
4. **PATCH /api/projects/:prefix** (+ integration).
5. **GET /api/fs/list** sandboxed + extracted `isPathWithinRoots` (+ unit + integration). ← security focus.
6. **client api.ts** (createProject/updateProject/listDir).
7. **ProjectsModal + Nav cog + App wiring** (+ source-inspection).
8. **full-name badges** (Nav + FilterBar) (+ source-inspection).

## 10. Out of scope / deferred
- **Prefix rename** (= re-ID every task; P5-02 migrate territory).
- Project **delete/archive** from the UI, storage-mode switching, area editing.
- A richer fs picker (drive roots on Windows, file preview) — listing-only for now.

## 11. Deviations resolved in codex round 1 + security review

- **F1 (HIGH, fixed):** `writeConfig` temp name now includes a monotonic per-write counter (PID + seq) so
  two writes in the same process can't collide on the temp path.
- **F2 (HIGH, fixed):** `POST /api/projects` now wraps index init in try/catch; on failure it rolls the
  config entry back (re-persist) and returns **500 `INDEX_INIT_FAILED`** (not a misleading 400), keeping
  durable and live state consistent.
- **F3 (MED, partially accepted + documented):** `GET /api/fs/list` **keeps returning full absolute paths**
  for `dirs` (deliberate — returning basenames forced fragile client-side path-joining, which caused a real
  double-join bug; full paths are the correct contract). Allowed roots **narrowed to `home + dirname(project.path)`**
  (dropped the redundant project paths — already reachable via their parent), satisfying the
  surface-narrowing intent. Spec §3.3/§5 updated to reflect full-path `dirs`.
- **F4 (MED, fixed):** invalid `storage` values are now rejected with 400 instead of silently coercing to
  `global`.
- **Security LOW (fixed):** `isPathWithinRoots` folds case on Windows (NTFS case-insensitive → no spurious
  403); `tasksDirName` from operator config is guarded against `..`/absolute before the `mkdirSync` join.
- **Security PASS:** the scanner confirmed `isPathWithinRoots` is sound (prefix look-alikes blocked, symlink
  escape defeated by realpath on both target and roots, non-absolute rejected); no file-content leak; POST
  path validated before mkdir; rollback correct.

## 12. Codex round 2 resolution

- **F1 (MED, security — DISMISSED, documented):** codex re-raised `GET /api/fs/list` returning absolute
  paths as "filesystem-structure exposure." Dismissed: (1) trust model is **localhost single-user** — the
  user is browsing their **own** filesystem in their **own** browser to pick a folder; absolute paths are
  not a secret to them. (2) The picker **requires** the absolute path of the selected folder to POST it as
  the new project's `path` — basenames + a cursor token would force client-side path reconstruction, the
  exact fragility that caused the FolderBrowser double-join bug (fixed in 16fc639). (3) The
  **security-scanner explicitly PASSED** this surface (sound sandbox, no file-content leak). Anchoring on the
  security authority + technical necessity over a repeated convenience-contract concern (handoff §7).
- **F2 (LOW, fixed):** `writeConfig` now removes the temp file (best-effort `unlinkSync`) on write/rename
  failure before rethrowing — no stale `.tmp-*` artifacts.
- **F3 (LOW, fixed):** FilterBar popover row no longer duplicates the prefix — `fpr-prefix` shows the prefix
  and `fpr-name` shows the **name only** (the single-span chip already renders the combined "PREFIX — Name").
