# Life OS Dashboard — Design Brief

> Research-backed design direction for extending serve-ui into the daily operating surface.
> Based on analysis of Sunsama, Akiflow, Linear, Super Productivity, Glance, and
> real-user research from Reddit/HN/Capterra. Compiled 2026-05-28.

---

## The one finding that explains every failed Notion/Obsidian attempt

> "Dashboards are only *artifacts*, while improvements are driven by *process*."
> — refactoring.fm

Every tool you've built a dashboard in failed for the same structural reason: the content only changes when you update it. By week 2 it's stale, you stop trusting it, you stop opening it. This is predictable, documented decay — not a personal failing.

The tools people actually use daily have at least one section that **updates without user input** (live task feed, CI status, recent artifacts, GitHub activity). That's the "alive" signal. Build that in from day one.

---

## What makes a daily dashboard stick (research-backed)

From Sunsama teardowns, Akiflow Capterra reviews (4.7/5, 106 reviews), Linear UX analyses, and self-hosted dashboard communities:

### 1. It has to be in the path, not off the path

**Set it as your browser's new tab page.** Every self-hosted dashboard that became a daily driver in the research (Glance, Heimdall, Homepage) was set as the browser homepage or new-tab override. Tools that require deliberate navigation consistently got abandoned. This is not a nice-to-have.

### 2. The commit mechanism IS the product

Sunsama's "stickiness" is not its UI — it's the **morning planning ritual** where you explicitly commit to 3–5 tasks before the day starts. The software enforces this. Users who skip the ritual get nothing from the tool. Users who don't skip it report "I wake up with confidence because I know what's coming."

Your dashboard needs a **commit step**: show all candidate tasks from all projects, require explicit selection of today's 3–5 items, then switch to "working mode." The list without the commit is just decoration.

### 3. Show capacity — make overcommitment visible

Sunsama's #1 user-cited feature: the **workload warning** that shows "you'll finish at 8:30 PM if you commit to these tasks." The moment you see that, you drop one task. This happens at 9 AM instead of 6 PM when you've already failed. Show the total estimated time for committed tasks. Turn it red above your daily target. This single feature changes behaviour.

### 4. Sub-200ms capture or it won't be used

The gap between "I had a thought" and "it's captured" must be under 200ms or the user will "hold it in their head" (which means forget it). Drafts, Raycast floating notes, and Akiflow's command bar all achieve this. For a browser dashboard, that means:
- **One global keyboard shortcut** that opens a floating capture input without navigating away
- **No routing decisions at capture time** — text, Enter, done
- **Visible confirmation** — a brief "captured" flash so you trust it went somewhere
- Routing, project assignment, priority — all deferred to the daily planning step

### 5. At least half the content must change without user input

The "alive vs stale" distinction. Glance (the most-used self-hosted dashboard in the research) stays open as a browser homepage because RSS/GitHub/HN change overnight. You open it and there's new information.

For your dashboard: recent captures, recent artifacts created across projects, GitHub PR/issue feed, and today's completion progress (2/5 done → 3/5 done as you work) all change without user action. Static task lists don't.

---

## Recommended layout

Based on what works in the research tools, not what looks impressive in screenshots:

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Global capture bar]   ____________________________________  [Enter] │
│  or: Ctrl+Space → floating input from anywhere                       │
├──────────────────────┬──────────────────────────────────────────────┤
│  TODAY (committed)   │  NEXT (candidate queue)                       │
│                      │                                               │
│  ☐ Task A  [client]  │  From: MCPAT (3)  COND (2)  GEN (5)         │
│  ☐ Task B  [personal]│  - task x                                    │
│  ☑ Task C  [done]    │  - task y                                    │
│                      │  - task z  ...                               │
│  ──────────────────  │                                               │
│  3h est / 4h avail   │  [drag or click → commit to today]           │
│  [capacity: OK ✓]    │                                               │
├──────────────────────┴──────────────────────────────────────────────┤
│  RECENT ARTIFACTS   (created in last 30 days, sorted by staleness)  │
│  citation-pack.html [client]  28d unvisited  [open] [link to task]  │
│  mobility-audit.md  [client]  12d unvisited  [open]                 │
│  MCPAT-020-spec.md  [MCPAT]   1d   [open]                           │
├─────────────────────────────────────────────────────────────────────┤
│  LIVE FEED  (auto-updates, no user input needed)                     │
│  GitHub: 2 PRs awaiting review  •  1 build failing                  │
│  Captured today: 3 items  •  Weekly: 12 items → 8 in progress       │
└─────────────────────────────────────────────────────────────────────┘
```

The layout intentionally:
- Opens in "commit mode" — you see candidates and today's slots together, forcing a decision
- Keeps capture always visible (never navigate away to capture)
- Shows live data (artifacts, GH feed) so opening it gives new information even on low-task days
- Has no project-manager complexity — no boards, no sprints, no columns

---

## The capture box — exact UX

From the Drafts / Raycast / Akiflow research, the pattern that works:

- **Accessible from anywhere**: one keyboard chord (`Ctrl+Space` or `/`) drops a floating overlay without leaving the current context
- **No required fields**: just text. Enter commits it. Zero friction.
- **Optional inline routing**: `#mcpat` or `#client` prefix routes to a project; no prefix → GEN inbox
- **Visible confirmation**: a 500ms "Captured ✓" flash with the project it landed in
- **Smart suggestions** (v2): as you type, show matching project names so you can tab-complete `#mob` → `#mobility-scooters`

The daily planning step (morning mode) is where you process the inbox, not the capture step. Keep these completely separate in the UI.

---

## Artifacts panel — the citation-pack.html fix

The specific problem: Claude made `citation-pack.html` for you, it's useful, you don't remember where it is or what's in it.

The fix is a `recently created / recently modified` artifact feed, not a search. What the research shows works:

- Surface files *created* in the last 30 days (not just recently visited — visit-based misses things you made and never reopened)
- Sorted by **time since last opened** — files you opened recently are fine, files you haven't touched in 3 weeks need your attention
- Show: filename, project, creation date, last-opened date, a "28d unvisited" staleness badge past a threshold
- Link directly: `[open file]` + `[link to task]` if a task references this file in its frontmatter
- Not a search UI — this is a push surface ("here's what you made that you might be forgetting")

Implementation path: mcp-agent-tasks already stores `spec_file` references in task frontmatter. Extend that to track arbitrary artifacts. Or maintain a lightweight `artifacts/` index (`artifact_id, path, project, created_at, last_opened_at`) that hooks write to when files are created (passive-capture already fires on Write/Edit — it can log to the artifact index).

---

## What to build and in what order

**Prerequisite (do these first — the specs already exist):**
1. Fix capture pipeline (SPEC-capture-pipeline-fix.md) — so captures land
2. Fix serve-ui aggregation (SPEC-serve-ui-aggregation.md) — so all projects show

**Then extend serve-ui into the life-OS view:**

**Phase A — Minimum viable daily driver (days, not weeks):**
- Global keyboard shortcut → floating capture input (no routing required)
- "Today" committed task list + candidate queue from all aggregated projects
- Capacity gauge (total estimate vs daily target, colour signal)
- Set as new-tab page

**Phase B — Artifacts panel:**
- `artifacts/` index written by passive-capture on every Write/Edit
- "Recent artifacts" panel: filename, project, staleness badge, direct open link
- Filter to last 30 days; sort by time-since-last-opened

**Phase C — Live feed:**
- Recent captures (today's inbox items, unprocessed)
- GitHub PR/issue feed (CI status, PRs awaiting review)
- Weekly completion rate (self-trust signal)

**Phase D — Morning ritual mode:**
- Guided planning prompt: "You have 7 unscheduled items from yesterday. Which 3 go in today?" 
- Workload warning before the day starts
- Shutdown ritual: mark incomplete items as carry-forward or defer

---

## What to NOT build

- **A full project management tool.** You already have task management (mcp-agent-tasks). This is a *view* over it, not a replacement.
- **Another Notion clone.** No nested pages, no block editor, no databases. Single-purpose daily surface.
- **A calendar integration in phase A.** Add it only if time-blocking becomes the bottleneck — don't front-load the complexity.
- **AI auto-routing in phase A.** Keyword/prefix routing is enough at first. LLM classification is a phase B addition once the basics are working.

---

## Key sources

- [Sunsama daily planning — The Sweet Setup teardown](https://thesweetsetup.com/how-to-startup-and-shutdown-your-day-with-sunsama/)
- [Akiflow command bar — Capterra reviews (4.7/5)](https://www.capterra.com/p/232035/Akiflow/reviews/)
- [Your dashboards are probably doomed — refactoring.fm](https://refactoring.fm/p/your-dashboards-are-probably-doomed)
- [I tried multiple self-hosted dashboards — XDA (Glance)](https://www.xda-developers.com/i-tried-multiple-self-hosted-dashboards-but-glance-is-better/)
- [Drafts quick capture — The Sweet Setup](https://thesweetsetup.com/quick-capture-with-drafts/)
- [Notion is where productivity goes to die — ILIKEKILLNERDS (Jan 2026)](https://ilikekillnerds.com/2026/01/20/notion-is-where-productivity-goes-to-die/)
- [Linear My Issues UX — Eleken case study](https://www.eleken.co/blog-posts/linear-app-case-study)
- [Super Productivity — developer productivity](https://super-productivity.com/use-cases/developer-productivity/)
