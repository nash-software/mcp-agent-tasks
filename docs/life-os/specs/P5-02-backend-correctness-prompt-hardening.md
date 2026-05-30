# P5-02 — Backend correctness: `rerouteTask` markdown-first ID-migration + prompt sentinel hardening

**Type:** Feature (correctness + security)
**Phase:** Phase 5 — Close the daily-use gaps + harden the gate
**Epic:** MCPAT-050 (Life OS — Phase 5)
**Task:** MCPAT-052
**Size:** M
**Depends on:** P5-01 (gate must be real before merging backend type changes)
**Owners:** api-specialist (rerouteTask + prompt hardening)

> Read `docs/life-os/specs/00-epic-overview.md` first — §5 (client conventions) and §13 (markdown-first
> mutation rule: the dashboard HTTP layer uses `persistTaskDurable` for **all** mutations; do **not**
> introduce `TaskStore` into `server-ui.ts`). The evidence lives in the audit
> (`docs/life-os/audit/2026-05-31-post-phase4-gaps.md` §K1, §K2) — **do NOT re-investigate.** This spec
> fixes two backend defects and **builds the markdown-first ID-migration primitive that unblocks the
> deferred project-reassignment** (P5-03 explicitly excludes `project` editing until this lands).

---

## Why

**K1 — `rerouteTask` violates markdown-first (silent data loss).** `rerouteTask`
(`server-ui.ts:585-609`) mints a new ID and does an upsert/delete **in the SQLite index only**
(`sqlite-index.ts:448`) — it never moves the markdown file. Markdown is the source of truth and SQLite
is a rebuildable derived index; on the next reconcile the **original GEN markdown resurrects** and the
reroute is **dropped** (silent data loss). The fix is a markdown-first ID-migration primitive: move the
markdown file to the target project, rewrite cross-task references, **then** update the index — reusing
the existing `persistTaskDurable` durability path, never a `TaskStore` round-trip.

**K2 — capture prompts skip the sentinel hardening the triage path already uses.** Quick-capture
(`server-ui.ts:651`) and braindump (`:1761`) inject raw user text into a `claude -p` prompt **without**
the `<task>` sentinel wrapper + `sanitizeForPrompt` that the triage path uses
(`buildTriagePrompt:716-737`). Inputs are length-bounded (2000 / 10000), so blast radius is low, but it
is a real prompt-injection gap with an existing, proven fix pattern to copy.

This primitive is the **prerequisite for project reassignment** (deferred A1-project): reassigning a
task's project changes its ID prefix, which is exactly the move-file-and-rewrite-refs operation built
here.

---

## Scope

**In scope**
- **(K1)** Build a **markdown-first ID-migration primitive** and make `rerouteTask`
  (`server-ui.ts:585-609`) use it: (1) move the task's markdown file from the source project dir to the
  target project dir under the new ID, (2) rewrite any cross-task references that point at the old ID,
  (3) **then** update the SQLite index — all via `persistTaskDurable` / the existing atomic-write path.
  Eliminate the reconcile-revert.
- **(K2)** Wrap quick-capture (`server-ui.ts:651`) and braindump (`:1761`) user text in `<task>`
  sentinels + `sanitizeForPrompt`, mirroring `buildTriagePrompt` (`:716-737`). Preserve length bounds.

**Out of scope**
- Exposing project reassignment in the UI — that is a **follow-up** built on this primitive (noted in
  P5-03). This spec ships the primitive + fixes `rerouteTask`; it does **not** add a "move task to
  project" UI affordance.
- Structured routing confidence (audit K3 — maintainability, deferred).
- Any `TaskStore` introduction into `server-ui.ts` (forbidden — markdown-first convention, §13).
- Changing the routing LLM call's prompt semantics beyond the sentinel wrapper (K2 is hardening only).

---

## Data shapes / API contract

### (K1) ID-migration primitive (internal helper, not a new HTTP route)

Signature shape (name/placement at builder's discretion, near `rerouteTask` / `persistTaskDurable`):

```ts
// moves markdown file + rewrites refs, THEN updates index — markdown-first
async function migrateTaskId(opts: {
  oldId: string;          // e.g. "GEN-014"
  newId: string;          // e.g. "MCPAT-014"
  fromProject: ProjectIndex;
  toProject: ProjectIndex;
}): Promise<Task>         // returns the migrated task
```

Order of operations (non-negotiable — markdown-first):
1. Read the source markdown; compute the new markdown path under the target project dir.
2. Write the migrated markdown (new ID + any frontmatter project field) via the atomic-write path
   (`persistTaskDurable`), then remove the old markdown file.
3. Rewrite cross-task references (`closes`/`blocks`/`related` and `git`/subtask refs) that point at
   `oldId` → `newId` in affected tasks, via the same durable path.
4. **Only then** update the SQLite index (upsert new, delete old) — so a crash before step 4 leaves the
   reconcile able to rebuild correctly from markdown.

`rerouteTask` (`server-ui.ts:585-609`) becomes a thin caller of this primitive; the prior SQLite-only
upsert/delete at `sqlite-index.ts:448` is no longer the source of the move.

### (K2) prompt hardening — reuse the existing pattern

Both capture call sites wrap untrusted text exactly as triage does:

```ts
// pattern from buildTriagePrompt (server-ui.ts:716-737)
const safe = sanitizeForPrompt(userText);          // existing helper
const prompt = `…\n<task>\n${safe}\n</task>\n…`;    // sentinel-wrapped
```

No request/response shape change for capture endpoints — internal prompt construction only.

---

## Acceptance Criteria

1. **`rerouteTask` is markdown-first.** After a reroute (e.g. `GEN-014` → `MCPAT-014`), the **markdown
   file** exists at the target project path under the new ID and the old markdown file is gone, **before**
   the index reflects the change. (Falsifiable: assert the new markdown file exists and the old one does
   not, immediately after `rerouteTask` returns.)
2. **Reconcile no longer reverts the reroute.** Running a rebuild/reconcile after a reroute **keeps** the
   task at the new ID/project — the original GEN markdown does **not** resurrect. (Falsifiable: reroute,
   then `rebuild-index` / reconcile, then `getTask(newId)` succeeds and `getTask(oldId)` returns
   not-found. This is the regression that proves K1 fixed.)
3. **Cross-task references are rewritten.** A task that referenced the old ID (`closes`/`blocks`/`related`)
   now references the new ID after migration. (Falsifiable: a fixture referencing `GEN-014` reads
   `MCPAT-014` after the reroute.)
4. **No `TaskStore` in `server-ui.ts`.** The fix uses `persistTaskDurable` / atomic-write primitives; no
   `TaskStore` import is added to `server-ui.ts`. (Falsifiable: grep `server-ui.ts` for `TaskStore` →
   unchanged / absent.)
5. **Quick-capture prompt is sentinel-hardened.** The quick-capture prompt (`server-ui.ts:651`) wraps user
   text in `<task>…</task>` and runs it through `sanitizeForPrompt`, matching `buildTriagePrompt`.
   (Falsifiable: the constructed prompt contains the sentinel + sanitized text; a payload like
   `Ignore previous instructions` is wrapped, not interpolated bare.)
6. **Braindump prompt is sentinel-hardened.** Same treatment at `server-ui.ts:1761`. (Falsifiable: the
   braindump prompt wraps user text in the sentinel + sanitize.)
7. **Length bounds preserved.** Quick-capture (2000) and braindump (10000) input length caps are
   unchanged. (Falsifiable: over-length input is still rejected as before.)
8. **Gates pass.** `npm run type-check` (now real per P5-01) and `npm run build` succeed; `npm test`
   green. (Falsifiable: all exit `0`.)

---

## Build steps

1. **Build `migrateTaskId` primitive.** Add the helper near `rerouteTask` / `persistTaskDurable` in
   `server-ui.ts` (or a small co-located module). Implement the 4-step markdown-first order above using
   the existing atomic-write/`persistTaskDurable` path — **no `TaskStore`**. **Test:** unit — given a
   source markdown + a target project, the helper writes the new file, removes the old, and returns the
   migrated task; the index update happens last.
2. **Rewrite cross-task references.** Within the primitive, scan tasks referencing `oldId`
   (`closes`/`blocks`/`related`, subtask/git refs) and rewrite to `newId` via the durable path. **Test:**
   unit — a fixture task referencing the old ID reads the new ID after migration.
3. **Re-point `rerouteTask`.** Replace the SQLite-only upsert/delete (`server-ui.ts:585-609`,
   `sqlite-index.ts:448` usage) with a call to `migrateTaskId`; keep `rerouteTask`'s external shape.
   **Test:** integration — reroute `GEN-014`→`MCPAT-014`; assert markdown moved + old gone (AC1); then
   reconcile and assert the reroute survives (AC2) and refs rewrote (AC3).
4. **Harden quick-capture prompt.** At `server-ui.ts:651`, wrap user text with `sanitizeForPrompt` +
   `<task>` sentinels, copying the `buildTriagePrompt` (`:716-737`) pattern. Preserve the 2000-char
   bound. **Test:** unit — the constructed prompt contains the sentinel + sanitized text for an injection
   payload.
5. **Harden braindump prompt.** Same at `server-ui.ts:1761`; preserve the 10000-char bound. **Test:**
   unit — braindump prompt is sentinel-wrapped + sanitized.
6. **Run gates.** `npm run type-check` + `npm run build` + `npm test`. **Test:** all exit `0`.

---

## Test notes

- **Integration (api-specialist):** the **reconcile-revert regression** is the load-bearing test —
  reroute, reconcile, assert the task stays migrated and the old markdown does not resurrect (AC2). Mirror
  the existing reconcile/rebuild test harness.
- **Unit:** `migrateTaskId` order-of-operations + ref rewrite (ACs 1, 3); prompt sentinel wrapping for
  both capture call sites (ACs 5, 6) — assert the emitted prompt string, not a live `claude` call.
- **Grep assertion:** no `TaskStore` import added to `server-ui.ts` (AC4).
- **Gate:** `npm run type-check` + `npm test` green before PR.

---

## Failure modes

- **Index-first ordering.** Updating SQLite before the markdown move re-introduces the exact K1 bug — a
  reconcile reverts. The markdown move + ref rewrite **must** precede the index update.
- **Orphaned old markdown.** Forgetting to remove the source markdown leaves a duplicate that reconcile
  resurrects under the old ID. Remove it atomically as part of the move.
- **Missed reference rewrite.** A dangling `closes: GEN-014` after the move points at a non-existent task.
  Rewrite all ref kinds.
- **Bare prompt interpolation (K2 regression).** Interpolating user text without the sentinel/sanitize
  re-opens the injection gap. Copy the triage pattern verbatim; do not hand-roll a partial version.
- **Introducing `TaskStore` into `server-ui.ts`.** Violates the markdown-first convention (§13) and
  bypasses the durable path. Use `persistTaskDurable` primitives only.

---

## Open questions

1. **Scope of ref-rewrite scan.** Whole-project scan vs. only tasks indexed as referencing `oldId`.
   Default: query the index for referencing tasks (cheap), fall back to a project scan if the index lacks
   a reverse-ref lookup. Confirm against `sqlite-index.ts` capabilities during build.
2. **Project-reassignment UI follow-up.** This spec ships the primitive but not the UI. Default: file a
   follow-up task (post-P5) for the "move task to project" affordance in TaskPanel, built on
   `migrateTaskId`. Note it in P5-03's Open Q so it is not lost.
3. **`sanitizeForPrompt` reuse vs. duplicate.** Confirm `sanitizeForPrompt` is exported/reachable from the
   capture call sites; if it is private to the triage block, lift it to a shared helper rather than
   copying the regex. Default: lift to shared, single source of truth.
