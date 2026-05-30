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
| MCPAT-039 | **P2-04b** | Draft auto-triage (passive-capture → Haiku → auto-promote or needs-you) | P2-04 (field pattern) | M |
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
- **InboxView fate — DECIDED:** delete `InboxView` (tab + file). Passive-capture drafts are handled
  by the P2-04b **Haiku auto-triage loop**: clear drafts auto-promote to `todo`; ambiguous ones
  surface in Today's "Needs your call" candidate sub-section (P1-03). Brain Dump is not involved.
  See P1-02 (delete tab), P1-03 (sub-section), P2-04b (triage backend). *(User confirmed 2026-05-29.)*
- **Triage location:** keep `lib/triage.ts` client-side heuristic, or call `/api/agent/triage`?
  Default: client heuristic in P2-05, endpoint optional in P2-04. Resolve when starting P2-05.

---

## 12. Phase 4 — Make the read-only UI usable (Epic MCPAT-041)

Post-Phase-3 review (`docs/life-os/audit/2026-05-30-functional-audit.md`) found the dashboard is a
faithful **read-only shell**: Phases 1–3 delivered the reskin + display layer, but the
**mutation/interaction layer was never built**. The client defines `transitionTask()` /
`updateTaskPriority()` that target HTTP routes absent from `server-ui.ts`, and errors are swallowed by
`if (res.ok)` guards. Phase 4 makes the UI actually usable: a real mutation layer, lifecycle/closure,
board DnD, estimate-on-commit, the discrete UI-bug batch, an enablement/infra sweep, and roadmap task
linking.

> **Epic: MCPAT-041.** Sub-specs reference the shared tokens (§3), data shapes (§4), and client
> conventions (§5) above — they are **not** restated per-spec. Each Phase-4 spec is single-builder-sized.

### Phase 4 sub-spec index & build order

| Task | Spec | Title | Depends on | Size |
|---|---|---|---|---|
| MCPAT-042 | **P4-01** | Task mutation layer + editable panel (`PATCH` + `/transition`) | — (foundational) | L |
| MCPAT-043 | **P4-02** | Done → Complete → Completed sprint-closure tab | P4-01 (P4-03 coord) | L |
| MCPAT-044 | **P4-03** | Board drag-and-drop (`@dnd-kit`) → transition | P4-01 (P4-02 coord) | M |
| MCPAT-045 | **P4-04** | Commit-to-Today estimate prompt + capacity gauge | P4-01 | S |
| MCPAT-046 | **P4-05** | UI bug batch (B1–B5: platform key, width/focus, menu portal, peek-on-click, spacing) | — (P4-03 coord on B4) | M |
| MCPAT-047 | **P4-06** | Enablement & infra (Hermes/ACR un-stub, Workspace label, Brain status probe, capture routing, artifacts hook) | — | L |
| MCPAT-048 | **P4-07** | Roadmap task linking (assign tasks → milestones) | P4-01 (soft-reuses P4-03) | M |

### Build-order DAG

```
                P4-01 (MCPAT-042) — KEYSTONE: PATCH + /transition
                  │      (everything that mutates depends on this)
        ┌─────────┼───────────────┬───────────────┐
        ▼         ▼               ▼               ▼
   P4-02       P4-03           P4-04           P4-07
 (closure)  (board DnD)   (estimate prompt)  (roadmap link)
   043         044             045              048
     ▲          │                               ▲
     └──coord───┘ (Done-column "Complete all")  │
                  └──── soft-reuse (drag) ───────┘  (P4-07 buildable w/o P4-03)

   P4-05 (UI bug batch, 046) ── independent ── (B4 coord w/ P4-03 drag-vs-click)
   P4-06 (enablement/infra, 047) ── independent (uses existing endpoints)
```

**Critical path:** **P4-01 first** (it unblocks P4-02, P4-03, P4-04, P4-07). After P4-01, the four
dependents parallelize. **P4-05 and P4-06 are independent** of P4-01 and can run in parallel from the
start. **User-elevated priority within Phase 4:** P4-07 (roadmap linking — every milestone reads 0/0
today) and P4-02 (lifecycle) after the P4-01 keystone.

**Coordination edges (not hard deps):**
- P4-02 ↔ P4-03 own the **Done-column "Complete all"** chrome jointly — whichever lands first builds it.
- P4-05 (B4 peek-on-click) ↔ P4-03 (drag activation) must coexist on the same rows (dnd-kit
  `activationConstraint`).
- P4-07 soft-reuses P4-03's `@dnd-kit` for drag-to-assign but ships a non-drag picker as the baseline.

### Phase 4 flagged decisions (carry into the named spec)

- **Closed vs archived (P4-02):** model the terminal "completed" state as a **`closed` status**
  (recommended — single queryable terminal state) vs an orthogonal **`archived` flag** (rejected — the
  §9 duplicate-state anti-pattern). Default = `closed` status; settle in P4-02 build step 1.
- **TLS for Tailscale `:8093` (P4-06c):** **never** a global `NODE_TLS_REJECT_UNAUTHORIZED=0`. Default =
  a scoped `https.Agent` for the Brain host only; settle in P4-06.
- **Estimate require vs prompt (P4-04):** default = prompt-but-skippable; hard-require is an Open Q.
- **Project/area re-assignment (P4-01):** deferred — `task_update` excludes `project`; re-routing is a
  separate "move task" affordance.

---

## 13. Phase 5 — Close the daily-use gaps + harden the gate (Epic MCPAT-050)

Post-Phase-4 review (`docs/life-os/audit/2026-05-31-post-phase4-gaps.md` — two read-only audits of
`main`) found three classes of gap left after Phase 4 made the UI mutable: (1) a **blind type-check
gate** — `src/ui`'s `type-check` script runs plain `tsc --noEmit` against a solution-style tsconfig
(`files: []` + `references`), so it compiles **0 files** and **22 real UI type errors ship green**;
(2) **daily-use functional gaps** — no field editing for area/tags/type/milestone, no New-task form,
no delete, closed tasks can't be reopened, capture `context` bias is dormant; (3) **backend
correctness/security + mobile** — `rerouteTask` is SQLite-only (violates markdown-first, silent data
loss), capture prompts skip the sentinel hardening the triage path uses, and the board is desktop-only.

> **Epic: MCPAT-050.** Sub-specs reference the shared tokens (§3), data shapes (§4), and client
> conventions (§5) above — they are **not** restated per-spec. Each Phase-5 spec is single-builder-sized.
> The audit (`2026-05-31-post-phase4-gaps.md`) carries the `file:line` evidence; specs cite it rather
> than re-investigating.

> **Status vocabulary (authoritative):** the real `TaskStatus` union is
> `'todo' | 'in_progress' | 'done' | 'blocked' | 'archived' | 'draft' | 'approved' | 'closed'`
> (`src/types/task.ts:1`). There is **no `'cancelled'`** — every `'cancelled'` branch in the UI is dead
> code (P5-01 removes them). CLAUDE.md's `queued → in_progress → done | blocked | cancelled` line is
> **stale** and is reconciled in P5-01.

### Phase 5 sub-spec index & build order

| Task | Spec | Title | Depends on | Size |
|---|---|---|---|---|
| MCPAT-051 | **P5-01** | Type-check gate (`tsc -b`) + fix 22 UI type errors + reconcile status vocab | — (foundational — real gate) | M |
| MCPAT-052 | **P5-02** | Backend correctness: `rerouteTask` markdown-first ID-migration + prompt sentinel hardening | P5-01 | M |
| MCPAT-053 | **P5-03** | Task field editing — area / tags / type / milestone in PATCH + TaskPanel editors | P5-01 (P5-02 for project note) | M |
| MCPAT-054 | **P5-04** | New-task modal + delete task (`DELETE /api/tasks/:id`) | P5-01 | M |
| MCPAT-055 | **P5-05** | Reopen closed tasks + interactive CompletedView | P5-01 | M |
| MCPAT-056 | **P5-06** | Wire capture `context` + roadmap-assign error toast | P5-01 | S |
| MCPAT-057 | **P5-07** | Mobile board — `TouchSensor` + responsive grid | P5-01 | S |
| MCPAT-058 | **P5-08** | Build hygiene — decouple `npm --prefix src/ui ci` from `build` | — (chore) | S |

### Build-order DAG

```
   P5-01 (MCPAT-051) — FOUNDATIONAL: type-check gate → `tsc -b` (the REAL gate)
     │   once landed, CI catches UI type errors — every later phase keeps `tsc -b` green
     │
     ▼
   P5-02 (MCPAT-052) — backend correctness + prompt hardening
     │   builds the markdown-first ID-migration primitive
     │   └── UNBLOCKS project reassignment (deferred A1-project; noted in P5-03)
     │
     ├──────────┬──────────┬──────────┬──────────┐
     ▼          ▼          ▼          ▼          ▼
   P5-03      P5-04      P5-05      P5-06      P5-07
 (field edit)(new+del)  (reopen)  (context)  (mobile)
   053        054        055        056        057

   P5-08 (MCPAT-058, build chore) ── independent of all UI work ── can run any time
```

**Critical path:** **P5-01 first** — it converts the no-op UI type-check into a real `tsc -b` gate, so
every subsequent phase is actually checked. **P5-02 second** — its ID-migration primitive is the
prerequisite for the deferred *project* reassignment that P5-03 explicitly excludes. **P5-03..P5-08 are
otherwise parallelizable, but ship sequentially** — they share heavy file overlap (`server-ui.ts`,
`TaskPanel.tsx`, `api.ts`, `transitions.ts`) and concurrent builders would collide on claims.

**Sequencing rationale (heavy file overlap — ship one builder at a time):**
- `server-ui.ts` is touched by P5-02 (rerouteTask, prompts), P5-03 (PATCH whitelist), P5-04 (DELETE route, POST), P5-05 (transition map), P5-06 (capture body).
- `TaskPanel.tsx` is touched by P5-03 (editors), P5-04 (delete affordance), P5-05 (reopen from Completed).
- `transitions.ts` (client + `src/types/transitions.ts` server) is touched by P5-01 (Record completion) and P5-05 (closed→todo/in_progress).

### Phase 5 flagged decisions (carry into the named spec)

- **`'cancelled'` is not a status (P5-01):** the canonical union (`src/types/task.ts:1`) has no
  `'cancelled'`. Every `'cancelled'` branch (`useToday.ts:101`, `TodayView.tsx:131,142`,
  `RoadmapView.tsx:34`, `LiveFeedSection.tsx:217`) is **dead code — remove it**, do not add `'cancelled'`
  to the union. Reconcile CLAUDE.md's stale state-machine line in the same spec.
- **`tsc -b` is the gate going forward (P5-01):** after P5-01, `src/ui`'s `type-check` is `tsc -b`. CI
  now catches UI type errors. **Every later Phase-5 (and future) spec must keep `tsc -b` green** — a
  green plain-`tsc` is no longer sufficient evidence.
- **Project reassignment stays deferred (P5-03):** P5-03 edits area/tags/type/milestone but **excludes
  `project`**. Project reassignment needs P5-02's markdown-first ID-migration primitive (the prefix is
  the task ID; reassignment mints a new ID + moves the file). Spec it as a follow-up once P5-02 lands.
- **Mutations stay markdown-first (P5-02, P5-04):** the dashboard HTTP layer uses `persistTaskDurable`
  (markdown-first) for **all** mutations. Do **not** introduce `TaskStore` into `server-ui.ts` — that is
  the established convention. The `rerouteTask` fix and the new `DELETE` route both go through
  `persistTaskDurable` / markdown move primitives, not a `TaskStore` round-trip.
- **`draft`/`approved` board home (D2) stays deferred:** out of Phase 5 scope (design decision; see audit
  §D2). The mobile board (P5-07) does not add a column for them.
