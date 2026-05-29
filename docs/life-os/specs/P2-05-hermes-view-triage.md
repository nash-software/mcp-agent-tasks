# P2-05 — Hermes view & triage engine

**Type:** Feature
**Phase:** Phase 2 — Additive
**Epic:** MCPAT-022 — Life OS UI Reskin + Agent Layer
**Size:** L

> Read `docs/life-os/specs/00-epic-overview.md` first — §3 (tokens), §4 (`Task` / `Skill` / `AgentLog` / `Engine` shapes), §5 (query keys, optimistic mutations, offline degradation) are the contract. Read `docs/life-os/specs/P2-04-hermes-backend.md` for the endpoints + `agent_status` field this view consumes. Read `design_handoff_life_os/README.md` §7.4 (two-systems model, sign-off gate, triage table, flywheel, view layout). Prototype reference: `design_handoff_life_os/reference/agent.jsx`. Screenshot: `design_handoff_life_os/screenshots/02-hermes.png`. This spec does not repeat shared shapes.

---

## Description

Hermes is the centrepiece of Phase 2: the agent layer that turns the task store from a passive list into a workload the user can **hand off**. This spec builds the Hermes **view** (`views/HermesView.tsx`), the deterministic **triage classifier** (`lib/triage.ts`), and the **task card** that renders a triaged task (`components/AgentTaskCard.tsx`).

**WHY an agent layer.** The user already captures, schedules, and tracks work across many projects. The missing layer is *doing the work* — and doing it without the user babysitting it. Hermes reads the tasks the user has explicitly signed off, classifies each into a bucket with a one-line rationale, runs what it can, and (in P2-06) turns repeatable work into reusable Skills. The payoff is visible: a lifetime "Saved you Xh across N runs" counter and an agent log of what it has done.

**WHY two systems — keep them strictly separate (state this in the UI copy and the code):**

- **Hermes** (a.k.a. **nash-ai**) is the **assistant**. He triages signed-off work and does most of it **himself** — building n8n flows, drafting, researching, scheduling. He has **knowledge of and access to ACR**.
- **ACR** (Agent Control Room, `acr.nashsoftware.dev`) is the autonomous **execution machine** for **software work**. It is the right-hand ambient panel (owned by P1-05). Hermes **decides per job** whether the work is software that belongs on ACR, and if so **dispatches** it there as an ACR job tagged Hermes-dispatched.

A **Skill** therefore carries an `engine: 'hermes' | 'n8n' | 'acr'`. Hermes runs `hermes`/`n8n` skills himself; for `acr` skills (and ad-hoc software tasks) he creates an ACR job that surfaces in the ACR panel.

The view header reads **"Hermes"** with the subtitle "Your assistant — triages, automates, and hands software work to ACR".

---

## Domain Model

### The sign-off gate (SAFETY invariant — non-negotiable)

> **Hermes only ever touches tasks the user has explicitly handed it.**

A task enters Hermes's queue exactly one way: the user invokes **"Sign off to Hermes"** (from the task `…` menu, the detail/peek footer per P1-04, or the command palette), which calls `POST /api/tasks/:id/signoff` (P2-04) and sets `agent_status: 'scheduled'`. Clearing it (`DELETE`) removes the task from the queue (`agent_status` → cleared). **"Dispatch to ACR" is a separate, equally explicit action** (`POST /api/acr/dispatch`) — it is never implied by sign-off. Nothing un-signed-off is ever triaged, displayed in any Hermes section, or actioned. A signed-off task shows a small robot badge on its Board card (the badge itself is wired by P1-04/P1-09 reading `agent_status != null`; this spec owns the gate semantics and the queue filter).

The view's queue filter is the gate in code:

```ts
const scheduled = tasks.filter(
  (t) => t.agent_status != null && t.agent_status !== 'done' && t.status !== 'done'
);
```

Tasks with `agent_status == null` are invisible to Hermes — full stop.

### The five buckets

Each signed-off, `scheduled` task is classified into exactly **one** bucket with a one-line rationale. The bucket contract is what the UI depends on (the production triage may stay heuristic or call an LLM, but it MUST return this shape).

| Bucket | Meaning | Primary action | Engine note |
|---|---|---|---|
| `automatable` | Matches an existing Skill | **Run** — label is `"Run on ACR"` / `"Run via n8n"` / `"Run <name>"` by `skill.engine` | venue = the skill's engine; shows a skill chip (`name · N runs`) |
| `signoff` | Client commitment / judgement call | **Approve & dispatch** (+ Open) | agent will not act until approved |
| `recurring` | Repeated on a cadence | **Put on a schedule** (+ "Run once" or "Run once on ACR") | `acr` flag set if software |
| `research` | No skill yet, but repeatable | **Research automation** (→ proposal, P2-06) | if software, also offer **→ ACR** |
| `manual` | One-off, not worth automating | **Draft a first pass** | if software, also offer **Put on ACR** |

### Engine concept

`Engine = 'hermes' | 'n8n' | 'acr'`. Drives: the `automatable` Run-button label, the venue phrasing in the rationale (`VENUE` map), the skill-card engine chip (P2-06), and whether a job is dispatched to ACR vs run by Hermes. `acr` ⇒ software, surfaces in the ACR panel; `n8n` ⇒ Hermes runs an n8n flow; `hermes` ⇒ Hermes runs it himself.

### Triage determinism (first-match-wins)

`triage(task, skills)` is a **pure function** evaluated top-to-bottom; the **first** matching rule wins. The order is:

1. **Skill match** → `automatable` (a matched skill always wins, regardless of keywords)
2. **Sign-off** → `signoff` (commitment/judgement regex **OR** `priority === 'critical'`)
3. **Recurring** → `recurring` (`tags` includes `"ritual"` **OR** cadence regex)
4. **Research** → `research` (automation-verb regex)
5. **Manual** → `manual` (fallback — matches nothing above)

This ordering is the contract: it is why a critical task that also contains an automation verb lands in `signoff`, not `research`. Tests assert this precedence per bucket.

---

## Acceptance Criteria

1. **Sign-off gate holds — un-signed-off tasks never appear.** Given a `['tasks']` set mixing `agent_status: null`, `'scheduled'`, `'running'`, and `'done'` tasks, the view renders **only** tasks where `agent_status != null && agent_status !== 'done' && status !== 'done'`. No `agent_status == null` task is triaged or shown in any section. (Epic anti-pattern: "Letting Hermes touch un-signed-off tasks.")
2. **Triage bucket classification matches the regex contract.** For each bucket there is a representative task that classifies into it and a rationale string matching the prototype: skill-match → `automatable`; `priority:'critical'` or commitment-regex hit → `signoff`; `ritual` tag or cadence-regex → `recurring`; automation-verb-regex → `research`; everything else → `manual`. First-match-wins precedence is asserted (e.g. a `critical` task containing "audit" lands in `signoff`, not `research`).
3. **Sections render in the fixed order** with only non-empty buckets shown: *Working now* → *Automation proposals* (P2-06) → *Needs your sign-off* → *Automatable now* → *Worth automating* → *Recurring ritual* → *One-off · manual* → *Skills & automations* (P2-06) → *Agent log*. Bucket sections follow `BUCKET_ORDER = ["signoff","automatable","research","recurring","manual"]`, each filtered to length > 0.
4. **Dispatch button is disabled at budget = 0.** "Dispatch next job" is disabled when `budgetLeft <= 0` (where `budgetLeft = max(0, dailyBudget - jobsToday)`) **or** when no `automatable` task exists (`recommended == null`). When disabled it shows `"Budget spent"` (budget exhausted) or its tooltip reads "Nothing queued to auto-run" (none recommended); enabled it reads "Dispatch next job" and runs the **top** `automatable` task.
5. **Run-button label switches by engine.** On an `automatable` card the primary button reads `"Run on ACR"` (engine `acr`, `Server` icon), `"Run via n8n"` (engine `n8n`, `Repeat` icon), or `"Run <skill.name>"` (engine `hermes`, `Zap` icon). A skill chip beside it shows `<skill.name> · <runs> runs`.
6. **Daily budget persists and defaults to 1/day.** `dailyBudget` initialises to `1`, is adjustable via the `−`/`+` stepper (clamped at 0 minimum), and persists to `localStorage('lifeos-budget')` across reloads. The state line reads "Working — N job(s) running" when any task is `running`, else "Idle — ready for today's job" when `budgetLeft > 0`, else "Done for today".
7. **Mutations are optimistic and explicit.** Sign-off clear (`onUnschedule`, the card `×`), `run`, `schedule`, and `dispatchToACR` apply optimistically with rollback and hit the P2-04 endpoints (see Technical Notes). "Approve & dispatch" (`signoff` bucket) and "→ ACR" / "Put on ACR" / "Run once on ACR" call `dispatchToACR` with `{ source: 'hermes' }`. The lifetime counter renders `"Saved you <fmtSaved(Σ minutesSaved)> across <Σ runs> runs · <jobsToday>/<dailyBudget> jobs today"`.
8. **Empty queue renders the calm empty state**, not a crash: a robot glyph, "Nothing signed off yet", and the copy explaining the sign-off gate ("Hermes only ever touches what you've explicitly handed him"). Shown when `scheduled.length === 0 && proposals.length === 0`.

---

## Technical Notes

### `lib/triage.ts` — port EXACTLY from `reference/agent.jsx`

Reproduce these verbatim (TypeScript-typed). Do not paraphrase the regexes or reorder the rules.

```ts
export const BUCKET_ORDER = ['signoff', 'automatable', 'research', 'recurring', 'manual'] as const;

const SOFTWARE_RE = /\b(deploy|migrat|build|api|endpoint|bug|refactor|script|backup|database|db|crawl|scrape|test|ci|pipeline|audit|lighthouse|lint|typecheck|code|server|cron|postgres|webhook)\b/;

const VENUE: Record<Engine, string> = { acr: 'on ACR', n8n: 'via an n8n flow', hermes: 'myself' };

export function matchSkill(task: Task, skills: Skill[]): Skill | undefined {
  const text = (task.title + ' ' + (task.tags || []).join(' ')).toLowerCase();
  return skills.find((s) => s.match.some((m) => text.includes(m)));
}

export function isSoftware(task: Task): boolean {
  return SOFTWARE_RE.test((task.title + ' ' + (task.tags || []).join(' ') + ' ' + (task.why || '')).toLowerCase());
}

export interface Triage {
  bucket: 'signoff' | 'automatable' | 'research' | 'recurring' | 'manual';
  skill?: Skill;
  action: 'run' | 'approve' | 'schedule' | 'research' | 'assist';
  rationale: string;
  acr?: boolean;
}

export function triage(task: Task, skills: Skill[]): Triage { /* first-match-wins, exactly as below */ }
```

Rule bodies, in order (verbatim logic from `agent.jsx` lines 24–47):

- `text = (title + ' ' + tags.join(' ') + ' ' + (why||'')).toLowerCase()`.
- **1. skill match:** `const skill = matchSkill(task, skills); if (skill) return { bucket:'automatable', skill, action:'run', rationale: \`Matches your “${skill.name}” skill — I'll run it ${VENUE[skill.engine] || 'myself'} and hand you the output.\` }`.
- **2. sign-off:** `if (/\b(sow|contract|approve|approval|decide|decision|sign off|pricing|invoice|client call|negotiat|hire|legal)\b/.test(text) || task.priority === 'critical') return { bucket:'signoff', action:'approve', rationale: "This touches a client commitment or a judgement call. I won't act until you approve it." }`.
- **3. recurring:** `if ((task.tags||[]).includes('ritual') || /\b(weekly|daily|every (week|day|morning)|recurring|standup|review)\b/.test(text)) return { bucket:'recurring', action:'schedule', acr: isSoftware(task), rationale: "Looks like something you repeat on a cadence — worth putting on a schedule so it just happens." }`.
- **4. research:** `if (/\b(audit|report|check|scan|scrape|crawl|sync|generate|lint|test|backup|monitor|migrate|export|screenshot|benchmark|digest|compile)\b/.test(text)) { const sw = isSoftware(task); return { bucket:'research', action:'research', acr: sw, rationale: sw ? "No skill yet — and this is software work. I can scope it, and I'd likely hand execution to ACR." : "No skill yet, but it's repeatable. I can scope it and build an n8n flow so it runs itself." } }`.
- **5. manual (fallback):** `const sw = isSoftware(task); return { bucket:'manual', action:'assist', acr: sw, rationale: sw ? "One-off, but it's software — I can draft it, or hand it straight to ACR to execute." : "One-off — automating it would cost more than it saves. I can draft a first pass, but it's yours to own." }`.

Also port `BUCKETS` metadata (label + lucide icon + colour token per bucket) and `fmtSaved(min)` (`<60 ⇒ "Nm"`, else `Math.round(min/6)/10 + "h"`). Map prototype `window.Icon.*` to `lucide-react`: Lock, Bolt/Zap, Beaker, Repeat, Hand, Robot, Server, Wand, Check, X, Plus. Bucket colours use tokens: `signoff`→amber, `automatable`→green, `research`→accent, `recurring`→blue, `manual`→muted.

### `views/HermesView.tsx`

Port `AgentView` + `AgentControl`. Data via TanStack Query (epic §5): tasks `['tasks']`, skills `['skills']`, log `['agent','log']` (sliced to 8). Proposals come from P2-06's `useProposals()` — this view consumes the list to (a) render the *Automation proposals* section slot and (b) exclude proposal-origin task ids from triage (`!proposalTaskIds.includes(task.id)`); the `ProposalCard` itself is P2-06.

Derivations:
- `scheduled` = the gate filter (AC-1). `running` = `scheduled.filter(t => t.agent_status === 'running')`.
- `triaged` = `scheduled.filter(t => t.agent_status === 'scheduled' && !proposalTaskIds.includes(t.id)).map(t => ({ task: t, tri: triage(t, skills) }))`.
- `byBucket` groups `triaged` by `tri.bucket`. `recommended = byBucket.automatable?.[0] ?? null`.
- `empty = scheduled.length === 0 && proposals.length === 0`.

**Control-header math:** `savedTotal = Σ skill.minutesSaved`; `runsTotal = Σ skill.runs`; `budgetLeft = max(0, dailyBudget - jobsToday)`. Dispatch button `disabled = !recommended || budgetLeft <= 0`; label `budgetLeft<=0 ? "Budget spent" : "Dispatch next job"`; onClick runs `recommended.task` with `recommended.tri`. State line per AC-6. The avatar gets a working-pulse class when `running.length > 0`. The ACR access chip (`Server` icon + "ACR", title "Hermes has access to the ACR machine") sits inline in the state line.

**Section render** uses `BUCKET_ORDER.filter(bk => byBucket[bk]?.length).map(...)` so order and "non-empty only" are guaranteed. Section component shows label, count, optional hint.

### `components/AgentTaskCard.tsx`

Port `AgentTaskCard`. Head: bucket badge (coloured text + the bucket's **left-border accent** on the card via `data-bucket`), `PrefixBadge` (project), area dot, and the `×` unschedule button (`onUnschedule(task)` — clears sign-off). Title is click-to-open (`onOpen`). Rationale line is prefixed with the robot glyph (muted). Action buttons are bucket-specific exactly as the prototype (lines 115–141): `automatable` → engine-labelled Run + skill chip; `research` → Research automation (+ "→ ACR" if `tri.acr`); `recurring` → Put on a schedule + ("Run once on ACR" if `tri.acr` else "Run once"); `signoff` → Approve & dispatch + Open; `manual` → Draft a first pass (+ "Put on ACR" if `tri.acr`). The `RunningCard` variant (for `running` tasks) is a sibling render in this view (no actions, shows a stream placeholder + spinner).

### Which mutations hit P2-04 endpoints

| UI action | Hook (optimistic, `['tasks']`/`['agent','log']` invalidation) | Endpoint (P2-04) |
|---|---|---|
| Card `×` / unschedule | `clearSignoff(taskId)` | `DELETE /api/tasks/:id/signoff` |
| Run / Dispatch next job (automatable) | `run(task, tri)` → sets `agent_status:'running'` optimistically | `POST /api/agent/triage`-aware run path; in heuristic mode marks running + appends log (see Open Questions) |
| Approve & dispatch (signoff) | `dispatchToACR(task, { source:'hermes' })` | `POST /api/acr/dispatch` |
| → ACR / Put on ACR / Run once on ACR | `dispatchToACR(task, { source:'hermes', skillId? })` | `POST /api/acr/dispatch` |
| Put on a schedule (recurring) | `schedule(task)` | `POST /api/agent/research` or schedule path per P2-04 |
| Research automation | `research(task)` → proposal | `POST /api/agent/research` (P2-06 renders the result) |

`signoff` itself (the inbound gate) is `POST /api/tasks/:id/signoff` and is invoked from P1-04 footers / command palette, not from this view. Budget is client-only state persisted to `localStorage('lifeos-budget')`; `jobsToday` is client-tracked agent state (epic §5).

---

## Failure Modes

- **ACR offline.** When `['acr','status']` reports `offline` (P1-05 owns that query), every ACR-dispatch affordance — "Run on ACR", "→ ACR", "Put on ACR", "Run once on ACR", and the ACR access chip — renders **greyed/disabled** with a tooltip ("ACR offline"), and the dispatch is not issued. Hermes-runnable buckets (`hermes`/`n8n` engines, research scoping, drafting) remain fully available. Never an error toast.
- **No skills (`['skills']` empty).** `matchSkill` returns nothing, so **no task ever lands in `automatable`** → "Dispatch next job" is disabled (no `recommended`), the lifetime counter reads `0h across 0 runs`, and every task falls through to `signoff`/`recurring`/`research`/`manual` by keyword. The view is still fully usable; the flywheel (P2-06) is how skills get created.
- **Empty queue.** `scheduled.length === 0 && proposals.length === 0` → the calm empty state (AC-8). No sections, no skeleton spinners lingering.
- **Skills/log query error or loading.** Treat as empty (no skills, no log rows) and render the view; never block the whole view on a peripheral query.

---

## Out of Scope

- **`components/ProposalCard.tsx`, `components/SkillCard.tsx`, the Skills-grid contents, and the automation flywheel** (research → proposal → promote-to-skill → auto re-triage). This spec renders the *Automation proposals* and *Skills & automations* **section slots** and consumes `proposals` for the triage-exclusion filter, but the cards and the promote/dismiss mutations are **P2-06**.
- **ACR panel live integration** — jobs going `running → done` with elapsed, the `hermes: true` flag, and the live **H** tag before Hermes-dispatched job titles in the ACR panel — is **P2-06** (the ACR panel itself is P1-05).
- **The inbound "Sign off to Hermes" affordances** (task `…` menu, detail/peek footer, command palette entry) and the Board-card robot badge wiring live in P1-04 / P1-09 / P1-10; this spec only defines the gate semantics and the queue filter, and the outbound clear (`×`).
- Real LLM triage/research as a hard requirement — heuristic client triage is the default (epic §10).

---

## Dependencies

- **P2-04 — Hermes backend.** Provides `agent_status` on `Task`, `POST/DELETE /api/tasks/:id/signoff`, `GET/POST /api/skills`, `GET /api/agent/log`, and the (optional/heuristic) `POST /api/agent/triage` + `POST /api/agent/research`. **Hard dependency** — this view cannot read its queue or run anything without it.
- **Phase 1 shell (P1-02)** — the App grid, view routing, and the Hermes nav tab. **P1-04 task panels** — the peek/detail footer that hosts "Sign off to Hermes" (the inbound gate) and the robot badge surface.
- **P1-05 ambient panel** — owns `['acr','status']` and the offline signal this view reads to grey ACR affordances.
- `lucide-react` (icons), TanStack Query + the optimistic-mutation hook pattern (epic §5).

---

## Testing

- **`lib/triage.ts` unit tests — one per bucket** (Vitest, pure function, no React):
  - skill-match wins → `automatable`, rationale interpolates `skill.name` and `VENUE[engine]`.
  - commitment-regex (e.g. "Approve Q3 SOW pricing") → `signoff`; `priority:'critical'` → `signoff`.
  - **first-match-wins precedence:** a `critical` task whose title contains "audit" → `signoff` (NOT `research`); a task that both matches a skill and contains a cadence word → `automatable` (skill beats recurring).
  - `ritual` tag → `recurring`; cadence regex ("weekly", "every morning") → `recurring`.
  - automation-verb ("scrape", "report", "digest") → `research`, with `acr` flag toggled by `isSoftware`.
  - none of the above → `manual`, `acr` flag toggled by `isSoftware`.
- **`isSoftware` regex tests:** positive on each `SOFTWARE_RE` keyword in title/tags/why; negative on plain non-software prose. Confirm `db`/`api`/`ci` word-boundary behaviour.
- **`matchSkill` tests:** scans `title + tags` (lowercased), returns the first skill whose `match[]` substring is contained; returns `undefined` on empty skills or no match.
- **HermesView component tests** (React Testing Library): gate filter hides `agent_status:null` and `done` tasks (AC-1); section order + non-empty-only (AC-3); dispatch disabled at `budgetLeft<=0` and when no `automatable` (AC-4); Run label switches by engine (AC-5); budget persists to `localStorage('lifeos-budget')` and defaults to 1 (AC-6); empty state when nothing signed off (AC-8).
- Optimistic mutation tests: `×`/unschedule, run, dispatchToACR, schedule fire the correct endpoint and roll back on rejection.

---

## Open Questions

- **Client heuristic triage vs `POST /api/agent/triage`.** Epic §11 default is the **client heuristic in `lib/triage.ts`** for P2-05, with the server endpoint optional/stub in P2-04. Confirm we ship heuristic-only here; if/when the LLM endpoint is wired, the view should consume `{bucket, rationale, skillId?, acr?, engine?}` with **identical shape** so no UI change is needed. Resolve at build start.
- **`run` semantics in heuristic mode.** With no real execution backend, does "Run"/"Dispatch next job" (a) optimistically set `agent_status:'running'` and append an agent-log entry, then settle to `done`, or (b) immediately hand to ACR for `acr`-engine skills? Default: optimistic running→done + log entry for `hermes`/`n8n`; `dispatchToACR` for `acr`. Confirm with P2-04's run contract.
- **`jobsToday` source of truth.** Client-tracked counter (reset at local midnight) vs derived from `GET /api/agent/log` count for today. Default: client-tracked alongside `dailyBudget`; revisit if multi-device.
