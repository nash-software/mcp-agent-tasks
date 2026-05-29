# P2-06 — Automation flywheel + ACR live integration

**Type:** Feature
**Phase:** Phase 2 — Agent layer
**Epic:** MCPAT-022 — Life OS UI Reskin + Agent Layer
**Size:** L

> Read `docs/life-os/specs/00-epic-overview.md` first — §4 (`Skill` / `Proposal` / `AgentLog` / `AcrJob` incl. the `hermes` flag shapes), §5 (query keys `['skills']`, `['agent','log']`, `['acr','status']`; optimistic-mutation + rollback convention). Then `P2-04-hermes-backend.md` (the `POST /api/skills` promote endpoint, `POST /api/agent/research`, the skills store + `matchSkill`) and `P2-05-hermes-view-triage.md` (the `HermesView` sections, the task-card action buttons, and the re-triage loop). This spec does **not** repeat those shapes or endpoints — it consumes them. Reference, don't duplicate.

---

## Description

This is the **payoff** ticket of the agent layer. Everything before it (sign-off gate, triage, the Hermes view scaffold, the skills backend) exists so that *this* loop can close: **recurring work promotes itself into reusable automation, visibly, in front of the user.**

The mechanism is "Don't Repeat Yourself" applied to your own workload — not to code, to *you*:

1. You **sign a repeatable task off** (P2-05). Hermes triages it. Because there is no skill for it yet but it reads as repeatable, it lands in the `research` bucket ("Worth automating").
2. You click **Research automation**. Hermes scopes it and returns a **Proposal** — a proposed skill name, a 1-line summary, **3 concrete steps**, `≈ N min saved / run`, a frequency, and an **engine** (`acr` if the task is software work, else `n8n`). Rendered by `components/ProposalCard.tsx`.
3. You click **Promote to skill**. This `POST /api/skills` adds the skill with `runs: 0`. **Crucially**, the originating task now *matches the new skill* (its title/tags hit the skill's `match[]`), so on the next triage pass it flips out of `research` and into `automatable` — Hermes can now run it itself. This is the loop closing: `promote → matchSkill hits → automatable`.
4. Over time the Skills library fills with automations you never explicitly "built". That accumulation **must be visible** — the Skills & automations grid and the agent log are the reward signal. A flywheel the user can't see isn't a flywheel.

This ticket also makes the **ACR panel live** (P1-05's `LiveFeedSection`): jobs animate `running → done` with elapsed time, and jobs Hermes dispatched carry a `hermes: true` flag rendered as a small **H** tag before the title — so the user can see, in the ambient rail, that *the agent* (not them) kicked off the work the flywheel produced.

WHY this is the point, not polish:
- The triage view (P2-05) without this loop is a glorified filtered list. The promote→re-triage transition is the one interaction that demonstrates the system *learning the user's workload*.
- Surfacing must be loud-for-an-ambient-system: the Skills grid and per-entry "time saved" in the agent log are the only place the cumulative win is legible. Hiding them defeats the feature.

---

## Domain Model

Shapes are defined in epic §4 (`Skill`, `Proposal`, `AgentLog`, `AcrJob`). This ticket adds **behaviour**, not new shapes. Key model facts that drive the implementation:

### Proposal aggregate
- A `Proposal` is a **transient client-or-server scoping artifact** keyed to a `taskId`. It is *not* a skill yet — it is the reviewable intermediate state between `research` and a committed `Skill`.
- Fields: `{ id, taskId, project, skillName, taskTitle, summary, steps: string[], savedPerRun, frequency, engine }`. `steps` is exactly 3 concrete steps. `engine` is `'acr'` when `isSoftware(task)` (epic §6 keyword detection), else `'n8n'`.
- A proposal lives until it is **promoted** (→ becomes a `Skill`) or **dismissed** (→ discarded). Both terminal actions remove the proposal.

### `proposalTaskIds` queue gating
- While a proposal exists for a task, that task is **filtered out of the triage queue**. The view computes `proposalTaskIds = proposals.map(p => p.taskId)` and the triaged list excludes any `scheduled` task whose `id` is in that set (prototype `agent.jsx:236–239`).
- This prevents a task appearing simultaneously in `research` (offering "Research automation" again) *and* in "Automation proposals". The proposal *is* its current state.

### The re-triage closing loop (`promote → matchSkill → automatable`)
- Triage is **pure and derived**, recomputed on render from `(task, skills)` via `triage(task, skills)` / `matchSkill(task, skills)` (`agent.jsx:14–47`). It is never persisted on the task.
- `matchSkill` does a lowercase substring test of `task.title + tags` against each skill's `match[]` array.
- Therefore: when `POST /api/skills` adds a skill whose `match[]` contains a term present in the originating task, the very next `triage()` of that task returns `{ bucket: 'automatable', skill, action: 'run' }` instead of `{ bucket: 'research', action: 'research' }`. **No task mutation is needed** — invalidating `['skills']` (which re-fetches the skill that now matches) and removing the proposal is sufficient to make the task flip buckets on re-render.
- This is the entire trick: the promote handler does not touch the task; it adds a skill and clears the proposal, and the derived triage does the rest.

### Skill display contract
- `SkillCard` renders: skill `name` + an **engine chip** (`ACR` / `n8n` / `Hermes`, icon + label, `eng === 'acr' ? Server : eng === 'n8n' ? Repeat : Robot`), the `desc`, then a mono meta line `{runs} runs · {fmtSaved(minutesSaved)} saved · last {lastRun}`.

### Agent log contract
- `AgentLog` entries are `{ id, kind: 'run' | 'research' | 'promote', title, project, savedMin, at, skill? }`. Each row shows a kind-coloured icon (`run`→Zap/green, `research`→Beaker/accent, `promote`→Wand/blue), the title, a `+{fmtSaved(savedMin)}` chip when `savedMin > 0`, and the relative time.

### ACR job live model
- `AcrJob` gains (epic §4) `status: 'pending'|'running'|'done'|'failed'`, optional `elapsed_s`, `error`, and `hermes?: boolean`. The current `src/ui/src/types.ts` `AcrJob` (`{id,title,status:string}`) must be widened to this shape.
- `hermes: true` ⇒ render the small **H** tag before the title.

---

## Acceptance Criteria

1. **Promote creates a skill with `runs: 0`.** Clicking *Promote to skill* on a `ProposalCard` issues `POST /api/skills` with a body derived from the proposal (`name`, `desc`, `engine`, `match[]`, `runs: 0`, `minutesSaved: 0`, `origin: taskId`) and, on success, the new skill appears in the Skills & automations grid.
2. **Source task flips `research → automatable` after promote.** Immediately after a successful promote (proposal cleared + `['skills']` invalidated), the originating task is no longer in the `research` section and instead renders in `automatable` with the "Run …" action — driven purely by `matchSkill` now hitting. No task field is mutated to achieve this.
3. **A pending proposal hides its task from the triage queue.** When a proposal exists for `taskId`, that task does not appear in any triage bucket section; it appears only in "Automation proposals". On dismiss, the task returns to its triaged bucket (`research`).
4. **Research produces a 3-step proposal.** Clicking *Research automation* on a `research`-bucket task yields exactly one `ProposalCard` for that task showing the proposed skill name, 1-line summary, **3** numbered steps, `≈ N saved/run` (via `fmtSaved`), frequency, and engine — `acr` for software tasks, `n8n` otherwise.
5. **Skills grid shows engine chip + runs + saved + last run.** Each `SkillCard` renders the correct engine chip (ACR/n8n/Hermes with the matching icon), the run count, `fmtSaved(minutesSaved)`, and last-run label.
6. **ACR Hermes jobs show an H tag.** In the modified `LiveFeedSection`, any job with `hermes === true` renders a small "H" tag before its title; non-Hermes jobs do not.
7. **Dispatch carries `source`.** `POST /api/acr/dispatch` requests include `{ source: 'hermes' | 'user', skillId? }` — `'user'` for the existing braindump/manual dispatch path, `'hermes'` for flywheel/`runSkillDirect` dispatch.
8. **ACR jobs are live.** Running jobs display animated/elapsed state (`running` chip + elapsed seconds where `elapsed_s` is present) and transition to `done` on the ~5s `['acr','status']` poll; the panel header reads "ACR · Agent Control Room" with a `Server` icon.

---

## Technical Notes

Real paths:
- New: `src/ui/src/components/ProposalCard.tsx`, `src/ui/src/components/SkillCard.tsx` (port from `design_handoff_life_os/reference/agent.jsx:163–207`, React.createElement → JSX + Tailwind tokens per P1-01).
- New: `src/ui/src/components/AgentLogRow.tsx` (port from `agent.jsx:209–221`) if not already produced by P2-05.
- Modify: `src/ui/src/components/LiveFeedSection.tsx` (the P1-05 ACR panel) for live state + the H tag + the header/icon change.
- Modify: `src/ui/src/types.ts` — widen `AcrJob` to the epic §4 shape (`status` union, `elapsed_s?`, `error?`, `hermes?`); add `Skill`, `Proposal`, `AgentLog` interfaces if P2-04/P2-05 have not already.
- Modify: `src/ui/src/api.ts` — `acrDispatch` gains `source` (+ optional `skillId`); add `promoteSkill(proposal)` → `POST /api/skills`, and the `research` client function (see Open Questions). The existing call site at `api.ts:128` passes `source: 'user'`.
- Hermes view wiring lives in P2-05's `HermesView`; this ticket supplies the cards + handlers it imports.

The promote flow (the load-bearing path):
```
onPromote(proposal):
  optimistic: push synthetic Skill {runs:0, minutesSaved:0, match:[…from proposal]} into ['skills'] cache
              + remove proposal from local proposal state
              + append an AgentLog {kind:'promote', savedMin: proposal.savedPerRun}
  POST /api/skills  (P2-04)
  onSuccess: invalidateQueries ['skills'] and ['agent','log']
             → re-fetch → triage() of the source task now matches the new skill → re-renders in `automatable`
  onError:   rollback (restore proposal, drop synthetic skill + log entry)
```
The re-triage is **not a separate call** — it is a consequence of `['skills']` being invalidated and `triage()` being pure. Do not add a "re-triage" mutation; that would duplicate derived state.

Component structure:
- `ProposalCard({ proposal, onPromote, onDismiss })`: head (Wand glyph + "Automation proposal" + `PrefixBadge`), title "Turn this into a skill: **{skillName}**", `from "{taskTitle}"`, summary, 3 numbered `.p-step` rows, footer (`≈ {fmtSaved(savedPerRun)} saved / run` · `{frequency}` · Dismiss · Promote).
- `SkillCard({ skill, onRun })`: Bolt icon, name + engine chip, desc, mono meta line.

`fmtSaved(min)` — port from `agent.jsx:50–54` **but fix the prototype bug**: the prototype computes hours as `Math.round(min / 6) / 10`, which is wrong (off by 10×). Use `Math.round(min / 60 * 10) / 10` so 90 min → `1.5h`, not `15h`. Keep the `< 60 ⇒ "{min}m"` branch. Add a unit test asserting the corrected conversion (see Testing).

`LiveFeedSection` changes: keep the existing offline/loading/empty degradation (P1-05) intact. Add a `JobRow` H-tag (`{job.hermes && <span className="…">H</span>}`), render `elapsed_s` for running jobs, and change the section header to "ACR · Agent Control Room" with a `Server` icon. Do not remove the `BrainSearch` block.

`runSkillDirect(skill)`: optimistic — calls `acrDispatch` with `{ source: 'hermes', skillId: skill.id }` for ACR-engine skills (or the n8n/hermes equivalent), bumps the skill's `runs`/`minutesSaved` optimistically, and appends a `{kind:'run'}` agent-log entry.

---

## Failure Modes

- **Promote `POST /api/skills` fails.** Roll back fully: restore the proposal into the proposals list (task returns to `research`, *not* `automatable` — the skill was never persisted), drop the synthetic skill from the `['skills']` cache, drop the optimistic `promote` log entry. Show a calm inline error on the card, not a toast storm.
- **Research offline / scoping unavailable.** If research is an endpoint and it fails (or ACR/LLM is offline), fall back to the client heuristic (see Open Questions) so a proposal still renders; if even that is impossible, leave the task in `research` and surface a quiet "couldn't scope this right now" on the action button. Never block the queue.
- **ACR offline mid-dispatch.** `runSkillDirect` / Hermes dispatch must degrade exactly like P1-05's ambient panel — the dispatch optimism rolls back, the job never appears live, and the ACR panel shows the grey "ACR offline" affordance. No red banner. The flywheel UI (Skills grid, proposals) remains fully usable with ACR down.
- **Stale proposal after task already promoted.** If a proposal's task already matches an existing skill (race / double-click), promote is a no-op beyond clearing the proposal — guard against creating a duplicate skill for the same `match[]`/origin.

---

## Out of Scope

- **Real LLM-generated proposals.** A deterministic heuristic / stub that produces a plausible `{skillName, summary, 3 steps, savedPerRun, frequency, engine}` from the task is acceptable for this ticket. Wiring a real model behind `POST /api/agent/research` is P2-04's concern / a later enhancement.
- Real ACR job execution and real elapsed timing semantics — consuming whatever `GET /api/acr/status` returns (mock or live) is sufficient; this ticket renders the live shape, it does not implement the ACR runtime.
- n8n flow generation/execution. The `n8n` engine is a label + chip only here.
- The Hermes control header, budget stepper, and `HermesView` section layout — owned by P2-05.

---

## Dependencies

- **P2-04 — Hermes backend** (`POST /api/skills` promote endpoint, the skills store, `matchSkill`, optional `POST /api/agent/research`). Hard dependency — promote and the skill match both consume it.
- **P2-05 — Hermes view + triage** (`HermesView` sections, task-card action buttons, the `triage`/`bucketOf` functions, `proposalTaskIds` queue computation). This ticket provides the cards + handlers `HermesView` imports.
- **P1-05 — Ambient panel** (`LiveFeedSection`, `useAcrStatus`, `['acr','status']` query, offline degradation). This ticket modifies that component for live + H-tag.

---

## Testing

- **Promote → re-triage loop (the critical test).** Given a `scheduled` task in `research` and `skills` without a match, simulate a successful promote (add the skill to `['skills']`, clear the proposal): assert `triage(task, skillsAfter).bucket === 'automatable'` and that the task no longer renders in the `research` section but does render with the "Run" action. This is the one behaviour that must not regress.
- **`proposalTaskIds` gating.** With a proposal present for a task, assert the task is absent from all bucket sections and present only in "Automation proposals"; after dismiss, assert it returns to `research`.
- **Promote rollback.** Mock `POST /api/skills` failure: assert the proposal is restored, the synthetic skill is gone from cache, and the task is back in `research` (not `automatable`).
- **`fmtSaved`.** Unit test the corrected conversion: `fmtSaved(45) === '45m'`, `fmtSaved(90) === '1.5h'`, `fmtSaved(120) === '2h'` — and explicitly assert it is **not** the buggy `15h` for 90 min.
- **H tag rendering.** `LiveFeedSection` renders the H tag iff `job.hermes === true`; offline path still degrades to the grey affordance.
- **Dispatch source.** Assert `acrDispatch` from the manual path sends `source: 'user'` and from `runSkillDirect` sends `source: 'hermes'` with `skillId`.

---

## Open Questions

- **Research: client heuristic vs `POST /api/agent/research` endpoint.** P2-04 decides whether scoping happens server-side (real/stub endpoint) or client-side (deterministic heuristic). This ticket should consume whichever P2-04 ships; if P2-04 defers, implement the client heuristic and leave the endpoint call behind a thin `research()` api function so swapping later is a one-line change. Confirm before building.
- **Optimistic skill `match[]` derivation.** What seeds the new skill's `match[]` on promote — the proposal's `skillName` tokens, the source task's tags, or an explicit field on the proposal? Must be chosen so the source task reliably re-matches (AC #2). Recommend: derive `match[]` from the source task's distinctive title/tag tokens at proposal time and carry it on the proposal.
- **`runs`/`minutesSaved` accrual on direct run.** Whether `runSkillDirect` optimistically increments these client-side or waits for a server echo from `GET /api/skills`. Defer to P2-04's skills store semantics.
