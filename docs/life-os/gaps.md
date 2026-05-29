# Life OS — Gaps Analysis

> The bridge between the two research docs. What you want vs. what exists, where the gaps
> are, and what's worth doing in what order. Read [internal-research.md](./internal-research.md)
> and [external-research.md](./external-research.md) first. Compiled 2026-05-28.

---

## Your stated problem, restated

You don't have a tooling problem. You have a **context problem** — context switching, awareness of what to work on, remembering what was made for you, and juggling client + personal + outsource work across too many places. Concretely:

- Tasks live in your head ("I'll come back to that") and the Zeigarnik effect taxes you for every open loop you don't externalize.
- Artifacts get made for you (e.g. `citation-pack.html`) and lost — no index of "what was created, where, for what."
- Work happens in chat with an agent ("yeah, add those to my tasks") but there's no reliable path from that moment to the right place.
- You want **one place to look** — but (per external research) that's a *view*, not a single app.

The research validates that your instinct is architecturally correct: keep truth distributed, build one capture point + one router + one surfaced view. **You are already 70% of the way there in code** — you just have three broken/missing links.

---

## The core finding

> **The "life OS" you're describing is mostly already designed across `mcp-agent-tasks` +
> `nash-ai`. It doesn't flow because of three specific, fixable breaks — not because the
> architecture is wrong or missing.**

The external research independently arrived at the same shape you've been building:
- **System of record** = file-based task store with project routing → *that's `mcp-agent-tasks`.*
- **Always-on agent / comms / automation surface** = multi-channel agent with cron + MCP client → *that's `nash-ai`/Hermes.*
- **Human-readable surface** = markdown PKM → *that's the Obsidian gap.*
- **Artifact memory** = MCP memory server → *that's the missing memory layer.*
- **Capture → route → surface** = LLM router (copilot model) → *that's your `routeProject` + a triage step.*

So this is a **finish-and-connect job**, not a greenfield build. The biggest risk the research flags is "AI Setup Porn" — building more system instead of closing the loops you already have.

---

## Gap register

Each gap maps a desired capability to its current state, the specific break, and the fix.

| # | Capability you want | Current state | The break | Fix | Effort |
|---|---|---|---|---|---|
| **G1** | Auto-capture tasks from agent conversations | **Broken** — never fired | Stop hook reads `payload.transcript` (array); Claude Code sends `transcript_path` (file path) | Read + parse the JSONL at `transcript_path`; fix the test to use the real payload | **S** — single file |
| **G2** | See ALL tasks (global + every project) in one board | Partial — shows only `config.projects`, mishandles global storage, never shows GEN | `server-ui.ts` hard-codes per-project DB path, ignores `storage` + GEN | Use `resolveServerDbPath`; inject/scan GEN | **S** — one function |
| **G3** | "Add those to my tasks" → lands in the right place | Designed, blocked by G1 | `routeProject` works but the capture path that calls it never runs | Comes free once G1 lands; add a copilot review step | **S→M** |
| **G4** | Remember docs/artifacts made for you | **Missing entirely** | No artifact index anywhere | Add an MCP memory layer (`mcp-memory-service` or Pieces) OR a lightweight `artifacts/` index in the task store | **M** — decision-dependent |
| **G5** | nash-ai actually does something | **Dead** — bridges unbuilt | MCP HTTP bridges for ports 8091/8092/8093 don't exist in the repo | Build the `tasks-gateway` HTTP→stdio bridge first | **M** |
| **G6** | A human surface you'd actually open daily | **Missing** | No PKM/daily-note layer; serve-ui isn't "the one" (your words) | Obsidian over the same markdown + `obsidian-mcp-server` | **M** |
| **G7** | Reduce context-switch cost | **Missing** | No current-state / daily-note / shutdown ritual | A daily-note convention + an agent that writes the "where was I" note | **S→M, habit-led** |
| **G8** | A consolidated *view* across distributed truth | **Missing** | Each system is a silo; no aggregation layer | The board (G2) + Obsidian (G6) + a daily surfaced "what's next" | **M, follows G2/G6** |
| **G9** | Stay on top via the weekly review | **Missing** | No ritual, no surface for it | Weekly-review template + a Friday/Sunday agent prompt | **S, habit-led** |
| — | (latent) 3.8 GB `.index.db` for ~16 tasks | **Bug** | Runaway writes / un-checkpointed WAL | Separate investigation | **?** — diagnose first |

**Effort key:** S = hours, M = a day or two, ? = needs diagnosis.

---

## What the research says you should NOT do

- **Don't build a new mega-app.** Pure consolidation reliably fails (massive wikis go stale in months). The "one place" is a *view* over distributed truth.
- **Don't adopt Rewind** — dead since Dec 2025.
- **Don't pick Zettelkasten or paper bullet-journaling** as your primary system — wrong fit for an execution-and-consolidation problem.
- **Don't over-automate capture.** Use the **copilot model** (agent proposes, you approve) — it preserves trust, which is the thing that makes you actually keep using the system.
- **Don't keep configuring instead of shipping** — "AI Setup Porn" is the named trap for exactly your situation.

---

## The non-negotiable habit (no code can replace it)

Every methodology agrees on one keystone: **the weekly review.** It's the single most-skipped, most load-bearing habit in GTD, PARA, and BASB alike. No amount of capture automation survives without it. Whatever you build, the system rots without a ~25–60 min weekly pass where you reconcile "do my active projects/tasks reflect reality?"

Second keystone, developer-specific: **the current-state note at the moment you switch contexts.** Cheapest, highest-leverage habit for your #1 stated pain.

---

## Recommended sequencing (smallest leverage-per-effort first)

This is a suggestion, not a plan — you said you don't yet know the "what." Each phase is independently valuable and stops the bleeding before the next.

**Phase 0 — Make what you have actually work (hours, do this regardless of the bigger vision):**
1. **Fix G1** (transcript_path) — capture is the foundation; right now it's a no-op. (`MCPAT` task)
2. **Fix G2** (serve-ui global/multi-project) — so you can finally *see* everything captured. (`MCPAT` task)
3. **Diagnose the 3.8 GB index.db** — before it becomes a real problem.

> After Phase 0 you have a working capture→store→board loop. That alone addresses "see all my tasks in one place" and "add those to my tasks."

**Phase 1 — Close the artifact + human-surface gaps (a day or two):**
4. **G6 — Obsidian as the human surface** over the same markdown files (`obsidian-mcp-server`). This is the external research's #1 recommendation and gives you the daily-note + PARA convention for free.
5. **G4 — Artifact memory.** Decide: `mcp-memory-service` (self-hosted, knowledge-graph) vs Pieces (passive dev capture) vs a lightweight `artifacts/` index inside the task store. Solves the `citation-pack.html` problem.

**Phase 2 — Make nash-ai flow (a day or two):**
6. **G5 — Build the `tasks-gateway` MCP HTTP bridge** (8091). The single highest-leverage connection: the morning-briefing cron starts producing real output the moment it exists, and nash-ai becomes the always-on surface that *tells you* what to work on via Telegram.

**Phase 3 — Habits + view (ongoing):**
7. **G7/G9 — Daily-note + weekly-review rituals**, ideally agent-prompted (nash-ai cron → Telegram). PARA as the cross-tool convention.
8. **G8 — The consolidated view** emerges from the board + Obsidian + the daily Telegram surface. Don't build it as a separate thing.

---

## The open question for you to decide

The research is clear on architecture but leaves **one genuine fork** that only you can answer:

> **Where does the human-facing "life OS" live — and how much do you want to build vs. adopt?**

Three coherent end-states, in increasing build cost:

- **A. Minimal / integrate-only:** Fix Phase 0, add Obsidian (G6) + an off-the-shelf memory MCP (G4). nash-ai stays as-is. Lowest effort, gets you 80% of the felt benefit.
- **B. Connected agent:** A + build the nash-ai bridges (G5) so a Telegram agent captures, routes, and surfaces "what's next" daily. This is the "agent adds it to the right place" vision realized.
- **C. Full custom life OS:** B + a bespoke unified view and deeper routing/automation. Highest cost, highest "AI Setup Porn" risk — only justified if A/B genuinely don't cover your daily reality.

The research recommendation leans **A → B**, deferring C until you've lived with B and found a concrete gap it doesn't cover.

---

## One-paragraph summary

You already designed the right system; it just doesn't flow. Three fixable breaks (broken capture, a board that can't see global/other-project tasks, and unbuilt nash-ai bridges) stand between you and a working "capture → route → store → surface" loop. The external research confirms your distributed-truth-with-one-view instinct is correct, names the keystone habits no tool can replace (weekly review + current-state notes), and points to integrate-don't-rebuild: Obsidian as the human surface, an MCP memory server for artifacts, and the nash-ai Telegram agent as the thing that tells you what to work on. Start by making what you have actually work (Phase 0, hours of effort), then decide between the minimal (A), connected-agent (B), or full-custom (C) end-state — the research says A→B and defer C.
