# Life OS — External Research

> How to operate, understand, and stay on top of your life — methodologies and tools.
> Citation-backed survey for a developer struggling with context switching, awareness of
> what to work on, remembering artifacts made for them, and juggling client + personal +
> outsourced work. Compiled 2026-05-28.

---

## Part A — Methodologies & mental models

### The one diagnosis that ties it all together

Your "I'll come back to that in my head, but I don't" is the **Zeigarnik effect**: uncompleted/interrupted tasks occupy working memory disproportionately and drain you. Open loops have to move from working memory into a trusted external system or they keep costing you. ([The Good Space — ADHD & open loops](https://thegoodspace.uk/open-loops-adhd/), [I'm Busy Being Awesome — Zeigarnik & ADHD](https://imbusybeingawesome.com/zeigarnik-effect-adhd-unfinished-tasks/))

The fix is non-negotiable and has three parts: **externalize immediately, keep items visible, and aggressively close loops.** Everything below is in service of that. ([Courage To Be Therapy](https://www.couragetobetherapy.com/blogarticles/strategies-for-externalizing-executive-functioning-for-individuals-with-adhd), [ADDitude — working memory](https://www.additudemag.com/working-memory-powers-executive-function/))

### Core methodologies — what each is best at, and how it fails

| System | Best at | Core failure mode |
|---|---|---|
| **GTD** (Getting Things Done) | Execution, killing open loops, "what do I work on" | **Skipping the weekly review** — explicitly *the* reason people abandon it. Also: capturing without clarifying → dreaded inbox → loss of trust |
| **PARA** (Projects/Areas/Resources/Archives) | Taming scattered files fast; one structure across every app | No task-execution layer — organizes info but doesn't tell you what to *do* next |
| **Building a Second Brain** (CODE) | Linking ideas, retrieval, turning notes into output | Becomes a disorganized hoard with no next actions if used alone |
| **Zettelkasten** | Original thinking via dense links | Stale maps, inbox overload — **overkill for you** (it's for writers/thinkers, not execution) |
| **Bullet Journal** | The "migration" filter (force-rank by re-copying) | Analog, no search, doesn't scale to digital artifacts — **steal the mindset, skip the format** |
| **Time-blocking** | Pre-deciding the day, protecting deep work | Too rigid — one disruption collapses the whole day unless paired with a flexible list |

Key sources: [Forte Labs — PARA](https://fortelabs.com/blog/para/), [Forte Labs — BASB](https://fortelabs.com/blog/basboverview/), [FacileThings — Why GTD Fails](https://facilethings.com/blog/en/why-gtd-fails), [FacileThings — Weekly Review](https://facilethings.com/blog/en/weekly-review-feature).

**The distinction that matters:** *GTD is for tasks; BASB is for notes.* GTD helps you achieve more; BASB helps you learn and express more. ([Face Dragons](https://facedragons.com/productivity/gtd-and-second-brain/)) You need both, connected by links — but run as **two engines, not one merged vault** (PARA = execution engine, a lightweight linked-notes layer = insight engine; let Maps-of-Content *emerge*, never build them upfront). ([On the Agile Path — PARA + Zettelkasten combined](https://digital-garden.ontheagilepath.net/para-and-zettelkasten-combined))

### Context switching (the developer-specific killer)

The cost is measurable and large:
- ~**23 min 15 s** to fully refocus after an interruption (Gloria Mark, UC Irvine); knowledge workers switch tasks every ~3 min.
- **Attention residue** (Sophie Leroy): part of your mind stays stuck on the previous task after a switch — worse the more engaged you were.
- Modeled loss: ~**11.25 hours/week** of deep work per developer. ([Super Productivity — context-switching costs](https://super-productivity.com/blog/context-switching-costs-for-developers/))

**Highest-leverage habit: write a "current-state note" at the moment you switch** — dump the in-flight mental stack before you leave a context, so re-entry is cheap. Pair with end-of-day shutdown notes and a 10-minute morning triage. ([Super Productivity](https://super-productivity.com/blog/context-switching-costs-for-developers/))

Developer daily-note pattern: a dated daily journal (`2026-05-28`) holding tasks/snippets/reminders, per-project notes with embedded code, `[[Project]]` backlinks, and **end-of-session commits as a context log**. ([Waqas Gondal — Obsidian + Git for devs](https://waqasg.com/how-i-use-obsidian-and-git-to-take-notes-as-a-developer/); plugin: [obsidian-work-logger](https://github.com/wangwenyou/obsidian-work-logger))

### Capture discipline

**Capture and clarify are different stages — mixing them breaks both.** "The moment you start making decisions about an item, you've added friction. That's not capture — that's clarify." ([Super Productivity — GTD inbox](https://super-productivity.com/blog/gtd-inbox-capture-system/))

- Ubiquitous capture means **a simple, always-on tool wherever you are** — *not* "capture all the things." Complex tools lead to fiddling, not capturing. ([Zen Habits](https://zenhabits.net/tips-for-gtds-ubiquitous-capture/))
- Two failure modes: capture-without-processing builds a dreaded inbox; processing-without-capture leaves nothing to process. You need both, reliably.
- **Over-organizing is procrastination in disguise** — "productivity porn" / "tool tinkering" feels like progress while nothing ships. The builder-specific trap: **"AI Setup Porn"** — endlessly configuring agent frameworks instead of using them. ([Ness Labs](https://nesslabs.com/productivity-porn), [MindStudio — AI Setup Porn](https://www.mindstudio.ai/blog/what-is-ai-setup-porn-agent-frameworks-productivity-trap))

### The "single source of truth" problem

Your instinct ("one place to see everything") is **right as a view, wrong as a single app.** Pure consolidation reliably fails — "most teams who chase the SSOT dream end up with massive wikis that are outdated within months." A workable SSOT must accept that fragmentation is inevitable. ([usestash — Myth of the SSOT](https://usestash.com/blog/myth-of-single-source-of-truth/), [Morningmate](https://morningmate.com/blog/from-chaos-to-clarity-simplify-work-tasks/))

What actually consolidates:
- **One *index/view* layer over many stores**, not one mega-app. Truth can live in many places as long as there's one place you *look* (e.g. Morgen unifies Notion/Linear/ClickUp/Obsidian/Todoist into one view).
- **PARA as a cross-tool convention** — same 4-folder actionability structure in every app, so navigation is identical everywhere.
- **The calendar as the time+task integrator** — time-blocking forces tasks out of scattered lists onto the one timeline you actually live by.

This view-layer niche is exactly what an AI router fills (Part B, §6).

### Top methodology takeaways for you

1. Your "one place" is a **view**, not an app — keep truth distributed, build one aggregation layer + one convention.
2. Adopt **PARA everywhere** as that convention. When overwhelmed, do the "Archive reboot" (dump everything dated, start fresh).
3. The **capture/process split** is the whole game — frictionless capture, then process at fixed times.
4. **Current-state note at the moment of switching** — cheapest, highest-leverage dev habit.
5. Treat the "I'll remember it" failure as Zeigarnik — externalize immediately, keep visible, close loops; use a **"parking list"** for not-now-not-forgotten.
6. **The weekly review is the keystone** — the single most-skipped, most load-bearing habit in *every* system. No review → guaranteed rot.
7. An **LLM router** is the realistic "agent adds it to the right place" layer — use the *copilot* model (you approve) over autopilot to keep trust.
8. For artifacts: **Intermediate Packets + "notes as time travel"** — treat every doc made for you as a reusable packet captured for your future self, linked from its project. ([Forte Labs — Intermediate Packets](https://fortelabs.com/blog/intermediate-packets-in-the-wild/), [swyx — 10 principles from BASB](https://www.swyx.io/tiago-forte-second-brain))
9. Run the **dual engine**, don't merge it.
10. **Skip Zettelkasten and paper bullet journaling** as primary systems — steal only their best parts.

---

## Part B — Tools, products & open-source projects

> Two landscape-changing facts up front: **Rewind AI was acquired by Meta and shut its
> capture features on 19 Dec 2025** — do not build on it. And **MCP is now table-stakes** —
> Notion, Tana, Obsidian (community), Zapier, Make, and n8n all ship MCP support. That last
> fact is the most important one for you, since you already run an MCP task server and an
> MCP-capable agent.

### 1. All-in-one commercial "life OS" tools

| Tool | Strength | Weakness | MCP / API | Relevance |
|---|---|---|---|---|
| **Notion** + Life OS templates | Biggest ecosystem, mature API | AI is paid add-on; heavy; cloud-only; MCP is page-level, content-editing out of scope | **Official hosted MCP** + REST | Good *human surface*; poor source of truth vs your markdown |
| **Tana** | AI-native; "supertags" turn notes into structured objects | Steep learning curve | **Local API + MCP in desktop app** (Claude Code/Cursor can read/modify) | **Highest conceptual fit** — closest commercial analog to a graph life-OS |
| **Capacities** | Typed-object PKM, flat pricing | Weak automation | Limited API, no MCP | Medium — good model, thin hooks |
| **Akiflow** | Aggregates tasks from 80+ tools + time-blocking | No real AI scheduling | Integrations, no MCP | Surfacing/time-block layer |
| **Sunsama** | Calm daily-planning ritual, multi-tool pull | "Slow is the feature" | Integrations, no MCP | Daily review surface |
| **Motion** | Best-in-class AI auto-scheduling | Opaque, pricey | API, no notable MCP | Only if scheduling is the pain |
| **Reclaim** | Focus-time / habit protection | Calendar-only | API, no MCP | Narrow |

Only **Tana** (local API + MCP) and **Notion** (hosted MCP) have first-class agent connectivity. The rest are scheduling/surfacing layers, not systems of record.

### 2. Local-first / open-source PKM + task

| Tool | Self-host | MCP / API | Relevance |
|---|---|---|---|
| **Obsidian** (+ Tasks, Dataview) | Yes (files) | **Local REST API plugin = MCP server** (`coddingtonbear/obsidian-local-rest-api`) — full CRUD, section patching, search | **Highest fit** — same markdown-on-disk philosophy as `mcp-agent-tasks`; you + your agent edit the same files |
| **Logseq** | Yes | Plugin API, HTTP bridge plugins, `@logseq/libs` | High — graph + tasks + plain text, scriptable |
| **Anytype** | Yes (P2P) | Local-first, emerging API | Med-high — OSS analog to Tana/Capacities object model |
| **AppFlowy** | Yes (Docker) | Closest Notion-DB parity | Medium — good surface, weak agent hooks |
| **AFFiNE** | Yes (Docker) | Docs + whiteboard, CRDT | Medium — canvas/doc focused |
| **SilverBullet** | Yes (single binary) | Scriptable, plain text | Medium — lightweight self-hosted surface |
| **Memos** (`usememos`) | Yes (Docker) | Simple API | Excellent **quick-capture inbox backend** |

**Obsidian + Local REST API/MCP** is the single best match to your markdown+SQLite, plain-text-source-of-truth design.

### 3. Capture & routing tools

- **Drafts** (iOS/Mac) — "where text starts," instant blank page; the canonical ubiquitous-capture front door, with actions to pipe into an API.
- **NotePlan** — global quick-capture command bar + GTD plugin.
- **Memos** — self-hosted capture firehose with API; pair with an LLM to triage.
- **"GTD Inbox Triage" Claude Code skill** — *directly* your pattern: Claude scans an inbox, *proposes* routing/tags from your existing project structure, you review, Claude executes. ([GTD Triage skill](https://mcpmarket.com/tools/skills/gtd-inbox-triage))

The auto-routing problem is best solved by an **LLM classification step over your project list** — which you're uniquely positioned to build, since `mcp-agent-tasks` already has project prefixes and a `routeProject` capability (CWD ancestor matching + prefix-hint + GEN fallback).

### 4. AI-agent / MCP-native personal systems on GitHub

| Repo | Stars | What it is | MCP? | Relevance |
|---|---|---|---|---|
| **khoj-ai/khoj** | 34.7k | Self-hostable "AI second brain" — answers from your docs/web, custom agents, scheduled automations | LLM + automations | **Top OSS reference** — most mature self-hosted personal-knowledge agent |
| **doobidoo/mcp-memory-service** | 1.9k | Persistent agent memory: local embeddings, **typed knowledge-graph edges**, 76-endpoint REST, consolidation/decay, hybrid search | **Yes** (25+ clients) | **Very high** — the "remember docs/artifacts made for you" layer as an MCP server |
| **cyanheads/obsidian-mcp-server** | 563 | MCP server for Obsidian vaults — read/write/search/edit notes, tags, frontmatter | **Yes** | **Direct drop-in** if you add Obsidian as the human surface |
| **flepied/second-brain-agent** | 298 | Auto-indexes markdown/PDF/web/YouTube into ChromaDB, file-watching | **Yes** | High — turnkey "index everything, let an agent search it" |
| **Jose0213/cortex-core** | low | Self-host assistant: Discord/Slack/CLI, ~30 tools, 4-layer memory, `SOUL.md` persona, markdown skills, auto-loads `~/.mcp.json` | **Yes** | High **architecture template** — strikingly parallel to nash-ai |
| **Pieces** (pieces-app) | product | Developer long-term memory: captures IDE/browser/docs activity locally; "9-month context" | **Official MCP**, on-device | High — best **passive developer-artifact capture** |

Also: a wave of n8n-based "Life OS" / "Personal AI Assistant" repos (supervisor + sub-agents over Gmail/Calendar/Notion/WhatsApp) — useful as wiring patterns, not products.

### 5. Artifact / document tracking ("don't lose docs made for you")

This is your `citation-pack.html` problem — a useful artifact Claude made, then lost.

- **Rewind AI — DEAD** (Meta acquisition, capture disabled 19 Dec 2025). Do not adopt.
- **Screenpipe** — best OSS Rewind successor: continuous local screen+audio capture, AI text indexing, offline, encrypted. The "rewind my digital life, locally" layer.
- **Pieces for Developers** — on-device capture of code/snippets/docs across IDE+browser with MCP query. Most *developer-specific* "where did I save that."
- **Heptabase** — whiteboard PKM, sub-second search over 10k+ notes, AI chat over your KB.
- **doobidoo/mcp-memory-service** — the artifact-memory layer if you want it agent-native rather than a new app.

For you, **Pieces** (MCP, on-device, dev-scoped) and **mcp-memory-service** (self-hosted, MCP) plug into your existing agent without a new silo. Screenpipe is the heavier "record everything" option.

### 6. Integration glue (capture → task → surfacing)

| Tool | MCP? | Self-host | Notes |
|---|---|---|---|
| **n8n** | **Native MCP**; v2.0 has LangChain nodes, memory, RAG, human-in-the-loop | **Yes** (no per-run pricing) | **Best fit** — self-hostable, deepest agent capabilities; both MCP *client* and host. Ideal hub for capture→classify→`task_create`→surface |
| **Zapier** | MCP in all paid tiers; Agents over 8,000+ apps | No | Widest catalog, easiest, priciest |
| **Make** | MCP support; NL scenario builder | No | Visual, cheaper than Zapier |
| **Raycast** (Mac) | MCP via @mention | n/a | Best Mac capture front-end: floating notes, clipboard history, AI |
| **Alfred** (Mac) | No AI/MCP | n/a | Lightweight, one-time pay, but no AI/MCP |

### Build vs Buy vs Integrate — shortlist for you

You already own the hard part (a file-based MCP task server + a personal agent). **Integrate around what exists; don't replace it.** `mcp-agent-tasks` is the system of record; the gaps are (1) a human-readable surface, (2) artifact/doc memory, (3) capture + auto-routing, (4) surfacing/scheduling.

**INTEGRATE (highest leverage, lowest cost):**
1. **Obsidian + `cyanheads/obsidian-mcp-server`** — human-facing markdown surface over the same plain-text files. *#1 recommendation.*
2. **`doobidoo/mcp-memory-service`** *or* **Pieces** — bolt-on MCP memory for "docs/artifacts made for you" (knowledge-graph self-host vs zero-effort passive dev capture).
3. **n8n (self-hosted)** — the glue: capture inboxes → LLM classify/route → `task_create` on the right prefix → daily surfacing.

**BUILD (small, you're positioned for it):**
4. An **LLM auto-router** capture step — you already have prefixes + `routeProject`. The GTD-triage pattern (propose → human review → execute) is the proven shape. Thin layer, not a new product.

**BUY (only if a specific pain dominates):**
5. **Tana** (~$10/mo) — the one commercial tool whose graph/supertag model + working MCP could *augment* your system as a structured thinking surface.
6. **Motion / Sunsama** — only if "when do I actually do these" is the real bottleneck; neither is MCP-native (sits beside, not inside).

**AVOID for this MCP-first user:** Rewind (dead), Amplenote (no MCP), Alfred (no MCP). Notion is fine as an optional mirror only.

**Reference architectures to study:** `Jose0213/cortex-core` and `khoj` — both validate the exact pattern you're already on (markdown skills + MCP tools + layered memory + multi-channel) and show what "done" looks like.

---

## Source index

Methodology: Forte Labs (PARA, BASB, Intermediate Packets), FacileThings (Why GTD Fails, Weekly Review), Super Productivity (context switching, GTD inbox), On the Agile Path (dual engine), Ness Labs (productivity porn), The Good Space / Courage To Be Therapy / ADDitude (ADHD & Zeigarnik), Morgen (ADHD apps, AI task managers), Waqas Gondal (dev daily notes).

Tools: Tana docs, Notion MCP, coddingtonbear/obsidian-local-rest-api, khoj-ai/khoj, doobidoo/mcp-memory-service, cyanheads/obsidian-mcp-server, flepied/second-brain-agent, Jose0213/cortex-core, Pieces, Screenpipe, n8n vs Zapier vs Make comparisons, Raycast MCP guides.
