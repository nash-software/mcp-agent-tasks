# P5-03 — Task field editing: area / tags / type / milestone in PATCH + TaskPanel editors

**Type:** Feature
**Phase:** Phase 5 — Close the daily-use gaps + harden the gate
**Epic:** MCPAT-050 (Life OS — Phase 5)
**Task:** MCPAT-053
**Size:** M
**Depends on:** P5-01 (real gate). Soft: P5-02 (its ID-migration primitive is the prerequisite for the
**project** reassignment this spec explicitly defers).
**Owners:** api-specialist (PATCH whitelist + validators) · ui-specialist (TaskPanel editors)

> Read `docs/life-os/specs/00-epic-overview.md` first — §3 (tokens), §4 (`Area`/`Priority` unions,
> `tags`/`type`), §5 (optimistic mutations). Read **P4-01** (`P4-01-task-mutation-layer.md`) — this spec
> **extends the PATCH route and editable TaskPanel it built**; the bridge shape, error mapping, and
> editable-control conventions are established there. Evidence: audit §A1, §A4
> (`server-ui.ts:1483`, `TaskPanel.tsx:364-369,532-546`) — **do NOT re-investigate.**

---

## Why

P4-01 made title/why/priority/estimate editable via `PATCH /api/tasks/:id`, but the PATCH whitelist
(`VALID_PATCH_FIELDS`, `server-ui.ts:1483`) and the panel still leave **`area`, `tags`, `type`**
read-only (`TaskPanel.tsx:364-369,532-546`) and **milestone** editable only from the Roadmap, not the
task itself (audit §A1, §A4). Daily use needs all four editable in one place. The PATCH route already
exists and is markdown-first (`persistTaskDurable`); this spec **adds fields to the existing whitelist +
validators** and **adds the corresponding TaskPanel editors** — it does not build a new route.

**`project` is explicitly excluded.** The task ID prefix *is* the project; reassignment mints a new ID
and moves the markdown file — that is P5-02's `migrateTaskId` primitive, shipped as a separate "move
task" affordance later. This spec edits only the four in-place fields.

---

## Scope

**In scope**
- Add **`area`, `tags`, `type`** to `VALID_PATCH_FIELDS` (`server-ui.ts:1483`) + their validators
  (markdown-first via `persistTaskDurable`, like the existing PATCH fields). `milestone` is **already**
  PATCH-able (P4-01 / audit A4) — no new field, just a UI control.
- TaskPanel editors for: **area** (select over `Area` union), **tags** (chip add/remove), **type**
  (select over `TaskType`), **milestone** (select over `GET /api/milestones`, includes a "none" option).
- Optimistic update + rollback + visible error on each, per overview §5 (reuse P4-01's pattern).

**Out of scope**
- **`project` reassignment** — deferred; needs P5-02's `migrateTaskId` primitive. Keep `project`
  read-only in the panel; do **not** add it to `VALID_PATCH_FIELDS`.
- New-task creation / delete — **P5-04**.
- Status changes — those go through `/transition` (P4-01), never PATCH.
- Milestone CRUD (creating milestones) — only **assigning** a task to an existing milestone here.

---

## Data shapes / API contract

### `PATCH /api/tasks/:id` — extended whitelist

| Field | Type | Validation |
|---|---|---|
| `area` | `Area` | ∈ `'client'\|'personal'\|'outsource'\|'internal'` else `400 INVALID_FIELD` |
| `tags` | `string[]` | array of non-empty strings; cap count (e.g. ≤20) + per-tag length (e.g. ≤40); dedupe |
| `type` | `TaskType` | ∈ `'feature'\|'bug'\|'chore'\|'spike'\|'refactor'\|'spec'\|'plan'` else `400` |
| `milestone` | `string \| null` | existing P4-01 field; `null`/empty clears; non-null must match a known milestone id |

- `Area` / `TaskType` unions are canonical in `src/types/task.ts:2-4` — **import, do not redefine**.
- **`project` is rejected** if present in the PATCH body (`400 INVALID_FIELD`) — unchanged from P4-01.
- `status` remains rejected (use `/transition`) — unchanged.
- Errors returned as `{ error: <CODE> }` via `sendError` so the client surfaces them (P4-01 convention).

---

## Acceptance Criteria

1. **PATCH accepts `area`.** `PATCH { area: 'client' }` → `200` with the updated task; an invalid area
   (`{ area: 'banana' }`) → `400 INVALID_FIELD`. Persistence confirmed on re-read (markdown + index).
2. **PATCH accepts `tags`.** `PATCH { tags: ['x','y'] }` → `200`; the task reads those tags; empty/blank
   tags are rejected or stripped; over-cap input → `400`. Persistence confirmed.
3. **PATCH accepts `type`.** `PATCH { type: 'bug' }` → `200`; invalid type → `400 INVALID_FIELD`.
4. **PATCH still rejects `project` and `status`.** `PATCH { project: 'MCPAT' }` → `400`;
   `PATCH { status: 'done' }` → `400`. (Falsifiable: both rejected; `project` is **not** in
   `VALID_PATCH_FIELDS`.)
5. **TaskPanel area editor.** The panel renders an **area select** (was read-only at
   `TaskPanel.tsx:364-369`); changing it fires PATCH `{ area }` and the panel reflects the saved value.
6. **TaskPanel tags editor.** Tags render as **chips with add/remove** (was read-only at
   `TaskPanel.tsx:532-546`); adding/removing a chip fires PATCH `{ tags }`; the chip set updates
   optimistically and rolls back on error.
7. **TaskPanel type editor.** A **type select** fires PATCH `{ type }`.
8. **TaskPanel milestone editor (A4).** A **milestone select** (populated from `GET /api/milestones`,
   with a "none" option) fires PATCH `{ milestone }`; selecting "none" clears it. (Falsifiable: assigning
   a milestone from the panel updates the task without going to the Roadmap.)
9. **Errors surface + optimistic rollback.** A rejected PATCH (e.g. bad area) shows a visible
   toast/inline error and rolls back the optimistic edit (overview §5). No swallowed error.
10. **Gates pass.** `npm run type-check` (real, per P5-01 — `tsc -b` green) and `npm run build` succeed;
    `npm test` green.

---

## Build steps

1. **Extend PATCH whitelist + validators (`server-ui.ts:1483`).** Add `area`, `tags`, `type` to
   `VALID_PATCH_FIELDS` and add validators: area/type against the imported unions; tags array shape +
   count/length caps + dedupe. Keep the write markdown-first via `persistTaskDurable`. Keep `project`
   and `status` rejected. **Test:** integration — PATCH each field → 200 persisted; invalid enum → 400;
   `project`/`status` → 400.
2. **Area select in TaskPanel.** Replace the read-only area display (`TaskPanel.tsx:364-369`) with a
   select over `Area`; commit-on-change fires `updateTask({ area })`. Respect tokens (§3, area dot
   colours). **Test:** RTL — changing area fires PATCH with the new value.
3. **Tags chip editor in TaskPanel.** Replace read-only tags (`TaskPanel.tsx:532-546`) with chips +
   an add input + per-chip remove; each mutation fires `updateTask({ tags })` optimistically. **Test:**
   RTL — add a chip fires PATCH with the extended array; remove fires PATCH with the shrunk array.
4. **Type select in TaskPanel.** Add a `TaskType` select; commit fires `updateTask({ type })`. **Test:**
   RTL — changing type fires PATCH.
5. **Milestone select in TaskPanel (A4).** Add a select populated from the `['milestones']` query with a
   "none" option; commit fires `updateTask({ milestone })` (or `null` for none). **Test:** RTL —
   selecting a milestone fires PATCH `{ milestone }`; "none" fires `{ milestone: null }`.
6. **Error surfacing + rollback.** Ensure each editor uses the optimistic-mutation + `onError` rollback +
   toast pattern from P4-01/§5. **Test:** RTL — a rejected PATCH shows a visible error and reverts the
   field.

---

## Test notes

- **Integration (api-specialist):** PATCH matrix for `area`/`tags`/`type` (200/400) + persistence on
  re-read; `project`/`status` still rejected (AC4). Mirror P4-01's PATCH test harness.
- **Unit (UI, RTL):** each editor fires the right PATCH payload (ACs 5-8); error surfacing + rollback
  (AC9).
- **Gate:** `npm run type-check` (`tsc -b` green) + `npm test` before PR.

---

## Failure modes

- **Adding `project` to the whitelist.** WRONG — `project` is the ID prefix; editing it via PATCH would
  desync the ID from the file path. Reassignment is P5-02's `migrateTaskId` primitive, shipped as a
  separate affordance. Keep `project` rejected.
- **Unbounded tags.** No count/length cap lets a tag array bloat the markdown frontmatter. Enforce caps +
  dedupe (mirror the store's existing caps philosophy).
- **Status via PATCH.** Any `status` key must stay rejected — bypassing `/transition` skips the state
  machine.
- **Swallowed PATCH error.** A new `if (res.ok)` that drops the body re-introduces audit §0. All editors
  must surface + roll back.

---

## Open questions

1. **Project reassignment follow-up (carried from P5-02).** With P5-02's `migrateTaskId` primitive landed,
   a "move task to project" affordance in TaskPanel becomes buildable. Default: **file a follow-up** (not
   in P5-03); keep `project` read-only here. Confirm with user whether to schedule it in a P5 patch or a
   later phase.
2. **Tag input UX.** Comma/Enter to commit a chip vs. an explicit add button. Default: Enter-to-add +
   click-x-to-remove (prototype chip pattern); confirm against the existing chip styling in the panel.
3. **Milestone "none" representation.** PATCH `{ milestone: null }` vs `{ milestone: '' }`. Default:
   `null` (matches the P4-01 field semantics); confirm the validator accepts `null` to clear.
