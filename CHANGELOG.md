# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

**Reliability — server heartbeat into the factory health ledger + reconcile-github wired into two automatic triggers.**

### Reliability
- health: server heartbeat + lifecycle/error events into `health.jsonl` (`daemon:mcp-agent-tasks`), dead-man switch armed in `health-expectations.json`
- hooks: post-merge failure escalation routed into the watched ledger, with a detached `reconcile-github` fallback per failed prefix
- health: stamp-gated daily `reconcile-github` sweep wired into server startup for GitHub-side merges the post-merge hook never saw locally

## [v2026.06.22] — 2026-06-22

**Build the full advisor coaching layer — play system, safety state-gate, episodic/semantic memory, Challenger subsystem, living artifacts, brain-dump decomposer, and entity/state-chart views.**

### Must Ship Criteria
- ✅ Phase 0: typed schemas + stores (advisor-episodic, advisor-entities, advisor-state, advisor-artifacts, advisor-consolidation)
- ✅ Phase 1: play system + state-gate [SAFETY GATE] — 11 plays, somatic_pendulation grounding, refer path, StateRibbon
- ✅ Phase 2: consolidation arbiter — pivot-safe entity extraction, idempotency, POST /api/advisor/consolidate
- ✅ Phase 3: Challenger subsystem — cold-isolated disconfirmation, ChallengeCard, grounding suppression
- ✅ Phase 4: living artifacts — ArtifactCard, ArtifactsSection, append-only versions API
- ✅ Phase 5: brain-dump decomposer — /api/advisor/triage with thread_candidate SSE frames
- ✅ Phase 6: views + session-open ritual — StateChartView, EntityTimeline, state-log/entities endpoints

---

### New Features
- advisor: state chart + entity timeline views + state-log/entities endpoints (a59b90b)
- advisor: brain-dump decomposer — triage endpoint with thread_candidate SSE frames (2282ae6)
- advisor: living artifacts — versioned docs + ArtifactsSection UI + API endpoints (8c060aa)
- advisor: Challenger subsystem — isolated disconfirmation with grounding gate (434af43)
- advisor: consolidation arbiter — episodic-to-semantic entity extraction (68c408e)
- advisor: play system + state-gate safety layer (0604f07)
- advisor: typed schemas + stores — Phase 0 (5dba9fb)
- advisor: native session model + history panel (f5c9c84)
- advisor: in-chat memory capture (6223265)
- advisor: conversational action cards for task/note creation from chat (ee892d4)
- advisor: Goals CRUD, GoalsList UI, portfolio signals in buildSuggestions (e8b3948)
- advisor: session history JSONL store and memory types (0a26d8f)
- advisor: Strategic Advisor persona modes — PM / Chairman / Coach (f3aaa46)
- notes: NotePanel detail view with inline editing (b6ed0c7)
- notes: pinned-grid layout (052099c)
- notes: Notes capture UX — Infer|Task|Note mode + /api/capture/infer + /api/capture/note (01b7926)
- notes: NoteRecord, NoteStore, 5 MCP tools, CLI (ffc7b0a)
- notes: brain sync, POST /api/advisor/query, AdvisorView nav tab (f2f6575)
- notes: NotesView, TaskPanel related notes, REST API (0c15935)
- triage: persist sweep results so TriageView rehydrates without re-running AI (6d419fc)
- triage: Triage view + /api/triage/{preview,run,undo} endpoints (2b6e1a4)
- triage: task triage engine — Tier-0 git + Tier-2 LLM, apply/audit/undo, CLI (4cd5040)
- triage: Tier-2 repo signals — git evidence for LLM triage (f63fb50)
- triage: triage reliability + task-ID provenance (30b1b2a)
- triage: sweep performance — Haiku + concurrency + repo cache + gh cache (56926c8)
- triage: spawn-retry on transient ENOENT + tiered thresholds (86734a3)
- triage: boot auto-reconcile + apply-by-runId & Close/Keep UI polish (404b34c)
- tray: PWA install support — vite-plugin-pwa + manifest + service worker (db02ec6)
- tray: install-tray autostart command (5a0a741)
- tray: UI version poller, Reload toast, Update button (440147a)
- tray: supervisor + systray2 menu (421bf9b)
- tray: shared build runner + serve-ui dev endpoints (6dc38c4)
- advisor: streaming claude.exe chat + suggestions backend (223c4fd)
- ui: Completed view done-row restyle (7457513)
- ui: Today filter+sort toolbar (bc2013b)
- ui: sidebar 3-group layout, footer rework, balanced/airy density (5a40064)
- ui: capture modes finish — localStorage persistence, focusCapture, Phase-3 CSS (a82ab15)
- tests: gate claude-spawning tests behind CLAUDE_CLI_DISABLED (0e31f08)
- artifacts: surface task-linked docs + open-in-default-app (6d5b2f9)
- ui: global sort & filter expansion — type/status/priority/milestone/needs-attention (82a39ee)
- ui: surface dependencies/references/subtasks/files/complexity in TaskPanel (b928a16)
- ui: Today row separation + Created/Updated dates in task panel (fb0beaa)
- ui: TaskPanel footer — split button, real Claim, lucide icons (1aaf257)
- ui: project name field + settings cog — projects CRUD (561b611)
- ui: TaskPanel Block + Promote, grouped status footer (2d9ee69)
- ui: P3-01 UI polish — Board cards, density switcher, ViewHeader, content width (08cc728)
- ui: automation flywheel + ACR live integration (08f07c6)
- ui: capture → Brain Dump handoff (0ddb477)
- ui: Hermes view + triage engine + sign-off gate (aa5706e)
- ui: favourites — pinned projects in nav + filter chips (40ad993)
- ui: P2-04b draft auto-triage — Haiku classify → auto-promote or flag (af2cd97)
- ui: Hermes backend — agent_status, signoff, skills, agent log (e4863f9)
- ui: global filter — shared across Today/Board/Artifacts/Roadmap/Activity (73c9a4f)
- ui: CommandPalette Cmd+K overlay + fuzzy search (f47de76)
- ui: global capture bar — always-visible top bar (62d5a7b)
- ui: right ambient panel — ACR, knowledge, activity (b54b741)
- ui: Board, Roadmap, Activity reskin — enum fix, kanban, timeline (5f88aec)
- artifacts: P1-08 reskin ArtifactsView — tokens, ext icons, staleness sort, copy-path (6a6d894)
- ui: reskin BrainDumpView + CandidateCard to design tokens (c82d8ef)
- ui: P1-04 task peek & detail panels (c049c3d)
- ui: P1-03 Today view — hero, capacity, task rows, candidates, J/K nav (39d1d61)
- ui: P1-02 app shell — 3-col grid, nav, global keyboard, focus mode (5c21e30)
- ui: P1-01 design-system foundation — tokens, Geist, density, accent (0152082)
- ui: ST-7 brain quick-search panel in live feed (d0c6d7e)
- ui: ST-6 ACR status feed with graceful offline degradation (f03b116)
- ui: ST-5 artifacts panel — passive-capture log + staleness view (e185923)
- ui: ST-4 brain dump panel — LLM task inference + voice + ACR dispatch (9e91756)
- ui: ST-3 quick capture — global Ctrl+Space overlay with GEN inbox and background LLM routing (9a72906)
- ui: ST-2 Today view — capacity gauge and area grouping (a80f9d6)
- ui: ST-1 schema — PARA area + scheduled_for fields + migration (b10d470)
- store: action button — clipboard + Conductor dispatch (0766904)
- store: voice capture with Groq Whisper STT (7624973)
- store: task summary feed for brain/Hermes indexing (98810c8)
- ui: milestone CRUD — create endpoint + RoadmapView button (d709e4b)
- store: staging inbox for captured tasks (a686425)
- store: multi-project StoreRegistry for prefix-based routing (a570da4)
- ui: lift dashboard to Vite+React, rename package agent-tasks (a7783fe)
- store: passive capture + local GitHub Issues model (a4b993d)
- store: pruneOrphans + config hot-reload (9c627c4)

### Bug Fixes
- advisor-css: add missing ModeSelector and AdvisorHistory styles (e69994c)
- type-check: guard against empty src/ui/node_modules (a7474a9)
- advisor: parse stream_event-wrapped deltas so Advisor streams Claude (b65a5a9)
- advisor: style Advisor view — define missing CSS tokens + fix action button classes (4744125)
- advisor: brain offline icon + Advisor unavailable on Windows (25b5201)
- advisor: async spawn + 60s timeout for advisor endpoint (9506f19)
- store: migrate stale status CHECK constraint — close-batch 400 + empty Completed (6df4889)
- ui: span top-bar chrome across the SortControl (2929b27)
- triage: lean triage config dir must carry auth credentials (e293b9a)
- triage: use plain claude -p for LLM batch — stream-json hung to timeout (28cca2b)
- tray: move dev Update button from floating overlay into nav footer (5f785d8)
- tray: remove crash-prone tray tooltip health update (d7cd656)
- tray: spawn EINVAL in runBuild (Update) and Open Dashboard (6b6f0fe)
- tray: tray onExit ordering + real icon (ec1e4e5)
- tray: tray runtime fixes — build install, autostart Run key, systray2 interop (0eb19ef)
- store: stop SQLite index bloat + self-healing index hardening (b7c9fec)
- store: SQLite index free-page bloat causing MCP server boot-timeout drops (a542005)
- ui: P5-02 backend correctness — rerouteTask markdown-first + prompt hardening (46cff7b)
- ui: P5-01 type-check gate (tsc -b) + 22 fixes (3fe9ac6)
- ui: P4-05 UI bug batch B1–B5 (6c2ff3f)
- ui: repair source-inspection test broken by estimate-validation fix (fc3a0ec)
- ui: P5-09 daily-use bug sweep — open-detail, bucket exclusivity, GEN filter, Ctrl+K (8751df2)
- ui: Today view duplicate tasks — project-scope shared-global-index aggregations (ad2224c)
- store: task_rebuild_index reconciles global-storage projects (924762a)
- ui: reconcile each project index on dashboard boot (a4b7114)
- store: correct stale install-idempotent hook assertion (5f8d560)
- ui: point ACR at acr.nashsoftware.dev and Brain at Tailscale VPS URL (21764b8)
- serve-ui: use resolveServerDbPath for global-storage projects; inject GEN (3a90802)
- store: capture pipeline — read transcript_path from Stop event + passive-capture reinstall (95839b5)
- config: align getDbPath with server — use .index.db not tasks.db (2ec8dd9)
- ui: align dashboard types with backend, wire stats into header (319b588)

### Internal
- docs(advisor): architecture + coaching spec + implementation handoff (0384c54)
- docs(handbook): add Phase 0 store contracts to critical rules (54b2b2a)
- docs(triage): design spec for task triage & auto-reconciliation system (94ceee4)
- docs: Life OS UI reskin + Hermes agent layer specs (045006b)
- docs: life-os research + epic specs (b4d671a)
- docs: add AGENTS.md for cross-vendor AI harness compatibility (dc273cc)
- docs: P3-01 UI polish spec (2f021d1)
- docs: orchestration pack — per-phase specs + design handoff (563cdbe)
- docs: Bundle B + C handoff (069be09)
- chore: P5-08 decouple UI install from build script (ba08f65)
- chore: upgrade vitest 1.6→3.2, wire tdd-guard-vitest reporter (0eb4783)

---

## [0.1.0] - 2026-04-11

### Added

- File-based task management with markdown files and YAML frontmatter
- SQLite index for fast queries across tasks
- 20 MCP tools over stdio protocol (create, transition, claim, search, link, archive, etc.)
- CLI with `init`, `serve`, `list`, `next`, `status`, `rebuild-index`, `archive` commands
- Git hook integration: `prepare-commit-msg` (task ID prefix) and `post-commit` (auto link-commit)
- Claude Code PreToolUse hook for task-gate enforcement
- Task lifecycle: `backlog` → `ready` → `in_progress` → `review` → `done`
- Dependency graph with circular dependency detection
- Subtask support with promotion workflow
- Cross-project task management with configurable prefixes
- Manifest writer for git-tracked `index.yaml`
- Legacy scratchpad reconciliation and import
- Dual ESM/CJS build output
- 283 tests (unit + integration)
