# P5-10 — ID-collision integrity: robust allocation, write guard, reconciler warning + one-time re-ID

**Type:** Bug (data integrity)
**Phase:** Phase 5 — Close the daily-use gaps + harden the gate
**Epic:** MCPAT-050 (Life OS — Phase 5)
**Task:** MCPAT-060
**Size:** M
**Depends on:** P5-09 (merged). Independent of P5-04…08.
**Owners:** data-specialist (allocation/guard/reconciler) · (migration) builder

> Surfaced while triaging "duplicates" in the Today view. Diagnosis confirmed two distinct issues:
> generic auto-captured titles make distinct tasks look alike (cosmetic, out of scope), and a real
> **ID-collision bug** where two different tasks share one `(id, project)`. This spec fixes the
> allocation bug, adds a write guard + reconciler warning, and repairs the existing collisions by
> re-IDing the masked task (keep both — agreed).

---

## Why

`SqliteIndex.nextId(prefix, tasksDir?)` (`src/store/sqlite-index.ts:715`) only scans disk for the true
max ID **when `tasksDir` is passed**; otherwise it returns a stored `next_id` watermark that, after an
index rebuild or for a freshly-seeded `projects` row, can be **stale and low** → new tasks reuse IDs
already on disk. The tasks table is `PRIMARY KEY (id, project)` (`sqlite-index.ts:176`), so on reconcile
two same-ID files **collapse to one row, last-write-wins** — silently masking one of two real tasks and
letting edits hit the wrong file. The Reconciler emits **no warning**, and there is **no `(id, project)`
uniqueness write guard** (the existing MarkdownStore guard at `markdown-store.ts:238` is per-*file*).

**Evidence:** 27 collisions found in the live stores (COND ×25, ACR ×2), e.g. `COND-001` =
"Batch A Multi Provider Plan" (slug file, in_progress) **and** `COND-001.md` = "Phase 5 — Smart Compact
Surfacing" (bare file, todo, empty body) — two different real tasks.

---

## Scope

**In scope**
1. **Authoritative allocation.** `nextId` returns `max(stored watermark, index MAX(numeric id) for the
   project, on-disk max when tasksDir is available) + 1` — never an already-used number, regardless of
   whether `tasksDir` is passed.
2. **Write guard.** Creating a task whose `(id, project)` already exists (in the index or on disk as a
   *different* task) is refused with a clear error — a backstop for any path that bypasses `nextId`.
3. **Reconciler collision warning.** When two markdown files reconcile to the same `(id, project)`, the
   Reconciler logs a structured warning (file paths + id) instead of silently last-write-wins; a summary
   is surfaced by `rebuild-index`.
4. **One-time re-ID migration.** A CLI command (dry-run by default) that finds every `(id, project)`
   collision, keeps the canonical file (the richer/older slug task), and re-IDs the other task to a fresh
   unique ID (rewrite frontmatter `id` + rename file), then rebuilds the index. Prints a full report
   before `--apply`.

**Out of scope** (agreed): capture-time content dedup (look-alike suppression); improving generic
auto-captured titles; renaming the 58 non-colliding bare `<id>.md` files (harmless).

---

## Acceptance Criteria

1. **Allocation never reuses an ID.** `nextId` called **without** `tasksDir`, against a project whose
   index already contains `PREFIX-011`, returns ≥ 12 (not a stale-watermark low number). Unit test:
   seed index with high IDs + a low stored watermark → `nextId` returns max+1.
2. **Allocation accounts for index + disk + watermark.** With IDs present on disk but a fresh/empty
   `projects` row, `nextId` still returns disk-max+1.
3. **Write guard rejects `(id, project)` collisions.** Writing a *new* task whose `(id, project)` already
   exists as a different task throws/returns a clear `ID_CONFLICT`-style error and does **not** overwrite
   the existing task. (Re-saving the *same* task is still allowed — idempotent update.)
4. **Reconciler warns on collisions.** Reconciling a dir with two different-content files of the same
   `(id, project)` emits a warning naming both files + the id; `rebuild-index` reports the count.
5. **Migration repairs collisions, loses nothing.** The dry-run lists all collisions with the planned
   new IDs; `--apply` re-IDs the non-canonical task (new unique id, file renamed, frontmatter updated),
   leaving both tasks present and uniquely addressable. Re-running the migration finds 0 collisions.
6. **Gates pass.** `npm run type-check` (`tsc -b`) + full `npm test` + `npm run build`.

---

## Build steps

1. **`nextId` robustness (`sqlite-index.ts:715`).** Add an index-MAX lookup (parse the numeric suffix of
   `id` for rows where `project = prefix`) and fold it into the watermark calc alongside the existing
   disk scan; persist `max(...)` back to `projects.next_id`. **Test:** AC1, AC2.
2. **`(id, project)` write guard.** In the create path (`task-store.ts:createTask` and/or
   `MarkdownStore.write`), before writing a *new* task assert no different task already holds
   `(id, project)` (check the index; on disk the per-file guard already exists). Throw
   `McpTasksError('ID_CONFLICT', …)`. **Test:** AC3.
3. **Reconciler warning (`reconciler.ts`).** Track ids seen per project during a reconcile pass; on a
   second different-content file for the same `(id, project)`, push a structured warning; return/aggregate
   them so `rebuild-index` can print a summary. **Test:** AC4.
4. **Re-ID migration CLI.** Add `agent-tasks fix-id-collisions [--apply]` (dry-run default). For each
   collision: pick canonical (slug file / longer body / older `created`), allocate a fresh id via the
   fixed `nextId`, rewrite the non-canonical file's frontmatter `id` + rename file to `<newid>.md`,
   record old→new. Rebuild index at the end. Print a report table. **Test:** AC5 on a temp fixture store.
5. **Run the migration on the live stores** after the code ships green: dry-run → review the 27-row
   report with the user → `--apply` → `rebuild-index` → verify 0 collisions remain.

---

## Tests

- **Unit:** `nextId` index/disk/watermark max (AC1, AC2); write guard rejects `(id,project)` collision
  but allows idempotent re-save (AC3).
- **Integration:** Reconciler warning on colliding files (AC4); migration on a staged fixture with a
  planted collision → both tasks survive with unique ids, re-run finds none (AC5).
- **Gate:** `npm run type-check` (`tsc -b`) + full `npx vitest run` before PR.

---

## Failure modes

- **Re-IDing the wrong file.** Canonical selection must be deterministic (prefer the slug/older/richer
  file) so the stable task keeps its id and only the masked one moves. Document the rule.
- **Dangling references.** If the re-IDed task is referenced (subtask parent, blocked_by, git refs), the
  reference must be updated too — scan and rewrite, or report unresolved refs (mirror P5-02's
  `migrateTaskId` philosophy). For the live data, report any cross-references before applying.
- **Migration not idempotent.** Re-running must be a no-op (0 collisions) — guard on that (AC5).
