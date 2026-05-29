# Life OS Dashboard — Design Spec for Claude Design

**Stack:** React 18 · TypeScript · TanStack Query · Tailwind CSS · Vite  
**Context:** Personal developer dashboard, runs on localhost, set as browser new-tab page.  
**Goal:** Replace Notion/Obsidian. One surface to see/capture/dispatch/query everything. Must feel like Linear or Raycast — not like a side project.

---

## What was already tried and abandoned

Notion → abandoned because structure-before-content: every capture requires a navigation decision.  
Obsidian → abandoned because blank-slate cognitive overhead: unlimited flexibility, no opinionated defaults.  
**The pattern:** anything that asks "where does this go?" at capture time gets abandoned.

---

## What this app actually does (all functionality to surface)

### Data & state available via API

| Endpoint | What it returns |
|---|---|
| `GET /api/today` | Tasks committed to today (`scheduled_for == today`), grouped by area; unscheduled candidates; capacity (committed minutes vs target) |
| `POST /api/tasks/:id/schedule` | Commit a task to a specific date or clear it |
| `GET /api/tasks` | All tasks across all projects/areas |
| `GET /api/projects` | Registered projects with prefix + area label |
| `GET /api/stats` | Cross-project counts |
| `GET /api/activity` | Recent task status transitions |
| `GET /api/artifacts` | Files Claude created/edited in last 30 days, sorted by staleness |
| `POST /api/artifacts/opened` | Mark an artifact as viewed |
| `POST /api/capture/quick` | Instant single-line task to GEN inbox |
| `POST /api/capture/braindump` | Submit multi-line text → returns inferred candidate tasks (title, project, area, why) |
| `POST /api/capture/commit` | Commit reviewed candidates as real tasks |
| `POST /api/acr/dispatch` | Send a job to the autonomous agent machine (ACR) |
| `GET /api/acr/status` | ACR job queue: pending/running/done/failed |
| `GET /api/brain/search?q=` | Semantic search over personal knowledge base |
| `GET /api/milestones` | Project milestones and progress |
| `GET /api/config` | Project list, area map, config |

### Task fields (data model)
- `id`, `title`, `status` (queued / in_progress / done / blocked / cancelled)
- `priority` (critical / high / medium / low)
- `area` (client / personal / outsource / internal)
- `project` (prefix string, e.g. MCPAT, COND, HRLD, GEN)
- `scheduled_for` (YYYY-MM-DD or null — "committed to today")
- `estimate_hours` (optional)
- `why` (optional rationale)
- `tags`, `parent`, `children`, `dependencies`, `git` (commits, branch, PR)
- `spec_file`, `plan_file` (linked docs)

### External integrations (graceful offline degradation)
- **ACR** (`localhost:3001`) — autonomous agent platform; create jobs, view status
- **Brain** (`localhost:8093` or VPS via Tailscale) — semantic knowledge search
- **mcp-bridge-tasks** (VPS port 8091) — feeds the nash-ai Telegram morning briefing
- **Voice** (`/api/transcribe`) — Groq Whisper STT, pipes into brain dump panel

---

## The four problems the UI must solve

1. **What do I work on today?** — single authoritative answer, not a list to scan
2. **I had a thought — where does it go?** — capture in under 2 seconds, zero routing decision
3. **Claude made me something — where is it?** — artifact panel surfaces it before it's forgotten
4. **What are my agents doing?** — ambient status, not interruptive

---

## Information hierarchy

**Primary (above the fold, zero clicks):**
- Today's committed tasks (the list, sorted by priority)
- The one task currently in_progress (high visual weight — this is "the thing")
- Capacity gauge (committed hours vs target — turns red when overloaded)
- Global capture input (always visible, lowest friction entry point)

**Secondary (one click/tab):**
- Candidate queue (unscheduled tasks to commit to today)
- Artifacts panel (recently created files, staleness badges)
- Brain dump panel (multi-line capture with LLM decomposition)

**Ambient / tertiary (background, right side, low visual weight):**
- ACR agent job status (colored dots, not text)
- Brain search input
- Project/area stats
- Recent activity feed

---

## Layout

**Three-column layout on wide screens (≥1200px):**

```
┌────────────────────────────────────────────────────────────────────┐
│  [Global capture bar — always visible at top]                      │
├──────────────┬─────────────────────────────┬───────────────────────┤
│  LEFT NAV    │  MAIN CONTENT               │  RIGHT PANEL          │
│  (200px)     │  (flex, fills center)       │  (280px)              │
│              │                             │                       │
│  Today  ←    │  Today view (default)       │  ACR status           │
│  Board       │  · In-progress task         │  Brain search         │
│  Brain Dump  │  · Committed list           │  Recent activity      │
│  Artifacts   │  · Capacity gauge           │  Artifacts (preview)  │
│  Roadmap     │  · Candidate queue          │                       │
│  Activity    │                             │                       │
└──────────────┴─────────────────────────────┴───────────────────────┘
```

**Tablet (768–1199px):** Collapse right panel into a bottom drawer; left nav becomes icon-only with tooltips.

**The left nav** should be dimmed — 30-40% visual weight relative to content. Navigation present, not competing. Follow Linear's principle: "structure should be felt, not seen."

---

## Global capture bar

Always visible at the top of every view. Single text input, full width minus the right panel.

**Behavior:**
- `Ctrl+Space` from anywhere focuses it (even if browser is in background via browser extension, or just within the app)
- Type text, press `Enter` → instant write to GEN inbox, "Captured ✓" flash for 500ms, field clears
- Type `#prefix` (e.g. `#mcpat`) → autocomplete dropdown from project list, routes explicitly
- No other fields required at capture time — priority, area, estimate all come later
- Right of the input: a mic button for voice capture (Groq Whisper → fills brain dump panel)

**The cardinal rule: never ask where it goes at capture time.** Empty string is never valid; everything else is.

---

## Today view (main content, default)

### In-progress task (hero element)
If any task has `status == in_progress`, show it at the top with heavy visual weight:
- Large title (18–20px)
- Project + area badges
- Time elapsed since claimed (if available)
- Quick actions: Mark done, Pause (→ queued), Block (→ blocked with reason input)

If nothing is in progress: "Nothing in progress — pick one from today's list."

### Committed tasks list
Tasks where `scheduled_for == today`, sorted by priority.  
Row height: 40px. Per row show:
- Status dot (coloured)
- Title (15px, truncated at ~60 chars)
- Project prefix badge (2–4 chars, muted)
- Area chip (client / personal / outsource / internal — small coloured dot, no text unless hovered)
- Priority indicator (left border color or small icon)
- Estimate (e.g. "2h") if set
- Right-click or `…` menu: Remove from today, Mark done, Open detail, Send to ACR

`Space` on a row: peek panel slides in from the right (non-navigating — list remains visible). Shows full title, why, spec_file link, git branch/PR links, status history. `Escape` closes.

Click on a row: full detail panel slides in from right, replacing the right ambient panel. `Escape` to return.

### Capacity gauge
Below the in-progress task, above the committed list.
- A single horizontal bar: filled portion = committed estimate / daily target
- Green: ≤80% of target
- Amber: 80–100%  
- Red: >100%
- Label: "4h 20m / 6h committed" — always show both numbers
- Target is editable inline (click the target number)

### Candidate queue
Collapsed by default below the committed list. "▸ N unscheduled tasks" expands it.  
When expanded: same row design as committed list, but with a "+" button to commit to today. One click, instant — no confirmation needed.

Group by area (client / personal / outsource / internal) with collapsible headers.

---

## Brain dump panel (second tab in left nav)

A full main-content panel, not a modal.

**Input zone:**
- Large `<textarea>` — at least 8 rows, no border, subtle background
- Placeholder: "Write anything. Tasks, ideas, worries, plans. Cmd+Enter to process."
- Voice button (mic icon, top-right of textarea): records, transcribes via `/api/transcribe`, appends text
- Process button: primary CTA, `Cmd+Enter` keyboard shortcut

**Processing state:** Progress indicator inside the panel — "Parsing 3 tasks from your dump…". Max 60s. Textarea content preserved during processing.

**Candidate review:**
Once candidates return, replace the textarea with a list of candidate cards.
Each card:
- Editable title (auto-focused on first card)
- Project dropdown (select from registered projects)
- Area selector (4 chips: client / personal / outsource / internal)
- Optional "Why" toggle (collapsed by default, expand to add rationale)
- Two action buttons: **Create task** (green) | **→ ACR** (send to autonomous agent, greyed if ACR offline)
- Discard button (×)

Top of the candidate list: **"Create all N tasks"** bulk action.

If LLM parsing failed: show "Couldn't parse this — here's your text back." with the raw content preserved. Never lose the user's input.

After all candidates resolved: clear panel, show "N tasks created" confirmation, offer "Dump again" to reset.

---

## Artifacts panel (third tab)

A list of files Claude created or edited, showing what you might have forgotten.

**Header:** "Artifacts — last 30 days · N files · M unvisited"

**Each row:**
- File icon (by extension — .html, .md, .ts, .json etc)
- Filename (bold)
- Path (muted, truncated, shown in full on hover as tooltip)
- Project badge
- **Staleness badge:** green "3d" / amber "14d" / red "28d" — days since last viewed
- Copy path button (clipboard icon) — file:// links are browser-restricted, so copy is the right action
- Link icon if the artifact has an associated task (`task_id`) — clicking navigates to that task

**Sort:** Always staleness-first (oldest-viewed at top). This is the whole point — surface what's being forgotten.

**Empty state:** "No artifacts yet. They'll appear here automatically whenever Claude creates or edits files for you."

---

## Right ambient panel

Always visible on wide screens. Three sections, separated by subtle dividers.

### ACR status
Header: "Agents" + a single dot (green if any running, grey if all idle, red if any failed).

Show up to 5 jobs:
- Job title (truncated)
- Status chip: pending (grey) / running (blue, pulsing dot) / done (green) / failed (red)
- Time elapsed for running jobs

If ACR offline: grey "ACR offline" with a small ○ indicator. No error, just state.

Click any job → slide-in detail panel with full job info.

### Brain search
Header: "Knowledge"
A single search input. 400ms debounce. Shows up to 5 results inline:
- Result title
- Snippet (first 120 chars)
- Source label

"Brain unavailable" label if bridge unreachable.

### Recent activity
Last 5 task transitions across all projects:
- Task title
- "→ in_progress", "→ done", etc.
- Time ago ("3m", "1h")

---

## Command palette (`Cmd+K`)

Opens center-screen. Shows 5 items at a time.

**Default state (no query):** Recently used commands + context-aware suggestions based on current view.

**Categories:**
- Navigate: "Go to Today", "Open Board", "Open Artifacts"
- Create: "Quick capture", "Open Brain Dump", "New task in [current project]"
- Act on selected task (if one is focused): "Mark done", "Commit to today", "Send to ACR", "Open in Brain Dump"
- Search: fuzzy match against task titles, artifact filenames

Keyboard: `↑↓` to navigate, `Enter` to execute, `Escape` to close.

---

## Keyboard shortcuts

Follow the muscle-memory vocabulary developers already have:

| Key | Action |
|---|---|
| `Ctrl+Space` | Focus global capture bar |
| `Cmd+K` | Command palette |
| `J` / `K` | Navigate task list up/down |
| `Space` | Peek at focused task (slide-in, non-navigating) |
| `Enter` | Open focused task detail |
| `Escape` | Close panel / dismiss overlay |
| `D` | Mark focused task done |
| `P` | Cycle priority |
| `T` | Commit focused task to today (or remove) |
| `Cmd+Enter` | Submit brain dump |

---

## Design system

### Colours (dark mode first — this is a dark product)

```
Background:    #09090B   (not pure black — slightly warm dark)
Surface-1:     #111113   (cards, panels)
Surface-2:     #18181B   (hover, inputs)
Surface-3:     #27272A   (borders, dividers — hairline at 1px)

Text-primary:  #FAFAFA
Text-secondary:#A1A1AA
Text-muted:    #71717A

Accent:        #0070F3   (primary action only — used sparingly)
Accent-hover:  #0062D6

Status-red:    #EF4444
Status-amber:  #F59E0B
Status-green:  #22C55E
Status-blue:   #3B82F6 (running/in-progress)

Area-client:      #F59E0B  (amber)
Area-personal:    #22C55E  (green)
Area-outsource:   #8B5CF6  (purple)
Area-internal:    #6B7280  (grey)
```

### Typography

Font stack: `"Inter var", "Inter", -apple-system, sans-serif`
Monospace: `"Geist Mono", "JetBrains Mono", ui-monospace, monospace`

Enable on Inter: `font-feature-settings: "ss03", "calt", "kern", "liga"` — this is what makes Inter look like a premium tool font instead of a default one.

| Element | Size | Weight | Color |
|---|---|---|---|
| In-progress task title | 18px | 600 | text-primary |
| Task title (list) | 14px | 500 | text-primary |
| Project badge | 11px | 600 | text-muted, uppercase |
| Metadata (estimate, area) | 12px | 400 | text-secondary |
| Section header | 11px | 600 | text-muted, uppercase, tracked |
| Timestamps | 12px | 400 | text-muted, monospace |
| Capacity numbers | 13px | 500 | contextual (green/amber/red) |

### Spacing
4px base unit. All measurements multiples of 4.

- Card padding: 12px
- Row padding: 8px vertical, 12px horizontal
- Section gap: 24px
- Panel internal padding: 16px
- Page margins: 24px

### Components

**Badges / chips:** `px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide`  
**Status dot:** 8px circle, colored. Pulsing animation (CSS `animate-pulse`) for running state only.  
**Border radius:** 6px (cards), 4px (inputs, badges), 8px (modals/drawers)  
**Borders:** 1px `Surface-3` (`#27272A`) — hairline only. No heavy dividers.  
**Shadows:** None on functional UI. Elevation through slightly lighter surface color.

### Transitions
- Panel slide-in: `transform 200ms cubic-bezier(0.16, 1, 0.3, 1)` (spring-like)
- Toast appear: `opacity 150ms ease, transform 150ms ease`
- Hover states: `background 100ms ease`
- No transitions over 250ms on interactive elements (feels sluggish)

---

## Anti-patterns to avoid (from research)

- ❌ Asking "where does this go?" at capture time
- ❌ More than 5 simultaneously-updating widgets
- ❌ Status as text (should be color-coded dots/chips)
- ❌ Modals for detail views (use slide-in panels)
- ❌ Navigation at equal visual weight to content
- ❌ Gradients on functional UI (marketing only)
- ❌ Different font weights as the primary hierarchy tool (use space and color)
- ❌ Tabs that navigate away and lose list context (use peek panels)
- ❌ Truncated task titles in the in-progress hero element
- ❌ Empty command palette on open (show recent/contextual suggestions)

---

## What "done" looks like

A developer opens a new tab → Today view loads in under 500ms → they can see what they committed to, the capacity bar is green, and ACR has two jobs running (blue dots). They had a thought: `Ctrl+Space`, three words, `Enter`, flash "Captured ✓", back to work. Later they wonder what that HTML file was Claude made last week: Artifacts tab, red "21d" badge, one click copies the path. That's the loop. Nothing required going to another tool.

---

## Files to modify (for the implementer)

All UI code lives in `C:\code\mcp-agent-tasks\src\ui\src\`. Key files:

- `App.tsx` — routing, global keyboard listeners, layout shell
- `views/TodayView.tsx` — today view (rebuild from scratch)
- `views/BrainDumpView.tsx` — brain dump panel
- `views/ArtifactsView.tsx` — artifacts panel
- `components/LiveFeedSection.tsx` — right ambient panel (ACR + brain search + activity)
- `components/CaptureOverlay.tsx` — global capture overlay
- `components/TaskCard.tsx` — task row component
- `components/CandidateCard.tsx` — brain dump candidate card
- `index.css` — global styles, Tailwind config
- `tailwind.config.js` — extend with the color tokens above
