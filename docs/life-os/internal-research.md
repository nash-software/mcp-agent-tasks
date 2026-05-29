# Life OS — Internal Research

> What you already have. State of the three systems in play: `mcp-agent-tasks` capture,
> the `serve-ui` board, and `nash-ai` (Hermes). Compiled 2026-05-28.

---

## TL;DR

1. **Task capture is BROKEN at runtime** — not partially, not flaky. The Stop hook reads an input shape Claude Code never sends, so it silently exits on every real conversation end. Tests are green because they test the wrong contract. **Nothing has ever been auto-captured.**
2. **serve-ui only shows `config.projects`** — it never includes the GEN global project and mishandles `storage: global` projects (MCPAT, NASH). That's why global + other-project tasks don't appear without manual adding.
3. **nash-ai is a powerful agent runtime with no flow** — the Telegram gateway, cron scheduler, and sentry-triage pipeline are real and proven, but the three MCP bridges (tasks/handbook/brain on ports 8091/8092/8093) that would connect it to your task + knowledge systems **do not exist in the repo**. That's the "lots set up, nothing flowing" gap.
4. **A 3.8 GB `.index.db`** sits at `~/.mcp-tasks/tasks/.index.db` for ~16 tasks. Abnormal. Likely a runaway-write / un-checkpointed WAL bug. Flagged for separate investigation.

---

## 1. Task capture — VERDICT: broken at runtime

### Root cause

The Stop hook expects the transcript inlined as an array; Claude Code sends a *path to a JSONL file* instead.

- `hooks/stop-intent-extractor.js:310-312` requires `Array.isArray(payload.transcript)` and exits 0 otherwise. Its only data source is the parsed stdin JSON's `.transcript` field (line 310) and `.cwd` (line 315).
- Claude Code's real Stop payload provides `session_id`, **`transcript_path`** (a path to a JSONL file on disk), `cwd`, `hook_event_name: "Stop"`, and `stop_hook_active`. It does **not** inline the transcript.
- The hook never reads `transcript_path` or opens the JSONL file. Codebase-wide grep for `transcript_path` / `stop_hook_active` returns **zero** hits.
- Net effect: on every real Stop event, `payload.transcript` is `undefined` → hook exits at line 311. `extractIntents()` and `routeProject()` are **never reached in production**.

### Why the tests didn't catch it

`tests/unit/hooks/stop-intent-extractor.test.ts:63-145` feeds a synthetic `{ transcript: [...], cwd }` object — a payload shape the real harness never produces. Tests pass-by-inspection but validate the wrong contract. This is a textbook "tested against the wrong input shape" trap.

### Corroborating on-disk evidence (nothing ever landed)

- `~/.config/mcp-tasks/config.json` has **9 projects, none is GEN**. The router's auto-init (`hooks/lib/project-router.js:210-211`, `initGenProject`) has never fired.
- `~/.mcp-tasks/tasks/gen/` **does not exist** — the GEN fallback dir was never created.
- Newest task anywhere is dated May 22–26 (the MCPAT-018/019/020 feature specs), all `status: draft`, all manually created. **No task with `auto_captured: true` exists.**

### What is actually correct

The install/registration path is fine — the past silent-failure schema bug is **not** present here.

- `src/cli.ts:1077-1086` writes the Stop hook entry as `{ matcher: '', hooks: [{ type: 'command', command, timeout: 30000, async: true }] }` — the required array-wrapper format.
- Same correct shape for passive-capture (PostToolUse, `cli.ts:1001-1010`) and session-task-detector (SessionStart, `cli.ts:1032-1041`).
- `upsertHookEntry` (`cli.ts:970-982`) dedups by filename.

So if the hook read the right input, registration would work end-to-end. **The break is the input contract, not the wiring.**

### Secondary runtime risks (will bite even after the transcript fix)

- `hooks/lib/intent-extractor.js:217-219` spawns the `claude` CLI **synchronously**. Per project memory ("Windows Job Objects block subprocess `claude`"), spawning `claude` from inside a Claude Code session fails on Windows — so the LLM-extraction path is also unreliable in the exact environment that triggers the Stop hook. The keyword-fallback path must be the primary, not the backup.
- `stop-intent-extractor.js:260` tries `/dev/stdin` first; on Windows it falls to the `fs.readSync(0, ...)` path (lines 263-283), which is fine — but moot while the transcript-shape bug blocks everything downstream.

### Fix (the real blocker)

`stop-intent-extractor.js:310` — read `payload.transcript_path`, load the JSONL file, map its lines to `{ role, content }`, then filter. Update the test to feed the **real** Stop payload (`{ transcript_path, cwd, hook_event_name, stop_hook_active }`) so it guards the actual contract.

---

## 2. serve-ui — why global + other-project tasks don't show

serve-ui discovers projects **only** from `loadConfig().projects` and never includes GEN or respects storage mode.

- `src/server-ui.ts:117-118` → `loadConfig()` then `openProjectIndexes(config)`.
- `openProjectIndexes` (`server-ui.ts:97-114`) maps over `config.projects` and, per project, builds the DB path as `join(p.path, tasksDirName, '.index.db')` (lines 108-109). It **ignores `p.storage`** and any tasksDir override.

### Three concrete gaps

1. **GEN is never displayed because GEN is never in the config.** serve-ui can only show what `config.projects` contains. The GEN entry is written by the *capture* path (`project-router.js:312-317`, `manualWriteGenConfig`) — which is broken (§1), so GEN was never created. Even if it existed, serve-ui would compute its DB as `join("~/.mcp-tasks", "agent-tasks", ".index.db")`, whereas the router stores GEN tasks under `~/.mcp-tasks/tasks/gen` (`project-router.js:205, 226`). **Path mismatch** → serve-ui points at a non-existent DB → shows nothing.

2. **`storage: global` projects (MCPAT, NASH) show empty/wrong.** Their task DB is the shared `~/.mcp-tasks/tasks/.index.db` (per `resolveServerDbPath`, `src/store/loader.ts:134-149`, which routes `storage === 'global'` to `getDbPath()`). But serve-ui hard-codes `join(p.path, 'agent-tasks', '.index.db')` (line 108) and **never calls `resolveServerDbPath`, never checks `p.storage`**. It only falls back to `getDbPath()` when the per-project dir is missing (line 109) — which partially masks the bug by accident, not design.

3. **No registry-scan / global-root scan.** serve-ui is purely `config.projects`-driven. It never scans `~/.mcp-tasks` or aggregates "all registered projects + global." `task_register_project` (`src/tools/task-register-project.ts:61-73`) does append `{prefix, path, storage}` to the config serve-ui reads — so *registered* projects appear — but GEN is created lazily by a broken path with a layout serve-ui can't resolve.

### The single fix point

`openProjectIndexes` (`server-ui.ts:97-114`) should:
- (a) resolve each project's DB via `resolveServerDbPath(tasksDir, config, p.prefix)` (already exported from `loader.ts:134`) instead of the hard-coded join — fixes MCPAT/NASH;
- (b) explicitly include GEN/global — inject a synthetic `{ prefix: 'GEN', path: ~/.mcp-tasks, tasksDir: ~/.mcp-tasks/tasks/gen }` or scan the global storage dir — so global tasks render without manual `task_register_project`.

---

## 3. nash-ai (Hermes) — powerful runtime, nothing flowing

### What it is

A fork of NousResearch's **Hermes Agent** (`README.md:5-14`) — a multi-provider Python agent CLI + messaging gateway. "Hermes" is the upstream product; "Nash AI" is your personalization into a self-hosted personal agent (`CONTEXT.md:1-3`). Large mature upstream (5,578 commits) with your customizations as a thin config + one plugin.

- **Stack:** Python 3.11+ (uv), SQLite session store with FTS5, MCP client, cron scheduler. Entry points: `cli.py`/`run_agent.py` (TUI), `gateway/run.py` (gateway), `mcp_serve.py` (exposes Hermes itself over MCP), `acp_adapter/`.
- **Model:** `AIAgent` → `Toolset`s → `Tool`s; `Gateway` hosts `Platform` adapters; `Skill`s are markdown prompt templates; `Cron` for unattended jobs.
- **Intent (per memory):** a "personal operating system" on a Hetzner VPS coordinating all projects, comms via Telegram, infra monitoring, learning over time.

### Integration points

Your wiring lives in `nash-config/config.yaml` (deployed to `~/.hermes/config.yaml` on the VPS).

| System | Implemented? | Evidence |
|---|---|---|
| LLM routing via Prism | Config-wired | `config.yaml:8-13` (`localhost:3000/v1`, model `auto`) |
| **Telegram** (gateway + voice) | **Built + wired + proven** | `gateway/platforms/telegram.py`; config `:17-34` |
| Discord/Slack/WhatsApp/Signal/Matrix/Email/SMS/+ | Upstream-built, **not configured** | `gateway/platforms/*.py` (17 adapters, only Telegram enabled) |
| **Sentry triage** | **Fully custom-built, proven** | `plugins/sentry_triage/` (18 modules, 4 merged PRs) |
| ACR pipeline (bug dispatch) | Wired via MCP | MCP server `acr-gateway` → `localhost:${ACR_MCP_PORT}/mcp` (`:122-130`) |
| **mcp-agent-tasks** | **Config-only, bridge missing** | MCP server `tasks-gateway` → `localhost:8091/mcp` (`:132-138`) |
| **handbook** | **Config-only, bridge missing** | `handbook-gateway` → `localhost:8092/mcp` (`:140-146`) |
| **brain** (memory) | **Config-only, bridge missing** | `brain-gateway` → `localhost:8093/mcp` (`:148-152`) |
| n8n | Scaffolded | `nash-config/n8n/sentry-triage-workflow.json` |
| Tailscale / Hetzner VPS | Deployment substrate | `nash-config/setup-vps.sh`, `nash.service` |
| Groq Whisper STT | Config-wired | `:31-33` |
| Generic MCP client | Upstream-built | `tools/mcp_tool.py` (stdio + HTTP) |

### Live vs scaffolded-but-dead

- **Real & proven:** the upstream Hermes engine (TUI, gateway, sessions, skills, cron with cross-platform locking, MCP client) + your **sentry-triage plugin** (dedup, Telegram approval/reply parsing, ACR handoff, retry worker, watchdog). The sentry pipeline proves the full pattern: *event → agent reasoning → Telegram approval → downstream action*.
- **Dead:** **the three knowledge-graph MCP bridges (8091/8092/8093) have NO implementation anywhere in the repo** — grep for those ports returns only the config file. They presume bridge processes on the VPS proxying stdio MCP servers over HTTP; those are unbuilt. **This is the gap behind "nothing flowing."** The morning-briefing / nightly-retro crons (`config.yaml:220-237`) call `task_list` — i.e. they depend on the missing `tasks-gateway` bridge.
- n8n workflow is exported JSON, not confirmed active. 16 of 17 platform adapters dormant.

### Capabilities today

- **Tasks:** none native — it *intends* to consume `mcp-agent-tasks` via the unbuilt `tasks-gateway`. NASH-prefixed tasks live in mcp-agent-tasks (global storage), not here.
- **Memory:** upstream agent-curated memory + FTS5 session search + Honcho user modeling; deeper memory is the external `/opt/memory` git repo (171 files) mounted in; intended `brain-gateway` MCP. `plugins/context_engine/` is an empty stub.
- **Notifications:** strong and real — cron + Telegram delivery is the one capability that actually flows. Sentry/ACR/Prism-health webhooks all format → push Telegram.

### Deployment

- `nash-config/nash.service` — systemd unit running `python -m hermes.main --platform telegram` on the VPS, `Restart=always`, after `prism.service`.
- Hetzner VPS `nash-vps` (CPX42, 16GB), Tailscale `100.86.15.64`, `ssh root@nash-vps`. Deploy via `setup-vps.sh`.
- **Caveat:** memory notes the *historically running* daemon was OpenClaw-based (port 18789), not Hermes. Hermes is the newer intended replacement. Unclear which is currently live — consistent with "nothing flowing yet."

### Assessment

nash-ai is **a powerful agent runtime, not a data backbone.** Its strength is the *interaction + automation surface*: robust multi-platform gateway, natural-language cron, skills, sessions, generic MCP client. It deliberately does **not** own structured state — tasks, knowledge graph, and memory are all delegated outward over MCP. The missing link is literally those MCP HTTP bridges.

- **Agent/comms/automation layer of a life OS** → build on **nash-ai**. Reinventing this elsewhere would be enormous.
- **Structured task/state spine** → belongs in **mcp-agent-tasks**, which nash-ai already expects to call as `tasks-gateway`.
- **Highest-leverage single connection:** build the HTTP MCP bridge exposing mcp-agent-tasks' stdio server on `localhost:8091`. The morning-briefing cron starts producing real output the moment it exists.

**They are complementary, not competing.** nash-ai = the always-on agent that talks to you and acts; mcp-agent-tasks = the system of record.

---

## Key files referenced

- `hooks/stop-intent-extractor.js`, `hooks/lib/intent-extractor.js`, `hooks/lib/project-router.js`
- `src/cli.ts` (hook install), `src/server-ui.ts`, `src/store/loader.ts`, `src/tools/task-register-project.ts`
- `~/.config/mcp-tasks/config.json`, `~/.mcp-tasks/tasks/`
- `C:\code\nash-ai\nash-config\config.yaml`, `plugins/sentry_triage/`, `cron/scheduler.py`, `tools/mcp_tool.py`, `gateway/platforms/`, `nash-config/nash.service`
