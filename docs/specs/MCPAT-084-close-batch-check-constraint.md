# MCPAT-084 — Fix close-batch 400: stale `status` CHECK constraint in existing `.index.db`

## Problem

`POST /api/tasks/close-batch` (the Board "Complete all" button) returns 400:
`CHECK constraint failed: status IN ('todo','in_progress','done','blocked','archived','draft','approved')`.

The endpoint transitions every `done` task to `closed`, but existing per-project `.index.db` files
were created BEFORE `'closed'` was added to the `status` CHECK in `schema.sql`. SQLite cannot ALTER a
CHECK constraint, and the `db_schema_version` block in `sqlite-index.ts` only runs `ALTER TABLE ... ADD
COLUMN`. So `schema.sql` (source) is already correct (line 26 includes `'closed'`), but every
pre-existing on-disk DB keeps the stale 7-status constraint forever.

Impact: "Complete all" 400s on every project, and the Completed tab is permanently empty (`closed: 0`).

## Root cause (confirmed)

- `src/store/schema.sql:26` — status CHECK already includes `'closed'` — correct for fresh DBs only.
- `src/store/sqlite-index.ts:180-234` — `init()` execs schema.sql (CREATE IF NOT EXISTS = no-op on the
  existing `tasks` table); the db_schema_version block only ADD COLUMNs. No path recreates the table.
- `src/store/index-health.ts:136-169` — an existing, tested nuke-and-rebuild-from-markdown path. Reuse it.

## Approach

Detect the stale constraint STRUCTURALLY and route the DB through the existing rebuild path. Markdown
is the source of truth, so rebuilding loses no data and avoids fragile in-place table surgery.

1. Staleness probe: read the `tasks` DDL from `sqlite_master`
   (`SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'`); return true when the status
   CHECK does NOT include `'closed'` (i.e. differs from the canonical allowed set).
2. Wire into `ensureHealthyIndex` (`index-health.ts`): when stale, classify like corruption and take
   the existing nuke-and-rebuild branch (close handle, delete `.index.db`, reopen from schema.sql,
   `rebuildFn` repopulates from markdown). Reuse existing machinery; do not hand-roll a table copy.
3. Bump `DB_SCHEMA_VERSION` (1 -> 2) for provenance.

## Acceptance Criteria

- AC1: a DB whose `tasks.status` CHECK lacks `'closed'` is detected stale and rebuilt; after rebuild the
  `tasks` DDL in sqlite_master includes `'closed'`.
- AC2: after rebuild, upserting a task with `status='closed'` succeeds (no CHECK failure).
- AC3: rebuild preserves all existing rows (count + ids unchanged; spot-check fields).
- AC4: a DB created fresh from current schema.sql is NOT flagged stale.
- AC5: `POST /api/tasks/close-batch` against a serve-ui backed by a migrated index returns 200 and moves
  done tasks to closed (verify end-to-end; document a curl check in the PR).
- AC6: `npm run type-check`, `npm run build`, `npm test` all pass; new unit tests cover AC1-AC4.

## Tests

`tests/unit/index-health.test.ts` (or new `tests/unit/schema-migration.test.ts`): create a temp DB with
the OLD 7-status CHECK + a row; probe returns true; run rebuild with a markdown fixture; assert rebuilt
DDL includes `'closed'`, `done->closed` upsert succeeds, rows preserved; fresh-schema DB probe is false.

## Out of scope

- No change to schema.sql constraint (already correct). No change to close-batch endpoint logic.

## Files

- `src/store/index-health.ts` — staleness probe + wire into rebuild decision
- `src/store/sqlite-index.ts` — bump DB_SCHEMA_VERSION, locate/expose the DDL probe helper
- `tests/unit/index-health.test.ts` (or new file) — AC1-AC4 coverage
