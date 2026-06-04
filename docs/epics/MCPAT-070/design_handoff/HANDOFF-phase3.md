# Handoff: Life OS — Phase 3 (Capture modes · Sidebar · Sort · Advisor · Notes)

> **Read `README.md` first.** Same target stack (React 18 · TypeScript · TanStack Query · Tailwind · Vite), same tokens (§3), same shell grid (§4), same anti-patterns (§10). This document only covers what changed/was added on top of Phases 1–2.
>
> **Fidelity: high.** Visuals are final — match the prototype. Where the prototype uses the in-memory mock (`reference/data.js`) or the browser LLM bridge (`window.claude.complete`), wire the real endpoints noted under each section.

Updated reference files: `reference/app.jsx`, `reference/today.jsx`, `reference/data.js`, `reference/styles.css`, plus the new `reference/advisor.jsx`. Screenshots: `screenshots/08-advisor.png`, `screenshots/09-notes.png`.

New `localStorage` keys: **`lifeos-capmode`** (capture mode), **`lifeos-sort`** (Today sort).

---

## 1. Capture bar — Infer / Task / Note modes

**File:** `components/CaptureOverlay.tsx` (prototype: `CaptureBar` in `app.jsx`).

The three modes are now a **segmented control on the bar itself**, sitting between the brand block and the input (not loose pills floating above it). The selected mode changes the lead-glyph tint, the placeholder, and where a submit lands.

```
[ LifeOS ] [ Infer | Task | Note ] [ + capture input …                    Ctrl Space ↗ 🎤 ]
```

**Model** (`CAPTURE_MODES` in `app.jsx`):

| Mode | Icon | Submit routes to | Placeholder |
|---|---|---|---|
| **Infer** (default) | `Wand2` | server/client decides — task **or** note | `Capture anything — I'll sort it into a task or note · ⇧Enter to expand · #project` |
| **Task** | `CheckCircle` | always a task | `New task — Enter to add · #project to route it` |
| **Note** | `FileText` | always a note | `Jot a note — Enter to save · #project` |

**Behaviour**
- Mode is persisted to `localStorage('lifeos-capmode')`, default `'infer'`. Restore on load.
- `#prefix` autocomplete + routing is unchanged from Phase 1 (works in all modes).
- **Infer routing heuristic** (prototype, client-side): route to a **note** when the text reads like a thought — `/^(note|idea|remember|thought|todo think)[:\-]/i` — otherwise a **task**. The leading `note:`/`idea:`/… token is stripped before saving. In production, prefer letting the server decide (see API below); the regex is a reasonable offline fallback.
- Submit flash is mode-aware: `Captured as task` (infer→task), `Captured` (task), `Noted` (note), each with its icon, ~700ms.
- The capture-focus ref now takes an optional mode: `focusCapture('task')` focuses the input **and** switches mode. The sidebar **New task** button and the Notes **New note** button use this (`focusCapture('task')` / `focusCapture('note')`).
- Lead-glyph tint by mode: `accent` for Task, `amber` for Note (CSS `.capture-input-wrap[data-mode="…"] .lead`).

**CSS:** `.capture-mode`, `.cm-btn` / `.cm-btn.on`, `.cm-ico`. Active state = `accent-soft` fill, accent icon. 26px buttons inside a 3px-padded `surface-1` pill.

**API**
- `POST /api/capture/quick` gains `{ mode: 'infer' | 'task' | 'note' }`.
  - `task` → existing task-create path.
  - `note` → `POST /api/notes` (see §5).
  - `infer` → server classifies (task vs note) and may also infer project/area. Return `{ kind, id }` so the client can show the right flash and (optionally) drop the user on the right surface.
- Keep capture **sub-2s and non-blocking** — infer never prompts the user to choose; it guesses and the user corrects later (anti-pattern §10).

---

## 2. Sidebar tidy — grouped nav + consolidated footer

**File:** `App.tsx` / `components/Sidebar.tsx` (prototype: nav block in `app.jsx`).

The flat 7-item rail grew to 10 and was getting noisy. It's now **three labelled groups** plus a restructured footer. The nav stays deliberately dimmed (~30–40% weight) per §4.

**Groups** (`NAV_GROUPS` in `app.jsx`):

| Group | Items |
|---|---|
| **Workspace** | Today · Board · Brain dump · Notes |
| **Assistants** | Advisor · Hermes |
| **Library** | Artifacts · Roadmap · Activity · Completed |

- The flat `NAV` array (with `NAV_BY_ID`) is still the source of truth for number-key shortcuts and counts; `NAV_GROUPS` only drives render order/labels. Keep them in sync.
- **Number shortcuts** now span `1`–`9` and `0` (10th = Completed). `0` maps to index 9.
- Per-item **count badges** are shown when defined: `today`, `board`, `agent` (Hermes), `artifacts`, plus new `notes`, `completed`, and **`advisor`** (= number of live suggestions). Items without a count show their key hint on hover.

**Footer** (`.nav-foot`) — replaces the old ACR/Brain text rows + lone Search button:
1. **New task** — primary button; `focusCapture('task')`.
2. **Search** — opens command palette (`⌘K` hint right-aligned).
3. **Density switch** — segmented `Compact · Cozy · Spacious` → sets `[data-density]` to `compact` / `balanced` / `airy` (the runtime density toggle from §3; promote to a real setting). Cozy/`balanced` is default.
4. **Status line** — `ACR` + `Brain` as small inline dots (green online / `muted-2` offline), with tooltips. Compact replacement for the old two-row block.

**CSS:** `.nav-group`, `.nav-group-label`, `.nav-item .nav-label`, `.nav-foot`, `.nav-foot-btn` (`.primary`), `.nav-density`, `.nd-btn` (`.on`), `.nav-status`, `.ns-item`. Favourites group (Phase 2) is unchanged, just re-spaced.

---

## 3. Today — filter + sort toolbar

**Files:** `views/TodayView.tsx`, `components/FilterBar.tsx`, new `components/SortMenu.tsx` (prototype: `SortMenu` in `app.jsx`, `taskCmp` in `today.jsx`).

The Phase-2 `FilterBar` and a new **Sort** control now share one row, `.today-toolbar` (flex; `FilterBar` is `flex:1`, Sort is pinned right). The FilterBar itself is unchanged (favourite chips → Filter popover → active chips → Clear); it just lost its own bottom margin to the toolbar.

**Sort control** (`SortMenu`)
- Options (`SORTS`): **Priority** (default) · **Area** · **Estimate** · **Project**.
- State `sortBy` is persisted to `localStorage('lifeos-sort')` and passed into `TodayView`.
- Button reads `↕ Sort: <b>Priority</b> ⌄`; opens a small right-aligned popover; selected row shows an accent check. Closes on outside-click.

**Sort semantics** (`taskCmp(sortBy)` in `today.jsx`) — applied to the **committed list** and within each **candidate area-group**; **priority is always the tiebreaker**, and on the committed list `done` items always sink to the bottom first:

| Sort | Primary key |
|---|---|
| `priority` | `PRI_RANK` (critical→low) |
| `area` | `AREA_ORDER` = client, personal, internal, outsource |
| `estimate` | estimate hours, descending |
| `project` | project prefix A→Z |

> Candidate tasks remain grouped by area (that grouping is structural to the Today view); `sortBy` orders *within* each group. Sort/filter are pure client UI state — no API change. Persist `lifeos-sort` alongside the other UI keys in §9.

**CSS:** `.today-toolbar`, `.sort-anchor`, `.sort-btn` (`.on`), `.sort-glyph`, `.sort-pop`, `.sort-opt` (`.sel`).

---

## 4. Advisor page

**Files:** `views/AdvisorView.tsx` + `components/AdvisorChat.tsx`, `components/SuggestionCard.tsx`; `lib/buildSuggestions.ts` (prototype: all in `advisor.jsx`). Nav id `advisor`, in the **Assistants** group; its count badge = number of live suggestions.

Two stacked sections: a **chat panel on top**, then **proactive suggestion cards** below. It reasons over live tasks + notes + the brain index — never a static document.

### 4a. Chat panel (`AdvisorChat`)
- **Header:** wand avatar, "Advisor" / "Reasons over your tasks, notes & brain", and **context chips** on the right: `Claude · live` (green when the LLM bridge is reachable, plain `Claude` otherwise), `brain CLI`, and a live `N tasks` count.
- **Thread:** assistant/user bubbles. Opens with a synthesised greeting that names the top flag. Task IDs in any message are parsed (`/\b[A-Z]{2,5}-\d+\b/g`) and rendered as **clickable `.id-chip`s** → open that task (`navigateToTask`). Keep this client-side regex pass on rendered text regardless of backend.
- **Suggested prompts** (shown until the user sends): *What should I work on next? · What's blocking me? · Draft my standup · What can Hermes take off my plate?* — tap to send.
- **Tool affordances** (`.tool-chip`): `@tasks · @notes · brain search · ACR` — signal the context/tools the advisor draws on.
- **Composer:** auto-grow textarea; `Enter` sends, `⇧Enter` newline; send button disabled while empty/busy; foot hint reflects connection state.

**How it talks to the model (prototype):**
- `callBridge(messages)` → `window.claude.complete({ messages })`. The first turn is a synthetic `user` message carrying a system brief + `snapshotContext(tasks, notes, suggestions)` (compact list of open tasks `id [pri/status/today] title`, notes, and the current advisor flags), followed by a canned assistant ack, then the real history. Response length/tone: 2–4 sentences, references IDs, one clear recommendation.
- **Graceful fallback:** if the bridge is absent or throws, `localAdvice(prompt, tasks, suggestions)` answers locally by keyword (blocking / standup / automation / "what next"). The panel must **never error or go dead** when the model or brain CLI is offline — degrade to local reasoning (anti-pattern parity with ACR/Brain offline states, §9).

**Production wiring**
- `POST /api/advisor/chat` — streaming. Inject the task/note/brain context **server-side** (don't trust the client to send the whole workload); expose real tools (read tasks, search brain via the brain CLI, query ACR). Stream tokens into the bubble. Keep the client-side id-chip parsing on the streamed text.
- The `Claude · live` chip should reflect real reachability of that endpoint + the brain CLI.

### 4b. Suggestion cards (`SuggestionCard`, `buildSuggestions`)
Replaces the old raw numbered text. `buildSuggestions(tasks, notes, target)` returns up to 5 **ranked** items derived from live state:

| id | Severity | Trigger |
|---|---|---|
| `s-crit` | **critical** ("Act now") | a `critical` task that isn't `in_progress` (prioritisation inversion) |
| `s-cap` | warning / info | committed estimate-hours vs daily `target` (over ceiling = warning; under = info "room for more") |
| `s-block` | warning ("Watch") | a `blocked` task is aging — chase the unblock or reschedule |
| `s-root` | info ("Consider") | two tasks share a root cause per a brain note (prototype: ACR-57 + HRLD-34, "Retry/backoff pattern") |
| `s-auto` | info | a `weekly`-tagged manual ritual not yet signed off — hand to Hermes |

Each card: severity left-rail + `sev-badge` (`Act now`/`Watch`/`Consider`), 2-digit rank, dismiss `×` (local state), title, rationale (≤72ch measure), **task-id chips** (clickable → open task), action buttons, and a `basis` line ("based on priority + status", "brain · patterns/dispatch.md", …).

**Actions** map to real mutations: `commit` → commit first task to today; `hermes` → sign off to Hermes (`agent_status`); `open` → open detail. Section header has a **refresh** that clears dismissals and recomputes.

**Production:** compute these server-side from tasks + notes + brain (`GET /api/advisor/suggestions` → `{ rank, id, severity, title, rationale, taskIds[], actions[], basis }[]`), or keep the heuristic client-side reading TanStack Query data. Severities/labels and the action verbs are the contract.

**CSS:** `.advisor-view`, `.adv-chat*`, `.adv-thread`, `.adv-msg(.user/.assistant)`, `.adv-bubble(.thinking)`, `.adv-suggested`, `.prompt-chip`, `.adv-composer`, `.adv-tools`, `.tool-chip`, `.adv-input-row`, `.adv-send`, `.id-chip`, `.sugg-section*`, `.sugg-card[data-sev]`, `.sev-badge[data-sev]`, `.sugg-title/-rationale/-foot/-chips/-actions/-basis`.

---

## 5. Notes page

**Files:** `views/NotesView.tsx` + `components/NoteCard.tsx` (prototype: `NotesView` in `advisor.jsx`). Nav id `notes`, in **Workspace**; count badge = total notes. (`CompletedView` ships alongside — see §6.)

Captured thoughts that aren't tasks. Filter-aware (same `matchFilter` + `FilterBar` as the other views).

**Note shape** (`reference/data.js` → `window.LifeOS.notes`):
```ts
{ id, project, area, pinned?: boolean, title, body, tags: string[], at: string, fresh?: boolean }
```

- **Layout:** pinned notes render first in their own 2-col grid, then a hairline divider, then the rest. Each `NoteCard`: header (project badge · area dot · ⭐ if pinned · timestamp), title (14/600), body (text-2), tag chips.
- **New note** button (top-right) → `focusCapture('note')` (switches the capture bar to Note mode and focuses it). Capturing in Note mode prepends a `{ fresh: true }` note here.
- Empty state points the user at the capture-bar Note mode.

**API**
- `GET /api/notes` → `Note[]`.
- `POST /api/notes` `{ title, body?, project?, tags? }` — also the target of capture-bar Note submits and Infer→note.
- `PATCH /api/notes/:id` (pin/edit), `DELETE /api/notes/:id`.
- Notes participate in the **advisor context** (chat + `s-root`-style suggestions reference them) — make sure the advisor endpoints can read them.

**CSS:** `.notes-grid`, `.notes-divider`, `.note-card`, `.note-head`, `.note-at`, `.note-title`, `.note-body`, `.note-tags`.

---

## 6. Completed page (shipped with the above)

`views/CompletedView.tsx` (prototype: `CompletedView` in `advisor.jsx`). Nav id `completed`, **Library** group, `0` shortcut. Done tasks, newest first (`done_at`), filter-aware: a green check chip, strikethrough title, area dot + project badge + done-timestamp. Clicking a row opens the task. **CSS:** `.done-row`, `.done-check`, `.done-title`, `.done-when`.

---

## 7. Component inventory (additions to README §8)

| Prototype | Target file | Notes |
|---|---|---|
| `advisor.jsx` → `AdvisorView`, `AdvisorChat`, `SuggestionCard` | `views/AdvisorView.tsx` + `components/AdvisorChat.tsx`, `SuggestionCard.tsx` | chat → `POST /api/advisor/chat` (streaming); cards → `GET /api/advisor/suggestions` |
| `advisor.jsx` → `buildSuggestions`, `snapshotContext`, `localAdvice`, `renderWithChips` | `lib/advisor.ts` | keep `renderWithChips` (id→chip) client-side; move suggestion/context logic server-side if preferred |
| `advisor.jsx` → `NotesView` | `views/NotesView.tsx` + `components/NoteCard.tsx` | `GET/POST /api/notes` |
| `advisor.jsx` → `CompletedView` | `views/CompletedView.tsx` | filtered `['tasks']` query |
| `app.jsx` → `SortMenu` | `components/SortMenu.tsx` | client state `lifeos-sort` |
| `app.jsx` → `CAPTURE_MODES`, mode logic | `components/CaptureOverlay.tsx` | adds `mode` to `POST /api/capture/quick` |
| `app.jsx` → `NAV_GROUPS`, footer | `components/Sidebar.tsx` | grouped rail + density/status/new-task footer |

> **Icons used (lucide-react):** `Wand2` (Infer / Advisor), `CheckCircle2` (Task / Completed), `FileText` (Note / Notes), `Send`, `Repeat` (refresh), `Beaker`/`FlaskConical` (suggestion basis), plus the existing set.

---

## 8. Anti-patterns (additions to README §10)

- ❌ Making **Infer** mode prompt the user to pick task-vs-note — it guesses; the user corrects after. Capture stays sub-2s and never blocks.
- ❌ A **dead/erroring Advisor** when the LLM bridge or brain CLI is offline — fall back to local reasoning, same as ACR/Brain offline states.
- ❌ **Hardcoded** advisor suggestions — they must be derived from live tasks/notes/brain and refresh.
- ❌ Sending the client's entire workload to the chat model from the browser — inject context **server-side**.
- ❌ Ungrouped 10+ item nav at equal weight — keep the three groups and the dimmed rail.
