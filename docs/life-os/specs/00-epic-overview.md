# Epic: Life OS — UI Reskin + Agent Layer (MCPAT-022)

**Type:** Epic
**Stack:** React 18 · TypeScript (strict) · TanStack Query · Tailwind CSS · Vite
**Codebase:** `C:\code\mcp-agent-tasks\src\ui\src\`
**Server:** `src/server-ui.ts` (raw `http.createServer`, `serve-ui` CLI command)
**Source handoff:** `design_handoff_life_os/` (README + `reference/` prototype + `screenshots/`)

> This is the anchor document for the Life OS upgrade. Every sub-spec (`P1-*`, `P2-*`)
> references the **shared conventions, tokens, and data shapes** defined here instead of
> repeating them. Read this first, then the individual sub-spec for the unit you are building.

---

## 1. Why this epic

The current Life OS dashboard (built under **MCPAT-021**, ST-1…ST-7) is functionally complete but
visually plain: a flat flex-column shell with no design-token layer, no Geist font, no command
palette, no agent layer. The `design_handoff_life_os/` bundle is a **high-fidelity HTML/React
prototype** defining the final look, motion, and two new capability layers.

This epic delivers that upgrade in two stages:

- **Phase 1 — Reskin.** Rebuild the existing surfaces and shell to match the prototype. Wires to
  **existing** API endpoints — **no backend work required**. The app is fully usable after Phase 1.
- **Phase 2 — Additive features.** Global filtering, project favourites, capture→Brain-Dump handoff,
  command-palette filter actions, and the **Hermes** agent layer (triage + automation flywheel + ACR
  dispatch). Introduces **new** client state, a new `agent_status` task field, and **6 new endpoints**.

**Ship Phase 1 first.** Phase 2 is strictly additive on top of it.

The prototype in `reference/` is a **visual/behavioural reference, not production code**. Recreate it
in the real stack. `reference/data.js` documents every data shape and is the contract while wiring
real endpoints; `reference/styles.css` `:root` is the source of truth for visual tokens.

---

## 2. Current-state baseline (what already exists)

Verified against `src/ui/src/` and `src/server-ui.ts` on 2026-05-29.

### Shell & theme — mostly MISSING
- `App.tsx` is a **vertical flex column** (Header → optional FilterBar → main → detail panel →
  capture overlay). No grid, no side columns, no spanning capture bar.
- `tailwind.config.js` is **empty** (`extend: {}`); `index.css` is bare `@tailwind` directives; no
  font loaded (defaults to system sans — **not Geist**). Colours are hardcoded Tailwind
  `slate/violet/indigo` utilities across ~25 files. **No `--accent` / theming layer.**
- `bg-slate-750` is referenced but undefined (renders as no background) — fix during reskin.
- View routing is `useState<TabId>` with no `localStorage` persistence.
- Only global key handler: `Ctrl+Space` (capture) + `Esc`, in `useCaptureOverlay.ts`. No focus mode,
  no `1`–`7`, no `J/K`, no `Cmd+K`.
- `queryClient.ts`: `staleTime: 0`, `refetchInterval: 30s`. **No optimistic mutations** anywhere.

### Views — present but plain
`TodayView` (no hero, read-only capacity, flat candidate list, private inline TaskCard),
`BoardView` (4-col kanban, uses shared `TaskCard`), `BrainDumpView` (complete, candidate cards),
`ArtifactsView` (staleness badges, relies on API order), `RoadmapView` ("New Milestone" button is
dead), `ActivityView` (timeline), `InboxView` (draft-promote queue — **extra tab, not in target nav**).
**No Hermes view.**

### Components
`Header` (7 tabs, wrong set/order, no shortcut hints), `TaskCard` (bordered card, **not** a 40px
row), `TaskDetailPanel` (slide-in, transform-only ✓, but **no peek mode**), `LiveFeedSection` (ACR +
BrainSearch, **no Recent-activity section**, lives inside TodayView not a right rail),
`CaptureOverlay` (#prefix ✓, **no mic, no Shift+Enter handoff**), `CandidateCard`, `VoiceCapture`,
`FilterBar` (project/milestone/label selects, **no status/area, board+roadmap only**), `ActionButton`,
`Badge` (enum drift — see §6), `BrainSearch`.

### Enum drift to reconcile (do this before status dots / priority bars)
`Badge.tsx` / `ActivityView` / `TaskDetailPanel` key on `queued` and lack `critical` / `approved` /
`draft` / `archived`, but the canonical unions in `types.ts` use `todo` / `critical` / `approved` /
`draft` / `archived`. **Reconcile to one source of truth first.** Note the prototype uses `queued`
for the queued status; the real store uses `todo`. **The real store union wins** — map prototype
`queued` → `todo` everywhere.

### API — Phase 1 endpoints ALL EXIST (`src/server-ui.ts`)
`GET /api/today`, `POST /api/tasks/:id/schedule`, `GET /api/tasks` (+POST, +`/:id/promote`),
`GET /api/projects`, `GET /api/config`, `GET /api/stats`, `GET /api/activity`,
`GET /api/milestones` (+POST), `GET /api/artifacts`, `POST /api/artifacts/opened`,
`POST /api/capture/quick`, `POST /api/capture/braindump`, `POST /api/capture/commit`,
`POST /api/transcribe`, `GET /api/acr/status`, `POST /api/acr/dispatch`, `GET /api/brain/search`.

### API — Phase 2 endpoints ALL MISSING (build in P2-04)
`GET/POST /api/skills`, `POST /api/tasks/:id/signoff` (+`DELETE`), `POST /api/agent/triage`,
`POST /api/agent/research`, `GET /api/agent/log`. Task model has **no `agent_status` field**.

---

## 3. Shared design tokens (source of truth)

Port `reference/styles.css` `:root` to `tailwind.config.js` + an `index.css` base layer. Defined once
here; **P1-01 implements it**, all other specs assume it exists.

### Colours

| Token | Hex | Use |
|---|---|---|
| `bg` | `#09090B` | App background |
| `surface-1` | `#111113` | Cards, panels |
| `surface-2` | `#18181B` | Hover, inputs, chips |
| `surface-3` | `#27272A` | **Borders/dividers — 1px hairline only** |
| `text` | `#FAFAFA` | Primary |
| `text-2` | `#A1A1AA` | Secondary |
| `muted` | `#71717A` | Muted |
| `muted-2` | `#52525B` | Faint (timestamps, counts) |
| `accent` | `var(--accent,#0070F3)` | Primary action only, sparingly |
| `accent-hover` | `var(--accent-hover,#0062D6)` | |
| status `red` | `#EF4444` | blocked / over-capacity / failed |
| status `amber` | `#F59E0B` | warning / 80–100% capacity |
| status `green` | `#22C55E` | done / healthy / ≤80% |
| status `blue` | `#3B82F6` | in-progress / running |
| area `client` | `#F59E0B` · `personal` `#22C55E` · `outsource` `#8B5CF6` · `internal` `#6B7280` | area dots |

- **Accent is runtime-themeable** via `--accent` CSS var. Curated options: `#0070F3` (default),
  `#7C5CFF`, `#F0653A`, `#2BD4A8`.
- **Accent-soft fill:** `color-mix(in srgb, var(--accent) 16%, transparent)`. Status-soft backgrounds:
  status colour at 13–16% over transparent.

### Type
- **Sans:** `Geist` → `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- **Mono:** `Geist Mono` → `ui-monospace, "SF Mono", monospace` — for IDs, timestamps, counts,
  numeric stats, **always `font-variant-numeric: tabular-nums`**.
- Weights 400/450/500/600/700. Body `font-feature-settings: "ss03","calt","kern","liga"`.

### Spacing · radii · motion
- **4px base unit.** Card pad 12–16, row 8/12 v/h, section gap 24, page pad 24, panel pad 16.
- Radii: cards 8, inputs/badges 6/4, modals/drawers 12, pills 999.
- Row height **40px** default; `compact` 34, `airy` 46 — runtime `[data-density]` toggle.
- Motion `--ease-spring: cubic-bezier(0.16,1,0.3,1)`. Panel slide 200–220ms **transform-only —
  NEVER animate opacity to a hidden state** (offscreen tabs freeze CSS at frame 0 and blank the
  content). Toast 150ms. Hover bg 100ms. Nothing >250ms on interactive elements. `animate-pulse`
  ring only on **running** dots and the live "now" indicator.

---

## 4. Shared data shapes (the contract)

From `reference/data.js`. Reconcile against real `src/types/task.ts` — **real-store names win**
(`todo` not `queued`; `git.commits[]` array not a `commits` count). Fields marked ★ are beyond a
normal task store.

```ts
type Area     = 'client' | 'personal' | 'outsource' | 'internal';
type Status   = 'todo' | 'in_progress' | 'done' | 'blocked' | 'cancelled'; // prototype 'queued' → 'todo'
type Priority = 'critical' | 'high' | 'medium' | 'low';
type Engine   = 'hermes' | 'n8n' | 'acr';

interface Task {
  id: string;            // "MCPAT-142" (PREFIX-N)
  project: string;       // prefix
  area: Area;            // ★ denormalized; fallback = areaOfProject(project)
  title: string;
  status: Status;
  priority: Priority;
  estimate_hours?: number;
  scheduled_for: string | null;   // "YYYY-MM-DD" or null (= unscheduled candidate)
  why?: string;
  tags?: string[];
  git?: { branch?: string; pr?: string; commits?: string[] };
  spec_file?: string; plan_file?: string;
  claimed_at?: number;   // epoch ms — drives the in-progress live timer
  done_at?: number;
  history?: { to: Status; at: string }[];
  block_reason?: string;            // ★ shown when status==='blocked'
  agent_status?: 'scheduled' | 'running' | 'done';  // ★ Phase 2 — sign-off gate
}

interface Project   { prefix: string; name: string; area: Area; self?: boolean; }
interface Artifact  { name: string; ext: string; project: string; path: string;
                      days: number; unvisited?: boolean; task_id?: string; }
interface AcrJob    { id: string; title: string; status: 'pending'|'running'|'done'|'failed';
                      project: string; elapsed_s?: number; error?: string; hermes?: boolean; } // ★ hermes flag (P2)
interface Skill     { id: string; name: string; project: string; engine: Engine; desc: string;
                      match: string[]; runs: number; minutesSaved: number; lastRun: string; origin: string; }
interface AgentLog  { id: string; kind: 'run'|'research'|'promote'; title: string; project: string;
                      savedMin: number; at: string; skill?: string; }
interface Milestone { project: string; title: string; progress: number; due: string; items: string[]; }
interface Activity  { id: string; title: string; to: Status; ago: string; }
interface BrainDoc  { title: string; source: string; text: string; } // result adds { score, ranges }
interface Proposal  { id: string; taskId: string; project: string; skillName: string; taskTitle: string;
                      summary: string; steps: string[]; savedPerRun: number; frequency: string; engine: Engine; }
```

`POST /api/tasks/:id/schedule` accepts `{ date: "YYYY-MM-DD" | null }`. `GET /api/today` returns
`{ committed: Task[], candidates: Task[], capacity: { committedMinutes, targetMinutes } }`.

---

## 5. Shared client conventions

- **Server state → TanStack Query.** Keys: `['today']`, `['tasks']`, `['projects']`, `['artifacts']`,
  `['acr','status']` (refetch ~5s while any running), `['brain', q]` (400ms-debounced,
  `enabled: q.length>0`), `['activity']`, `['milestones']`, `['skills']`, `['agent','log']`,
  `['config']`.
- **Mutations are optimistic with rollback** (`schedule`, `markDone`, `signoff`, `dispatchToACR`,
  `commit`, `promoteSkill`, priority cycle, …). The prototype feels instant — preserve that.
  Invalidate `['today']`/`['tasks']`/`['acr','status']` as appropriate.
- **Client/UI state (not server):** `view`, `selectedTaskId`, `panel` (`{mode:'peek'|'detail', taskId}`),
  `cmdkOpen`, `focusMode`, `filter`, `favorites`, capacity `target`, agent `dailyBudget`/`jobsToday`.
- **localStorage keys (from prototype, reuse exactly):** `lifeos-view`, `lifeos-filter`,
  `lifeos-favs`, `lifeos-target`, `lifeos-budget`. (`lifeos-density`, `lifeos-accent` for settings.)
- **Graceful degradation:** ACR and Brain may be offline — render the offline state, never an error.

---

## 6. Component map (prototype → target)

| Prototype | Target file | Spec |
|---|---|---|
| tokens/`styles.css` `:root` | `tailwind.config.js`, `index.css` | P1-01 |
| `app.jsx` | `App.tsx` | P1-02 |
| `icons.jsx` | `lucide-react` (no hand-rolled SVGs) | P1-02 |
| `today.jsx` | `views/TodayView.tsx`, `components/HeroTask.tsx`, `CapacityGauge.tsx` | P1-03 |
| `shared.jsx` (TaskRow, atoms) | `components/TaskCard.tsx`, `lib/format.ts` | P1-03 |
| `panels.jsx` (TaskPanel) | `components/TaskPanel.tsx` | P1-04 |
| `panels.jsx` (AmbientPanel) | `components/LiveFeedSection.tsx` | P1-05 |
| `app.jsx` capture bar | `components/CaptureOverlay.tsx` | P1-06 |
| `braindump.jsx` | `views/BrainDumpView.tsx`, `components/CandidateCard.tsx` | P1-07 |
| `artifacts.jsx` | `views/ArtifactsView.tsx` | P1-08 |
| `board.jsx` | `views/BoardView.tsx`, `RoadmapView.tsx`, `ActivityView.tsx` | P1-09 |
| `panels.jsx` (CommandPalette) | `components/CommandPalette.tsx`, `lib/fuzzy.ts` | P1-10 |
| `filters.jsx` | `components/FilterBar.tsx`, `lib/filter.ts` | P2-01 |
| (nav favourites) | nav group + FilterBar chips | P2-02 |
| capture handoff | `CaptureOverlay` → `BrainDumpView` | P2-03 |
| (new backend) | `src/server-ui.ts`, `src/types/task.ts`, store, schema | P2-04 |
| `agent.jsx` (view, triage) | `views/HermesView.tsx`, `lib/triage.ts`, `components/AgentTaskCard.tsx` | P2-05 |
| `agent.jsx` (flywheel) | `components/ProposalCard.tsx`, `SkillCard.tsx` | P2-06 |
| `data.js`, `tweaks-panel.jsx` | **do not ship** (mock / prototyping tools) | — |

---

## 7. Sub-spec index & build order

### Phase 1 — Reskin (no backend)
| Task | Spec | Title | Depends on | Size |
|---|---|---|---|---|
| MCPAT-023 | **P1-01** | Design-system foundation (tokens, Geist, density, accent) | — | M |
| MCPAT-024 | **P1-02** | App shell, navigation & global keyboard | P1-01 | L |
| MCPAT-025 | **P1-03** | Today view (hero, capacity, task rows, candidates, J/K) | P1-01, P1-02 | L |
| MCPAT-026 | **P1-04** | Task peek & detail panels | P1-01, P1-02 | M |
| MCPAT-027 | **P1-05** | Right ambient panel (ACR / Knowledge / Activity) | P1-01, P1-02 | M |
| MCPAT-028 | **P1-06** | Global capture bar | P1-01, P1-02 | M |
| MCPAT-029 | **P1-07** | Brain Dump view reskin | P1-01 | M |
| MCPAT-030 | **P1-08** | Artifacts view reskin | P1-01 | S |
| MCPAT-031 | **P1-09** | Board · Roadmap · Activity reskin | P1-01 | M |
| MCPAT-032 | **P1-10** | Command palette (`Cmd+K`) | P1-01, P1-02, P1-04 | M |

### Phase 2 — Additive
| Task | Spec | Title | Depends on | Size |
|---|---|---|---|---|
| MCPAT-033 | **P2-01** | Global filter + FilterBar | Phase 1 | M |
| MCPAT-034 | **P2-02** | Favourites (pinned projects) | P2-01 | S |
| MCPAT-035 | **P2-03** | Capture → Brain Dump handoff | P1-06, P1-07 | S |
| MCPAT-036 | **P2-04** | Hermes backend (`agent_status`, signoff, skills, agent/log endpoints) | — | L |
| MCPAT-037 | **P2-05** | Hermes view & triage engine | P2-04 | L |
| MCPAT-038 | **P2-06** | Automation flywheel & ACR live integration | P2-04, P2-05 | L |

> Epic: **MCPAT-022**. Branch convention: `feat/MCPAT-0XX-<slug>` (e.g. `feat/MCPAT-023-design-system`).

**Critical path:** P1-01 → P1-02 → (P1-03..P1-10 parallelizable) → ship Phase 1.
P2-04 (backend) can start in parallel with Phase 1. P2-05/P2-06 need P2-04 + Phase-1 shell.

---

## 8. Epic-wide acceptance criteria

- [ ] All seven surfaces match the `screenshots/` reference at high fidelity (colour, type, spacing,
      radii, motion final per §3).
- [ ] `npm run type-check` passes (strict, no `any`) and `npm run build` succeeds after each sub-spec.
- [ ] Every server-state read goes through a TanStack Query hook; **no remaining `reference/data.js`
      mock imports** (mock is deleted, not shipped).
- [ ] ACR and Brain offline paths render graceful state, never an error (test with both toggled off).
- [ ] No anti-pattern from §9 is present.
- [ ] Phase 1 is independently shippable and fully usable before any Phase 2 work merges.

## 9. Anti-patterns (epic-wide — do not reintroduce)

- ❌ Asking "where does this go?" at capture time.
- ❌ Modals for detail views — use slide-in panels.
- ❌ Status as text — use colour-coded dots/chips.
- ❌ Navigation at equal visual weight to content (nav is deliberately ~30–40% weight).
- ❌ Gradients / drop-shadows on functional UI (elevation = lighter surface).
- ❌ Font-weight as the primary hierarchy tool — use space + colour.
- ❌ Truncating the in-progress hero title.
- ❌ Empty command palette on open.
- ❌ Animating opacity from 0 on panels (offscreen-tab freeze blanks them).
- ❌ Letting Hermes touch un-signed-off tasks.

## 10. Out of scope (epic-wide)

- Shipping `reference/tweaks-panel.jsx` or any mock data layer.
- Mobile/phone layout (desktop-first; tablet 768–1199px rules are in-scope per P1-02).
- Real LLM triage/research as a hard requirement — heuristic client triage is acceptable for P2-05;
  the optional `/api/agent/triage` + `/api/agent/research` endpoints are stubs/heuristic in P2-04.
- Replacing the task store, MCP tools, or git-hook layer.
- Auth / multi-user — this is a single-user localhost dashboard.

## 11. Open questions

- **Capacity target persistence:** prototype uses `localStorage('lifeos-target')`. Promote to a
  `GET/PUT /api/config` user-setting, or keep client-only? (Default: client-only for Phase 1; revisit
  if multi-device.) Resolve in P1-03.
- **InboxView fate — DECIDED:** delete `InboxView`; fold draft-promote into Brain Dump. `status:'draft'`
  tasks surface as candidates in Brain Dump on entry; "Create task" maps to `POST /api/tasks/:id/promote`.
  See P1-02 (delete tab) and P1-07 (absorb drafts). *(User confirmed 2026-05-29.)*
- **Triage location:** keep `lib/triage.ts` client-side heuristic, or call `/api/agent/triage`?
  Default: client heuristic in P2-05, endpoint optional in P2-04. Resolve when starting P2-05.
