# Handoff: Life OS — UI Reskin + Agent Layer

> **Target stack:** React 18 · TypeScript · TanStack Query · Tailwind CSS · Vite
> **Target codebase:** `C:\code\mcp-agent-tasks\src\ui\src\`
> **Runs as:** a localhost browser new-tab page (personal developer dashboard)

---

## 1. Overview

Life OS is a single-surface personal dashboard for a developer running several projects (client + internal + personal). It must answer four questions with near-zero friction:

1. **What do I work on today?** — one authoritative answer, not a list to scan.
2. **I had a thought — where does it go?** — capture in <2s, zero routing decision.
3. **Claude/agents made me something — where is it?** — surface artifacts before they're forgotten.
4. **What are my agents doing?** — ambient status, never interruptive.

This handoff covers two stages:

- **Phase 1 — Reskin.** Rebuild the existing views (`Today`, `Brain Dump`, `Artifacts`, plus `Board`, `Roadmap`, `Activity`) and shell to match the new visual system. Mostly wires to **existing** API endpoints.
- **Phase 2 — Additional features.** Global filtering, project favourites, capture→Brain-Dump handoff, command palette, and the **Hermes** agent layer (triage + automation flywheel + ACR dispatch). Introduces **new** client state and a few **new** endpoints.

Do Phase 1 first and ship it; the app is fully usable after Phase 1. Phase 2 is additive.

---

## 2. About the design files

The files in `reference/` are **design references built in HTML/React-via-Babel** — a working prototype that shows the intended look, motion, and behaviour. **They are not production code to copy.** Recreate them in the target codebase using its real stack and established patterns (React 18 + TypeScript components, TanStack Query for server state, Tailwind utility classes against the token config below, Vite).

Open `reference/Life OS.html` in a browser to interact with the prototype. The prototype uses an in-memory mock (`reference/data.js`) in place of the real API — replace every mock read/write with the corresponding TanStack Query hook (§9).

**Fidelity: high.** Colors, type, spacing, radii, and motion are final. Match them pixel-for-pixel. Where the prototype hard-codes mock data, use the real endpoints.

### Reference screenshots (`screenshots/`)

High-res captures of each surface as built. Use them as the visual target alongside the live prototype:

| File | View |
|---|---|
| `01-today.png` | Today — hero, capacity gauge, committed list, candidate queue, filter bar, right ambient panel |
| `02-hermes.png` | Hermes — control header, triage buckets, venue-aware run buttons, "ACR" access chip |
| `03-board.png` | Board — 4-column kanban |
| `04-braindump.png` | Brain Dump — capture textarea + toolbar |
| `05-artifacts.png` | Artifacts — staleness-sorted file list |
| `06-roadmap.png` | Roadmap — milestone cards |
| `07-activity.png` | Activity — transition timeline |

---

## 3. Design tokens

Dark-first. Hairline borders only. Color carries status; **space + color** carry hierarchy (not font weight). No gradients, no shadows on functional UI — elevation comes from a slightly lighter surface. The full token set lives in `reference/styles.css` `:root`. Port it to `tailwind.config.js` + a small `index.css` base layer.

### Colors

| Token | Hex | Use |
|---|---|---|
| `bg` | `#09090B` | App background (warm near-black) |
| `surface-1` | `#111113` | Cards, panels |
| `surface-2` | `#18181B` | Hover, inputs, chips |
| `surface-3` | `#27272A` | **Borders/dividers — 1px hairline only** |
| `text` | `#FAFAFA` | Primary text |
| `text-2` | `#A1A1AA` | Secondary |
| `muted` | `#71717A` | Muted |
| `muted-2` | `#52525B` | Faint (timestamps, counts) |
| `accent` | `#0070F3` | Primary action **only**, used sparingly |
| `accent-hover` | `#0062D6` | |
| `red` | `#EF4444` | blocked / over-capacity / failed |
| `amber` | `#F59E0B` | warning / client area / 80–100% capacity |
| `green` | `#22C55E` | done / healthy / ≤80% capacity |
| `blue` | `#3B82F6` | in-progress / running |
| `area-client` | `#F59E0B` | area dot |
| `area-personal` | `#22C55E` | area dot |
| `area-outsource` | `#8B5CF6` | area dot |
| `area-internal` | `#6B7280` | area dot |

Accent is **theme-able at runtime** in the prototype (`--accent` set on `:root`). In production, expose it as a CSS var (`--accent`) and a Tailwind color that reads it, so a settings toggle can swap it. Curated options used: `#0070F3` (default), `#7C5CFF`, `#F0653A`, `#2BD4A8`.

Use `color-mix(in srgb, var(--accent) 16%, transparent)` for "accent-soft" fills (selection rings, soft badges). Status "soft" backgrounds are the status color at 13–16% over transparent.

### Typography

- **Sans:** `"Geist"` → fallback `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- **Mono:** `"Geist Mono"` → fallback `ui-monospace, "SF Mono", monospace` (IDs, timestamps, counts, numeric stats — always `font-variant-numeric: tabular-nums`)
- Load Geist + Geist Mono (weights 400/450/500/600/700) via Google Fonts or self-host.
- An `Inter` fallback theme exists in the prototype (toggle); ship Geist as default.

| Element | Size | Weight | Color |
|---|---|---|---|
| In-progress hero title | 19px (24px in "bold" variant) | 600 | text |
| View `<h1>` | 19px | 600 | text, `-0.02em` tracking |
| Task title (row) | 14px | 450–500 | text |
| Section label | 11px | 600 | muted, **uppercase, 0.07em tracking** |
| Project prefix badge | 11px mono | 600 | muted, uppercase |
| Metadata (estimate/area) | 12px | 400–500 | text-2 / muted |
| Timestamps | 11–12px mono | 400 | muted-2 |
| Capacity numbers | 13px mono | 500 | contextual (green/amber/red) |

### Spacing · radii · motion

- **4px base unit**; all spacing a multiple of 4. Card padding 12–16px, row 8/12 (v/h), section gap 24px, page pad 24px, panel pad 16px.
- **Radii:** cards 8px, inputs/badges 6/4px, modals/drawers 12px, pills 999px.
- **Row height:** 40px default (`compact` 34px, `airy` 46px — density is a runtime toggle driven by `[data-density]`).
- **Motion** (`--ease-spring: cubic-bezier(0.16, 1, 0.3, 1)`):
  - Panel slide-in: `transform 200–220ms` spring. **Transform only — never animate opacity to a hidden state** (offscreen tabs freeze CSS animations at frame 0; an opacity-0 start can stick and blank the content). Learned this the hard way in the prototype.
  - Toast/flash: 150ms ease.
  - Hover: `background 100ms ease`.
  - Nothing over 250ms on interactive elements.
  - `animate-pulse`-style ring only on **running** status dots and the live "now" indicator.

### Suggested `tailwind.config.js`

```js
// tailwind.config.js
export default {
  darkMode: 'class', // app is always dark; keep class for safety
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#09090B',
        surface: { 1: '#111113', 2: '#18181B', 3: '#27272A' },
        ink: { DEFAULT: '#FAFAFA', 2: '#A1A1AA', muted: '#71717A', faint: '#52525B' },
        accent: { DEFAULT: 'var(--accent, #0070F3)', hover: 'var(--accent-hover, #0062D6)' },
        status: { red: '#EF4444', amber: '#F59E0B', green: '#22C55E', blue: '#3B82F6' },
        area: { client: '#F59E0B', personal: '#22C55E', outsource: '#8B5CF6', internal: '#6B7280' },
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '8px', input: '6px', badge: '4px', drawer: '12px' },
      transitionTimingFunction: { spring: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    },
  },
};
```

```css
/* index.css base layer */
:root { --accent: #0070F3; --accent-hover: #0062D6; }
html { color-scheme: dark; }
body {
  background: #09090B; color: #FAFAFA;
  font-family: Geist, system-ui, sans-serif;
  font-feature-settings: "ss03", "calt", "kern", "liga"; /* makes Geist/Inter feel like a tool font */
}
```

---

## 4. App architecture & layout shell

**File:** `App.tsx` — routing, global keyboard listeners, layout grid.

Three-column CSS grid, full viewport, `overflow: hidden` on the shell:

```
grid-template-columns: 216px 1fr 296px;   /* nav | main | ambient */
grid-template-rows: 52px 1fr;             /* capture bar spans all cols */
grid-template-areas: "capture capture capture"
                     "nav main ambient";
```

- All three columns get `min-width: 0` so long strings can't widen the grid.
- `main` is the only scroll region: `overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable;` (setting only `overflow-y` promotes `overflow-x` to `auto` and produces a phantom horizontal scrollbar — pin it hidden).
- `main-inner`: `max-width: 860px; margin: 0 auto; padding: 24px`.
- **Focus mode** (`.` key): collapse nav + ambient to width 0 (opacity→0, pointer-events none) so `main` gets the full width. Grid becomes `0 1fr 0`.
- **Left nav is deliberately dimmed** — ~30–40% visual weight vs content (muted text, active item = `surface-2` bg). "Structure felt, not seen."
- **Responsive:** ≥1200px = 3 columns. 768–1199px = collapse the ambient column into a bottom drawer; nav becomes icon-only with tooltips. (Prototype is desktop-first; implement the tablet rules with Tailwind breakpoints.)

**Routing:** the prototype uses a single `view` state string (`'today' | 'board' | 'agent' | 'braindump' | 'artifacts' | 'roadmap' | 'activity'`), persisted to `localStorage('lifeos-view')`. Use your router of choice (or keep simple state) — but persist the last view so a new tab restores it.

**Nav order** (left rail), each with a `1`–`7` number-key shortcut:
`Today (1) · Board (2) · Hermes (3) · Brain dump (4) · Artifacts (5) · Roadmap (6) · Activity (7)`.
Below nav: a **Favourites** group (Phase 2). Footer: ACR/Brain online dots + a "Search ⌘K" button.

---

## 5. Global keyboard shortcuts

Implement at the `App` level. Ignore key handling while typing in an input/textarea (except `Esc` = blur, and the global ones below which work everywhere).

| Key | Action |
|---|---|
| `Ctrl+Space` | Focus the global capture bar (works from any view) |
| `Cmd/Ctrl+K` | Toggle command palette |
| `1`–`7` | Jump to nav views |
| `J` / `K` / `↑` / `↓` | Move task selection on Today |
| `Space` | Peek panel for the selected task (non-navigating) |
| `Enter` | Open full detail panel for the selected task |
| `Esc` | Close panel / overlay / exit focus mode |
| `D` | Mark selected task done |
| `P` | Cycle selected task priority |
| `T` | Toggle "committed to today" on selected task |
| `Shift+Enter` (in capture bar) | Send typed text into Brain Dump, prefilled |
| `Cmd+Enter` (in Brain Dump) | Process the dump |
| `.` | Toggle focus mode |

---

# PHASE 1 — RESKIN

Rebuild these surfaces to match the prototype, wiring to the existing API. No new backend required.

## 6.1 Global Capture Bar — `components/CaptureOverlay.tsx`

Always visible, top, full width minus the brand block. Single text input.

- Left: brand block (`Life`**OS**, 22px accent square logo) sized to the nav width.
- Input row: `surface-1` bg, 1px `surface-3` border, radius 6px, 34px tall; border → accent on focus.
- Lead `+` glyph (muted) inside-left.
- Right cluster: a `Ctrl Space` kbd hint, an **expand** icon (→ Brain Dump, Phase 2), a **mic** button (voice capture).
- Placeholder: `Capture anything — Enter to save · ⇧Enter for Brain Dump · #project`.

**Behaviour:**
- `Enter` → `POST /api/capture/quick` with the text. Default routes to GEN inbox. Flash "Captured ✓" in green for ~600ms, clear the field. Empty string is never valid; everything else is. **Never ask where it goes.**
- Typing `#prefix` → autocomplete dropdown from `GET /api/projects` (filter by prefix or name). `↑/↓` to move, `Tab`/`Enter` to accept → routes to that project.
- `Ctrl+Space` from anywhere focuses it.
- Mic → records, `POST /api/transcribe` (Groq Whisper), result lands in Brain Dump (Phase 2) or appends.

## 6.2 Today view — `views/TodayView.tsx`

Default view. Data: `GET /api/today` (committed tasks grouped by area, unscheduled candidates, capacity). Order top→bottom:

### a) In-progress hero (`components/HeroTask.tsx`)
The single task with `status === 'in_progress'`. Highest visual weight. Three style variants exist in the prototype (`signal` = card with blue left accent bar — default; `calm` = borderless, just bigger type; `bold` = larger title, raised card). Ship `signal`; the others are optional toggles.

- "● In progress" eyebrow (blue, pulsing dot) + a **live elapsed timer** (mono, ticks every 1s from `claimed_at`).
- Title 19px/600, **never truncated**.
- Meta row: project badge, area chip, priority tag, `est 2h`, git branch.
- `why` rationale in a left-bordered block (hidden in `calm`).
- Actions: **Mark done** (primary), **Pause** (→ queued), **Block** (→ blocked, prompt for reason), **Open detail** (ghost, right-aligned).
- Empty state (nothing in progress): dashed card — "Nothing in progress — pick one from today's list, or press `J` then `Enter`."

### b) Capacity gauge (`components/CapacityGauge.tsx`)
Below the hero. `committed estimate-hours / daily target`. Three render styles (`bar` default, `segmented`, `ring`).
- Zones: green ≤80%, amber 80–100%, red >100% (the fill/label color follows the zone).
- Label always shows **both** numbers: e.g. `4h 45m / 6h committed` (mono, tabular-nums).
- Target is **inline-editable** — click the target number → number input → persist (prototype: `localStorage('lifeos-target')`; production: a user-setting endpoint or `GET/PUT /api/config`).
- Over 100%: red "Over target by … — consider deferring something."

### c) Committed list (`components/TaskCard.tsx` rows)
Tasks where `scheduled_for === today`, sorted by priority (done sink to bottom). 40px rows:
- **Status dot** (8–9px; colors per status; running has a soft ring).
- **Title** (14px, ellipsis ~60 chars).
- Meta cluster (right): priority tag (only critical/high shown as text), `est`, **area dot** (expands to a labelled chip on hover), **project prefix badge**, and a `…` menu (hover-revealed).
- **Priority** = a 2px colored left bar inside the row (critical=red, high=amber, medium=faint).
- Row states: hover = `surface-1`; selected (J/K) = `surface-2` + inset accent ring.
- `…` menu items: Commit/Remove today · Sign off to Hermes (P2) · Dispatch to ACR (P2) · Mark done · Open detail.

### d) Candidate queue (collapsible)
`▸ N unscheduled` toggle. When open, group by area (client/personal/internal/outsource) with small headers; each row has a `+` (commit-to-today) button — **one click, instant, no confirm**, and the row animates into the committed list.

### Interactions
- Click a committed row → **peek** panel (slide-in from right, list stays visible). `Space` on selected row does the same.
- `Enter` / click hero "Open detail" → **detail** panel (wider).
- Commit/uncommit, mark done, pause, block, cycle priority all optimistic-update via TanStack Query mutations against `POST /api/tasks/:id/schedule` etc.

## 6.3 Peek & Detail panels — `components/TaskPanel.tsx`

Slide-in from the right edge of `main` (absolute, not a modal — **never use a modal for detail**). Peek = 380px, Detail = 440px. `surface-1`, left hairline border, soft left shadow, `transform: translateX(26px)` spring-in (no opacity fade — see §3 motion note).

- Header: status dot, mono task ID, "Peek"/"Detail", close `×`.
- Body fields: title, area chip + priority + status badge + estimate; `Blocked` reason (red) if blocked; `Why`; **Linked docs** (`spec_file`, `plan_file` as file rows); **Git** (branch, commits, PR); **Status history** (detail only — `GET /api/activity`-style transitions); tags.
- Footer actions: Done · Commit/Remove today · **Hermes** · **ACR** (P2).
- Peek footer hint: `Enter` full detail · `Esc` close. `Esc` closes either.

## 6.4 Right ambient panel — `components/LiveFeedSection.tsx`

Always visible (≥1200px). Three sections separated by hairlines, low visual weight. Polls quietly.

1. **ACR** (header `Server` icon + "ACR · Agent Control Room" + a single status dot: green if any running, grey idle, red if any failed). Up to 5 jobs from `GET /api/acr/status`: title (truncated), elapsed for running jobs, a status chip (pending grey / running blue+pulsing dot / done green / failed red). Click a job → slide-in job detail (output stream, error). Offline → grey "ACR offline ○", no error.
2. **Knowledge** (`Brain` icon). One search input, **400ms debounce** → `GET /api/brain/search?q=`. Up to 5 results: title, 2-line snippet, source label (mono). Unreachable → "Brain unavailable".
3. **Recent activity** (`Activity` icon). Last ~6 transitions from `GET /api/activity`: status dot, task title, "→ done/in_progress/…", relative time. Click → open that task.

## 6.5 Brain Dump view — `views/BrainDumpView.tsx`

Full main-content panel (not a modal).

- Large `<textarea>` (≥8 rows, subtle `surface-1` bg, no hard border), placeholder "Write anything. Tasks, ideas, worries, plans. ⌘+Enter to process." Mic button top-right (Whisper). Char/line counter bottom-left. **Process** primary CTA (`⌘↵`).
- **Processing:** in-panel progress ("Parsing N tasks from your dump…"), textarea content preserved, max 60s.
- **Candidate review:** `POST /api/capture/braindump` returns inferred candidates `{title, project, area, why}`. Replace textarea with candidate cards (`components/CandidateCard.tsx`): editable title (first auto-focused), project `<select>`, 4 area chips, collapsible "Why", actions **Create task** (green) / **→ ACR** (greyed if ACR offline) / discard `×`. Top: **Create all N**. Commit via `POST /api/capture/commit`.
- **Parse failure:** "Couldn't parse this — here's your text back." with raw content preserved. **Never lose input.**
- **Done:** "N tasks created" + "Dump again" reset.

## 6.6 Artifacts view — `views/ArtifactsView.tsx`

`GET /api/artifacts` (files Claude created/edited in last 30 days, sorted by staleness). Header: "Artifacts — last 30 days · N files · M unvisited".
- Rows: file-type icon (color by extension: md/ts/tsx/html/json), filename (bold), path (mono, truncated, full on hover title), project badge, **staleness badge** (mono pill: green ≤7d / amber ≤21d / red >21d = days since last viewed), **copy-path** button (clipboard — `file://` is browser-blocked so copy is the right action; mark `POST /api/artifacts/opened`), and a **link** icon if `task_id` is set → navigates to that task.
- **Always staleness-first** (oldest-viewed at top) — that's the whole point.
- Empty: "No artifacts yet. They'll appear here automatically whenever Claude creates or edits files for you."

## 6.7 Board · Roadmap · Activity

- **Board** (`views/BoardView.tsx`): 4-column kanban (Queued / In progress / Blocked / Done) from `GET /api/tasks`. Cards: mono ID + priority tag, title, footer (area dot, estimate, "today" badge, agent badge P2). `grid-template-columns: repeat(4, minmax(0,1fr))`. Click → detail panel.
- **Roadmap** (`views/RoadmapView.tsx`): milestone cards from `GET /api/milestones` — project badge, title, due date (mono), progress bar (accent), item pills.
- **Activity** (`views/ActivityView.tsx`): vertical timeline of transitions from `GET /api/activity` — colored node per status, title, "→ status · Nm ago". Click → open task.

## 6.8 Command palette — `components/CommandPalette.tsx`

`Cmd+K`, centered overlay (`14vh` from top, 600px, scrim, spring-in). **Never open empty** — show recent/contextual commands.
- Categories in order: **Selected task** (if one is focused: Mark done / Commit / Sign off to Hermes / Dispatch to ACR / Open detail), **Create** (Quick capture, Open Brain Dump), **Navigate** (Go to each view, Focus mode), **Filter** (P2), **Tasks** (fuzzy over titles), **Artifacts** (fuzzy over filenames).
- Fuzzy match with subsequence scoring (bonus for word-start matches); highlight matched chars in accent. `↑/↓` move, `Enter` run, `Esc` close. See `fuzzy()` in `reference/shared.jsx`.

---

# PHASE 2 — ADDITIONAL FEATURES

Additive. Order: Filters → Favourites → Capture→BrainDump handoff (if not already done) → Hermes agent layer.

## 7.1 Global filter

One filter shared across **Today, Board, Artifacts, Roadmap, Activity**, persisted (`localStorage('lifeos-filter')`).

```ts
type Filter = { projects: string[]; areas: Area[] };
function matchFilter(f: Filter, project: string, area?: Area): boolean {
  if (f.projects.length && !f.projects.includes(project)) return false;
  if (f.areas.length) {
    const a = area ?? areaOfProject(project);
    if (!f.areas.includes(a)) return false;
  }
  return true;
}
```

- **`components/FilterBar.tsx`** rendered at the top of each filterable view: favourite quick-chips (P2 favourites), a **Filter** button → popover (projects list with checkbox + a star toggle each; area chips), removable active-filter chips, and a **Clear**.
- On **Today**, filtering narrows the committed list + candidate queue only. **Do not filter the hero or capacity** — "what I'm doing now" and "my whole day's load" are not project-scoped.
- Artifacts/Milestones/Activity have no `area` field — derive it from the project (`areaOfProject`). Activity items derive project from the task-ID prefix.
- Also expose filter actions in the command palette ("Filter by COND", "Clear all filters").

## 7.2 Favourites (pinned projects)

Persisted (`localStorage('lifeos-favs')`; or a user-setting endpoint). Starring a project (from the FilterBar popover) pins it to a **Favourites** group in the left nav (project prefix, area dot, live open-task count) **and** surfaces it as a one-tap quick-filter chip in every FilterBar. Clicking a pinned project toggles it in the global filter (filters the whole app). On Today that doubles as a per-project peek.

## 7.3 Capture → Brain Dump handoff

The capture bar's **expand** icon and **`Shift+Enter`** both carry the current text into Brain Dump (prefilled + focused, view switches to Brain Dump). Place an explicit affordance — don't rely on a hidden chord alone.

## 7.4 Hermes — the agent layer (`views/HermesView.tsx`)

This is the centrepiece. **Two distinct systems — keep them separate:**

- **Hermes** (a.k.a. nash-ai) = your **assistant**. He triages signed-off work and does most of it **himself** (builds n8n flows, drafts, researches, schedules). He has **knowledge of and access to ACR**.
- **ACR** (Agent Control Room, `localhost:3001`) = the autonomous **execution machine** for **software work**. It's the right-hand ambient panel. Hermes *decides per job* whether it's software that belongs on ACR, and if so **dispatches** it there.

So a "skill" has an **engine**: `'hermes' | 'n8n' | 'acr'`. Hermes runs `hermes`/`n8n` skills himself; for `acr` skills (and ad-hoc software tasks) he creates an ACR job that appears in the ACR panel, tagged as Hermes-dispatched.

### The sign-off gate (safety)
The agent **only ever touches tasks the user has explicitly handed it.** A task enters Hermes's queue via **"Sign off to Hermes"** (task `…` menu, detail/peek footer, command palette) — set `agent_status: 'scheduled'`. Likewise **"Dispatch to ACR"** is a separate explicit action (creates an ACR job directly). Nothing un-signed-off is ever actioned. A signed-off task shows a small robot badge on its Board card.

### Triage (`lib/triage.ts`)
For each signed-off task, Hermes classifies it into one bucket with a one-line rationale. The prototype uses a keyword classifier (`triage()` in `reference/agent.jsx`); in production this can stay heuristic or call an LLM, but the **bucket contract** is what the UI depends on:

| Bucket | Meaning | Primary action | Engine note |
|---|---|---|---|
| `automatable` | Matches an existing skill | **Run** (label: "Run on ACR" / "Run via n8n" / "Run") | venue = the skill's engine |
| `research` | No skill yet, but repeatable | **Research automation** (→ proposal) | if software, also offer **→ ACR** |
| `recurring` | Repeated on a cadence | **Put on a schedule** | + "Run once" / "Run once on ACR" |
| `signoff` | Client commitment / judgement call | **Approve & dispatch** | agent will not act until approved |
| `manual` | One-off, not worth automating | **Draft a first pass** | if software, also offer **Put on ACR** |

"Software work" detection drives the ACR suggestion — keywords like deploy/migrate/build/api/bug/refactor/script/backup/database/crawl/scrape/test/ci/pipeline/audit/lint/code/server/cron/webhook. See `isSoftware()` / `SOFTWARE_RE` in `reference/agent.jsx`.

### The automation flywheel (the point)
1. Sign a repeatable task off → Hermes triages it `research`.
2. **Research automation** → Hermes scopes it and returns a **proposal** (`components/ProposalCard.tsx`): proposed skill name, 1-line summary, 3 concrete steps, `≈ N min saved/run`, frequency, and an **engine** (`acr` if software else `n8n`).
3. **Promote to skill** → adds it to the **Skills library** with `runs: 0`. Crucially, **the originating task now matches the new skill** → it immediately re-triages to `automatable`. Future matching tasks auto-match too.
4. Over time, recurring work promotes itself into reusable automation. This is "Don't Repeat Yourself" applied to your own workload — and it must be **visibly surfaced** (the library + the agent log are the payoff).

### Hermes view layout
- **Control header:** Hermes avatar (working state pulses), state line ("Idle — ready for today's job" / "Working — N running" / "Done for today") with a small **ACR** access chip, lifetime "Saved you Xh across N runs", a **daily budget** stepper (default **1/day**, adjustable — "one job a day" by design), and a **Dispatch next job** button (runs the top `automatable` task, disabled when budget spent).
- **Sections** in order: *Working now* (running cards) · *Automation proposals* · *Needs your sign-off* · *Automatable now* · *Worth automating* · *Recurring ritual* · *One-off* · **Skills & automations** (grid; each card shows name + engine chip ACR/n8n/Hermes, description, runs, time saved, last run) · **Agent log** (what it's done, with per-entry time saved).
- **Task card** (`components/AgentTaskCard.tsx`): bucket badge (colored, with the bucket's left-border accent), project + area, the **rationale** line (prefixed with a robot glyph), and the bucket's action button(s) + a `×` to remove from the queue.

### ACR panel changes
ACR jobs become **live** (not static): running → done with elapsed. Jobs dispatched by Hermes carry a `hermes: true` flag and render a small **H** tag before the title in the ACR panel. Header reads "ACR · Agent Control Room" with a `Server` icon.

### New API surface for Phase 2 (proposed)
The prototype mocks these; wire to real endpoints:
- `GET /api/skills` · `POST /api/skills` (promote proposal → skill) — `{id, name, desc, engine, match[], runs, minutesSaved, lastRun}`
- `POST /api/tasks/:id/signoff` / `DELETE` — set/clear `agent_status`
- `POST /api/agent/triage` (optional LLM triage) → `{bucket, rationale, skillId?, acr?, engine?}`
- `POST /api/agent/research` → returns a proposal `{skillName, summary, steps[], savedPerRun, frequency, engine}`
- `POST /api/acr/dispatch` (already in the base spec) — now also called by Hermes; include `{source: 'hermes' | 'user', skillId?}`
- `GET /api/agent/log` — agent activity entries

Task model gains: `agent_status?: 'scheduled'|'running'|'done'`, and transient UI fields the prototype uses (`_runSkill`, `_via`) which should be **server job state** in production, not on the task.

---

## 8. Component inventory (prototype → target)

| Prototype (`reference/`) | Target file | Notes |
|---|---|---|
| `app.jsx` | `App.tsx` | shell, grid, keyboard, view routing, all mutations → TanStack Query |
| `today.jsx` → `TodayView`,`HeroTask`,`CapacityGauge`,`CandidateQueue` | `views/TodayView.tsx` + `components/HeroTask.tsx`,`CapacityGauge.tsx` | |
| `shared.jsx` → `TaskRow`,`AreaChip`,`StatusDot`,`PrefixBadge`,`fuzzy`,fmt* | `components/TaskCard.tsx` + `lib/format.ts`,`lib/fuzzy.ts` | |
| `panels.jsx` → `AmbientPanel`,`TaskPanel`,`CommandPalette` | `components/LiveFeedSection.tsx`,`TaskPanel.tsx`,`CommandPalette.tsx` | |
| `braindump.jsx` → `BrainDumpView`,`CandidateCard` | `views/BrainDumpView.tsx` + `components/CandidateCard.tsx` | |
| `artifacts.jsx` | `views/ArtifactsView.tsx` | |
| `board.jsx` → `BoardView`,`RoadmapView`,`ActivityView` | `views/BoardView.tsx`,`RoadmapView.tsx`,`ActivityView.tsx` | |
| `filters.jsx` → `FilterBar`,`matchFilter` | `components/FilterBar.tsx` + `lib/filter.ts` | Phase 2 |
| `agent.jsx` → `AgentView`,`AgentTaskCard`,`ProposalCard`,`SkillCard`,`triage` | `views/HermesView.tsx` + `components/AgentTaskCard.tsx`,`ProposalCard.tsx`,`SkillCard.tsx` + `lib/triage.ts` | Phase 2 |
| `icons.jsx` | `components/icons/` | Replace with `lucide-react` (these are Lucide-style strokes) — saves hand-rolling SVGs |
| `data.js` | — | **Mock only.** Delete; replace every read with a TanStack Query hook |
| `tweaks-panel.jsx` | — | Prototyping tool only; **do not ship**. The runtime toggles (accent/font/density/hero variant/capacity style) it drove can become real settings if desired |

> **Icons:** the prototype's `icons.jsx` is a custom Lucide-style set. Use **`lucide-react`** in production — names map closely (Sun, LayoutGrid, Bot/Cpu, FileText, Map, Activity, Search, Mic, Plus, Check, Pause, Ban, X, ChevronRight, MoreHorizontal, Copy, Link2, GitBranch, Zap, Beaker/FlaskConical, Lock, Repeat, Hand, Wand2, Server, Star, Filter).

---

## 9. State management (TanStack Query)

- **Server state** → TanStack Query. Suggested keys: `['today']`, `['tasks']`, `['projects']`, `['artifacts']`, `['acr','status']` (refetch ~5s while any running), `['brain', q]` (400ms-debounced, `enabled: q.length>0`), `['activity']`, `['milestones']`, `['skills']`, `['agent','log']`, `['config']`.
- **Mutations** (`schedule`, `markDone`, `signoff`, `dispatchToACR`, `commit`, `promoteSkill`, …): **optimistic updates** with rollback — the prototype's interactions all feel instant; preserve that. Invalidate `['today']`/`['tasks']`/`['acr','status']` as appropriate.
- **Client/UI state** (not server): current `view`, `selectedTaskId`, open `panel` ({mode, taskId}), `cmdkOpen`, `focusMode`, `filter`, `favorites`, capacity `target`, agent `dailyBudget`/`jobsToday`. Persist `view`, `filter`, `favorites`, `target`, `dailyBudget` to `localStorage` (keys used in the prototype: `lifeos-view`, `lifeos-filter`, `lifeos-favs`, `lifeos-target`, `lifeos-budget`).
- **Graceful degradation:** ACR (`:3001`) and Brain (`:8093`/Tailscale) can be offline — render the offline state, never an error. The prototype exposes `acr_online`/`brain_online` toggles to exercise both paths.

---

## 10. Anti-patterns (do not reintroduce)

- ❌ Asking "where does this go?" at capture time.
- ❌ Modals for detail views — use the slide-in panels.
- ❌ Status as text — use color-coded dots/chips.
- ❌ Navigation at equal visual weight to content.
- ❌ Gradients / drop-shadows on functional UI.
- ❌ Font-weight as the primary hierarchy tool — use space + color.
- ❌ Truncating the in-progress hero title.
- ❌ Empty command palette on open.
- ❌ Animating opacity from 0 on panels (offscreen-tab freeze blanks them).
- ❌ Letting Hermes touch un-signed-off tasks.

---

## 11. Files in this bundle

```
design_handoff_life_os/
├── README.md            ← this document
├── screenshots/         ← 7 high-res reference captures (Today, Hermes, Board, Brain Dump, Artifacts, Roadmap, Activity)
└── reference/
    ├── Life OS.html     ← open in a browser to run the prototype
    ├── styles.css       ← full token set + every component style (source of truth for visuals)
    ├── data.js          ← MOCK data layer (delete in production; mirrors API shapes)
    ├── icons.jsx        ← Lucide-style icon set (replace with lucide-react)
    ├── shared.jsx       ← TaskRow, atoms, fuzzy(), formatters
    ├── today.jsx        ← Today + hero + capacity + candidates
    ├── panels.jsx       ← ambient panel, peek/detail, command palette
    ├── braindump.jsx    ← brain dump + candidate cards
    ├── artifacts.jsx    ← artifacts list
    ├── board.jsx        ← board + roadmap + activity
    ├── filters.jsx      ← global filter + FilterBar  (Phase 2)
    ├── agent.jsx        ← Hermes view + triage + flywheel  (Phase 2)
    ├── app.jsx          ← shell, state, keyboard, routing
    └── tweaks-panel.jsx ← prototyping tool only — do not ship
```

**Data shapes:** `reference/data.js` documents every object shape the UI expects (Task, Project, Artifact, ACR job, Skill, agent-log entry, milestone, brain corpus). Treat it as the contract while wiring real endpoints.
