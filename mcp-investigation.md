All 10 research agents have reported. Here's the consolidated root-cause synthesis for MCPAT-111 task-ID collisions.

Root cause: three independently-writable ID stores, only two of which agree on which file to open

The collision mechanism is not "silent fallback to legacy global store" as the ticket's why field frames it — it's a genuine multi-process SQLite-index divergence with a real TOCTOU race:

- src/server.ts:107-111 (the always-on MCP server) opens one SqliteIndex at config.storageDir/.index.db for every project, regardless of storage: 'local'|'global' — it never branches on the field.
- src/cli.ts buildStore() and task-reconcile-github.ts's standalone buildStore() both call resolveServerDbPath() (src/config/loader.ts:165-181), which does branch: storage === 'local' → a separate <repo>/agent-tasks/.index.db file.

For any storage: 'local' project (ALFI, COND, ACR, HRLD, HBOOK, EXTR, PRSM, RELAY, PAUSE, PROXY per the live config), this means the always-on server and any CLI-spawned agent-tasks create (e.g. the Stop-hook's auto-capture pipeline) write against two different physical SQLite files for the same prefix. nextId()'s directory-rescan safeguard (sqlite-index.ts:928-986) is eventually-consistent, not atomic — when both processes scan-then-increment close together, both see the same max and mint the same ID. This is the exact TOCTOU shape that produced ALFI-003/026 and plausibly MCPAT-110.

Correction to the ticket's incident list: MCPAT-118 (already fixed, PR #143) was a different bug — a human/agent hand-typing a guessed ID into a spec filename — not store-routing. It shouldn't be used to validate MCPAT-111's fix.

Compounding factors (all confirmed independently)

1. Silent-default-to-global: task-init.ts:55 and task-register-project.ts:62/64 both do storage ?? 'global' with no warning — amplifies blast radius but isn't itself the race.
2. Four call sites ignore storage entirely, unconditionally computing tasksDir = join(p.path, tasksDirName): cli.ts's fix-id-collisions command, triage/engine.ts, triage/audit.ts, server-ui.ts openProjectIndexes(). Since global is the default, this means the project's own collision-repair tool and the web UI's boot self-heal look in the wrong directory for most projects — plausible explanation for why MCPAT-110/116/ALFI-003/026 went unrepaired until manually found.
3. hooks/lib/project-router.js routeProject() is a fourth, hand-rolled resolver (confirmed, full 337-line read) that never references storage at all — used only by stop-intent-extractor.js's fully-automated write path. It corrupts the dedup check (reads the wrong index.yaml) and, on any CWD/hint miss, silently falls through to GEN with no signal that the hint didn't match — live incident shape for ALFI-003/026's "wrong project" symptom.
4. Live proof-of-collision: MCPAT-101 exists right now as two different files in two stores (global vs. this repo's local).

Critical, separately-severe finding: config split-brain (possibly worse than MCPAT-111)

Three non-cross-tested config-resolution implementations read the same ~/.config/mcp-tasks/config.json: loader.ts (strict, 8 required fields), project-router.js (lenient, silent-empty on failure), task-gate.js (deprecated third path, silently no-ops enforcement). project-router.js's GEN auto-init write (manualWriteGenConfig) persists a config missing 6/8 required fields — which then fails loader.ts's validator on the next load, triggering ensureDefaultConfig() to overwrite the entire config file with defaults, wiping the whole project registry. Self-triggering, cross-layer data loss. Recommend treating this as its own P0, independent of MCPAT-111.

reconcile-github: needs separate hardening, not subsumed by MCPAT-111

prMatchesTaskId (task-reconcile-github.ts:106-110) does a bare whole-word regex match of task ID against PR title/branch across up to 300 merged PRs, no date scoping, no check the PR postdates the task, no store-provenance check. MCPAT-113/115/138 fixed FTS crashes, write-path store divergence, and bookkeeping-PR false positives — none fix this. Consequence: even after MCPAT-111 lands, already-existing collisions leave permanent phantom PRs that keep getting misattributed, and any future stray duplicate ID reproduces the symptom. MCPAT-137's claimed self-merge mechanism was grepped for and not found in this repo — likely an external (relay VPS) system if real.

Recommended fix (from the dedicated fix-proposal agent)

- Approach A (primary, ship first): Collapse resolveServerDbPath() to always return the shared global .index.db regardless of storage — ~5 lines in loader.ts, matches what server.ts already does, no migration needed (SQLite is documented as rebuildable-from-markdown). Directly closes the TOCTOU race for every local-storage project.
- Approach B (follow-up hardening): Delete project-router.js's duplicate resolver; route it through the CLI's own storage-aware resolveTasksDir() instead. Fixes the corrupted dedup check and removes the second independently-risky reimplementation.
- Approach C (optional defense-in-depth): Cross-store on-disk uniqueness probe at allocation time — narrows but doesn't close the race; only worth it if a future audit finds a fourth divergent path.

Still open / unaddressed

- MCPAT-119: non-hermetic serve-ui-html.test.ts (reconciles against real host config) — confirmed still unfixed.
- No test asserts collision prevention across stores or the silent ?? 'global' defaults — only repair is tested.
- agent-tasks/ is .gitignore'd in this repo itself, contradicting this project's own CLAUDE.md claim that markdown tasks are git-trackable.

This is findings-only per your original scope — no code, task transitions, or PRs touched. Want me to write this up as a task/spec (or a handful of them, split by the A/B/C fix scope, the config split-brain, and the reconcile-github hardening) so it's trackable, or leave it here as a report?