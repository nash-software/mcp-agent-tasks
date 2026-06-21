# Advisor Coaching Layer — Implementation Handoff

**Audience:** Claude Code. **Goal:** implement the coaching layer step by step, one atomic task at a time.

This file is the orchestrator. It does **not** restate the architecture — that lives in the two
documents below. It gives you the ordered task graph, the contracts that pin each task down, the
non-negotiable invariants, and a progress ledger you update as you go.

---

## 0. How to use this file

1. **Read first, in order:**
   - `docs/advisor-architecture.md` — the existing system (personas, SSE, sessions, memory, ActionCards).
   - `docs/advisor-coaching-spec.md` — the design for what you're building. Section numbers (§) below
     refer to this file. When a task says "full schema in §4.2", open it; don't invent the shape.
2. **Work one task at a time, in order.** Each task is PR-sized. Do not batch.
3. **After each task:** run its verification, tick its box in the Progress Ledger (§5), commit with the
   task ID in the message (`feat(advisor): T0.1 typed entity schemas`).
4. **Gates are hard.** Where a task says `GATE`, do not proceed past it until the named condition holds.
   The most important: **no deepening play is exposed to a real session until T1.3 + T1.4 (the
   state-gate) are merged and tested.** Deepening + memory + validation without the gate is the exact
   configuration this whole layer exists to avoid.
5. **STOP and ask Mike** before deciding anything in §6 (Open Decisions). Don't guess on those.
6. **Don't break existing behaviour.** `pm`/`chairman` personas, ActionCards, the reflection-on-close,
   `memories.jsonl`, and every base-doc invariant must keep working. The coaching layer is additive.

**Branch:** `feat/advisor-coaching`. **Test env:** unit-test pure logic with `CLAUDE_CLI_DISABLED=1`
(LLM calls fail fast under this flag — see base-doc invariant #8), so any module that calls an LLM must
take an injectable `runLLM` so it's testable without the CLI.

```typescript
// shared LLM seam — every LLM-touching module depends on this, never on the CLI directly
type RunLLM = (prompt: string, opts?: { tier?: PrismTier; cold?: boolean }) => Promise<string>
```

---

## 1. Global invariants (every task must hold these)

These are spec §12. Violating one is a failed task regardless of whether tests pass.

1. **Challenger isolation** — runs in its own spawn; never shares context/instance with the coach.
2. **State-gate ordering** — distress check runs *before* play selection; no deepening play under high
   arousal. Not configurable.
3. **No write-time episodic summarisation** — `full_log` persisted verbatim; semantic entities derive
   only in the consolidation pass.
4. **Arbiter never deletes on pivot** — writes a `TimeBoundSummary`; reconciliations are append-only.
5. **Challenger suppressed during grounding mode.**
6. **Referral override** — sustained-distress threshold overrides persona/preferences and points to
   humans. Only place the system overrules the user.
7. **Coach emits no ActionCards** (base invariant preserved) — may emit `artifact_draft` / `entity_update`.
8. **Play injection uses the chairman-only-context mechanism** (conditional system-prompt augmentation),
   not a new code path.
9. **Consolidation idempotency** — dedupe by `session_id` + entity content hash; safe to re-run.
10. **Stream hygiene** — `challenge` and `artifact_draft` JSON are buffered in `holdBuffer` and parsed
    out exactly like the existing ` ```actions ` block; never leaked as `delta`.

---

## 2. Working agreement

- Pure logic (stores, arbiter decision, selection, gate) gets unit tests. LLM-touching code gets tests
  with a mocked `runLLM`.
- Keep each store's IO in its own module; no cross-store imports except through typed interfaces.
- Persona/play JSON is data, not code — no logic in JSON.
- If a task's contract here conflicts with the spec, the spec wins; flag the conflict in your commit body.
- If you hit a decision not covered here or in the spec, it belongs in §6 — stop and ask.

---

## 3. Task graph

Each task: **Goal · Depends · Files · Contract · Acceptance · Verify.**

### Phase 0 — schemas + stores (no behaviour change yet)

#### T0.1 — Typed schemas
- **Goal:** all new types compile; no runtime wiring.
- **Depends:** —
- **Files:** `src/types/advisor.ts`
- **Contract:** add `PlayId`, `ArtifactKind`, `EntityType`, `EntityStatus`, `StateMode`, `PrismTier`
  string-literal unions; `BeliefRecord`, `FearRecord`, `ValueRecord`, `CommitmentRecord`,
  `EpisodicRecord`, `StateLogEntry`, `TimeBoundSummary`, `Artifact` (full shapes in spec §4, §10);
  extend `AdvisorChatFrame` with the 6 new frames (§7).
- **Acceptance:** `tsc` clean; existing types untouched.
- **Verify:** `npm run typecheck`.

#### T0.2 — Episodic store
- **Goal:** verbatim turn store, queryable.
- **Depends:** T0.1
- **Files:** `src/store/advisor-episodic.ts`
- **Contract:**
  ```typescript
  export function appendEpisodic(rec: EpisodicRecord): Promise<void>
  export function readEpisodic(sessionId: string): Promise<EpisodicRecord[]>
  export function queryEpisodic(opts: {
    play?: PlayId; openLoops?: boolean; sinceTs?: string
  }): Promise<EpisodicRecord[]>
  ```
  Path: `~/.mcp-tasks/advisor-sessions/episodic/<session_id>.jsonl`. **No truncation, no summary.**
- **Acceptance:** round-trips a full turn incl. `state_tags`, `charge`, `open_loop`.
- **Verify:** unit test (runs under `CLAUDE_CLI_DISABLED=1`).

#### T0.3 — Entity stores (CRUD only; arbiter is T2.1)
- **Depends:** T0.1
- **Files:** `src/store/advisor-entities.ts`
- **Contract:**
  ```typescript
  type Entity = BeliefRecord | FearRecord | ValueRecord | CommitmentRecord
  export function listEntities(type: EntityType): Promise<Entity[]>
  export function getEntity(type: EntityType, id: string): Promise<Entity | null>
  export function upsertEntity(type: EntityType, e: Entity): Promise<void>   // no merge logic yet
  ```
  Paths: `entities/{beliefs,fears,values,commitments}.jsonl`.
- **Acceptance:** CRUD per type; ids stable.
- **Verify:** unit test.

#### T0.4 — State-log store (store only; classifier is T1.3)
- **Depends:** T0.1
- **Files:** `src/store/advisor-state.ts` (store section)
- **Contract:**
  ```typescript
  export function appendState(e: StateLogEntry): Promise<void>
  export function recentState(n: number): Promise<StateLogEntry[]>
  export function stateRange(fromTs: string, toTs: string): Promise<StateLogEntry[]>
  ```
- **Verify:** unit test.

#### T0.5 — Artifact store
- **Depends:** T0.1
- **Files:** `src/store/advisor-artifacts.ts`
- **Contract:** list/get/create + `appendVersion(id, body)` (never overwrite `versions[]`).
- **Verify:** unit test asserts versions append-only.

---

### Phase 1 — play system + state-gate `← SAFETY LANDS HERE`

#### T1.1 — Play catalogue (data)
- **Depends:** T0.1
- **Files:** `src/ui/src/advisor/plays/*.json` (11 plays, spec §2 table)
- **Contract:** each conforms to the `Play` interface (spec §2). Fill `trigger_signals`, `protocol`,
  `opening_moves`, `deepening_questions`, `do_not`, `writes`, `exit_criteria`,
  `safe_when_dysregulated`. `somatic_pendulation.safe_when_dysregulated = true` (it's the grounding play).
- **Acceptance:** all 11 parse against a runtime validator.
- **Verify:** unit test validates each JSON.

#### T1.2 — Load plays
- **Depends:** T1.1
- **Files:** `src/ui/src/lib/advisor.ts`
- **Contract:** add `PLAYS: Record<PlayId, Play>` loaded like `PERSONAS`. Export `getPlay(id)`.
- **Verify:** typecheck + unit.

#### T1.3 — State classifier `← hardest piece; see §6`
- **Depends:** T0.4
- **Files:** `src/store/advisor-state.ts` (classifier section)
- **Contract:**
  ```typescript
  export interface StateClassification {
    mode: StateMode; arousal: number; valence: number; triggers?: string[]
  }
  export function classifyState(
    message: string, recent: StateLogEntry[], runLLM: RunLLM
  ): Promise<StateClassification>
  ```
  Start hybrid: cheap heuristic pre-filter (extend the existing memory-candidate regex) → LLM
  confirmation on the **cheapest Prism tier**. The processing-vs-rumination call is the crux; treat the
  heuristic as a floor, not the decision. **Before this gates real sessions, build the eval set in §6.**
- **Acceptance:** returns a classification for representative inputs; deterministic under mocked `runLLM`.
- **Verify:** unit test with mocked `runLLM` across a fixture set.

#### T1.4 — State-gate in the chat handler `← GATE`
- **Depends:** T1.3
- **Files:** `src/server-ui.ts` (chat handler)
- **Contract:**
  ```typescript
  export function gate(c: StateClassification, recent: StateLogEntry[]):
    { action: 'proceed' | 'ground' | 'refer'; reason: string }
  ```
  Ordering (spec §6), runs **before** triage:
  - `ruminating` OR high arousal → `ground`: force `play = somatic_pendulation`, emit `state_flag`,
    suppress Challenger.
  - sustained high distress across N turns OR crisis language → `refer`: stop deepening, name it,
    point outward; **overrides persona/preferences**.
  - else → `proceed`.
  Append a `StateLogEntry` every turn regardless.
- **Acceptance:** under a ruminating fixture, no deepening play is selected and `state_flag{action:'ground'}`
  is emitted; under crisis fixture, `refer` path fires.
- **Verify:** handler test with mocked classifier.
- **GATE:** **do not start T1.5 deepening exposure until this is merged and green.**

#### T1.5 — Play router / triage
- **Depends:** T1.2, T1.4
- **Files:** `src/ui/src/lib/advisor.ts`, `src/server-ui.ts`
- **Contract:** when `mode==='coach'` and gate returns `proceed`: classify message → `PlayId` via
  `trigger_signals` (cheap tier). Inject `play.protocol` + opening/deepening questions into the system
  prompt **using the chairman-only-context injection mechanism** (invariant #8). Emit
  `play_active{play, reason}`.
- **Acceptance:** a values message routes to `ladder`; a stuck-pattern routes to `immunity`; injected
  prompt contains the play protocol.
- **Verify:** unit (classification) + handler test (injection present).

#### T1.6 — Coach persona becomes the play front
- **Depends:** T1.5
- **Files:** `src/ui/src/advisor/personas/coach.json`
- **Contract:** rewrite `system_prompt`/`output_style` so the coach is the warm, mirror-not-oracle front
  that *hosts* plays (asks more than tells, reflects prior insight back). Still emits **no** ActionCards.
- **Verify:** manual smoke + existing persona tests still pass.

#### T1.7 — `state_flag` + `play_active` wiring + StateRibbon
- **Depends:** T1.4, T1.5
- **Files:** `src/ui/src/api.ts`, `src/ui/src/components/AdvisorChat.tsx`,
  `src/ui/src/components/StateRibbon.tsx` (new)
- **Contract:** `streamAdvisorChat` yields the new frames; `AdvisorChat` renders the active-play chip in
  `ChatHeader` and a `StateRibbon` (reuses the nudge-banner mechanism) for ground/refer.
- **Verify:** manual; frames render, no `delta` leakage.

#### T1.8 — Referral content `← see §6`
- **Depends:** T1.4
- **Files:** referral config (location TBD with Mike)
- **Contract:** the `refer` action surfaces real, correct outward pointers. **Do not invent these.**
- **GATE:** referral copy/resources confirmed by Mike before `refer` ships.

---

### Phase 2 — consolidation + arbiter (memory upgrade)

#### T2.1 — Arbiter
- **Depends:** T0.3
- **Files:** `src/store/advisor-entities.ts`
- **Contract:**
  ```typescript
  type ArbiterDecision =
    | { kind: 'new';        record: Entity }
    | { kind: 'duplicate';  targetId: string }
    | { kind: 'refinement'; targetId: string; merged: Partial<Entity> }
    | { kind: 'pivot';      targetId: string; summary: TimeBoundSummary }
  export function runArbiter(
    type: EntityType, candidate: Partial<Entity>, existing: Entity[], runLLM: RunLLM
  ): Promise<ArbiterDecision>
  ```
  On `pivot`: **never delete** the target; write `TimeBoundSummary` into `reconciliation`, append the new
  framing, set status. Reconciliations append-only.
- **Acceptance:** a contradicting candidate yields `pivot` with a time-bound summary; the prior record
  survives.
- **Verify:** unit with mocked `runLLM` (duplicate / refinement / pivot fixtures).

#### T2.2 — Consolidation pass
- **Depends:** T0.2, T2.1
- **Files:** `src/store/advisor-consolidation.ts`
- **Contract:**
  ```typescript
  export function consolidateSession(sessionId: string, runLLM: RunLLM): Promise<{
    updated: { type: EntityType; id: string }[]
    reconciliations: TimeBoundSummary[]
    staleArtifacts: string[]
  }>
  ```
  Steps (spec §4.4): read episodic → extract candidates (structured output, mid tier) → `runArbiter` each
  → write entities → append `StateLogEntry` → flag artifacts whose assumptions a pivot invalidated.
  **Idempotent:** dedupe by `session_id` + entity content hash.
- **Acceptance:** re-running on the same session produces no duplicate entities.
- **Verify:** unit; run twice, assert stable.

#### T2.3 — Wire into close handler
- **Depends:** T2.2
- **Files:** `src/server-ui.ts` (session/close)
- **Contract:** after `full_log`→episodic persist, run `consolidateSession` **alongside** the existing
  ≤150-char reflection (keep both). Then delete in-memory log (unchanged).
- **Verify:** handler test; both memory tiers written.

#### T2.4 — Consolidate endpoint
- **Depends:** T2.2
- **Files:** `src/server-ui.ts`
- **Contract:** `POST /api/advisor/consolidate { sessionId }`; idempotent; note a cron entry for scheduled
  runs in the file header.
- **Verify:** endpoint test.

---

### Phase 3 — Challenger

#### T3.1 — Challenger module (isolated)
- **Depends:** T0.3
- **Files:** `src/store/advisor-challenger.ts` (server-side, near `spawnClaudeStream`)
- **Contract:**
  ```typescript
  export interface ChallengeInput { claims: string; beliefs: BeliefRecord[] }
  export interface ChallengeOutput {
    counterpoint: string; tests: string[]
    disconfirming?: { beliefId: string; note: string }[]
  }
  export function runChallenger(input: ChallengeInput): Promise<ChallengeOutput>
  ```
  **Separate spawn, cold/adversarial system prompt, different Prism tier from the coach.** Reads belief +
  `downward_arrow` + existing `disconfirming_evidence`. Job: evidence against the story, test the
  `big_assumption`, one Byron Katie turnaround, loop-vs-progress flag.
- **Acceptance:** never shares the coach's context object (assert in test).
- **Verify:** unit with mocked spawn.

#### T3.2 — Async parallel run + `challenge` frame
- **Depends:** T3.1, T1.4
- **Files:** `src/server-ui.ts`
- **Contract:** fire `runChallenger` in parallel with the coach stream; emit `challenge` (max 1/msg),
  buffered via `holdBuffer`. **Suppress entirely when gate==='ground'** (invariant #5).
- **Verify:** handler test; suppressed under grounding.

#### T3.3 — ChallengeCard + evidence write-back
- **Depends:** T3.2
- **Files:** `src/ui/src/components/ChallengeCard.tsx` (new, mirrors `ActionCard`), `src/ui/src/api.ts`
- **Contract:** render counterpoint + tests, dismissable; on surface, append any `disconfirming` notes to
  the relevant `BeliefRecord.disconfirming_evidence`.
- **Verify:** manual + store assertion.

---

### Phase 4 — Living artifacts

#### T4.1 — `artifact_draft` frame + create
- **Depends:** T0.5
- **Files:** `src/server-ui.ts`, `src/ui/src/api.ts`
- **Contract:** plays with an `artifact` produce an `artifact_draft` (buffered like actions);
  `POST /api/advisor/artifacts` creates it.
- **Verify:** endpoint test.

#### T4.2 — ArtifactCard + ArtifactsSection (versioned)
- **Depends:** T4.1
- **Files:** `src/ui/src/components/ArtifactCard.tsx`, `ArtifactsSection.tsx` (mirror Memory components +
  `AdvisorHistory` list→detail)
- **Contract:** collapsible list; PATCH appends a new version; version-history drill-down.
- **Verify:** manual; versions visible, append-only.

#### T4.3 — `entity_update` / stale-artifact surfacing
- **Depends:** T2.2, T4.2
- **Files:** `src/server-ui.ts`, `AdvisorChat.tsx`
- **Contract:** on session-open, surface `entity_update` for artifacts flagged stale by the last
  consolidation ("Plan B assumed X — that's shifted").
- **Verify:** manual with a forced pivot.

---

### Phase 5 — Brain-dump decomposer

#### T5.1 — `/triage`
- **Depends:** T1.2
- **Files:** `src/server-ui.ts`
- **Contract:** `POST /api/advisor/triage { dump }` → `thread_candidate{label, play, charge}` frames
  (planner pass, spec §3). Writes remaining threads as `open_loop` episodic records.
- **Verify:** endpoint test.

#### T5.2 — Thread chips
- **Depends:** T5.1, T1.7
- **Files:** `src/ui/src/components/AdvisorChat.tsx`
- **Contract:** render candidates as selectable chips (reuse `SUGGESTED_PROMPTS` styling); tap → focused
  coach stream with that `play` pre-selected.
- **Verify:** manual.

---

### Phase 6 — Views & open ritual

#### T6.1 — State chart
- **Depends:** T0.4
- **Files:** `src/server-ui.ts` (`GET /api/advisor/state-log`), `src/ui/src/views/StateChartView.tsx`
- **Contract:** arousal/valence trend + active-fear count over time (recharts, your chart vocabulary).
- **Verify:** manual.

#### T6.2 — Entity browser + timeline
- **Depends:** T0.3, T2.1
- **Files:** `GET /api/advisor/entities/:type`, `:id/timeline`,
  `src/ui/src/views/EntityTimeline.tsx`
- **Contract:** browse beliefs/fears/values/commitments; timeline renders reconciliations as the
  evolution record.
- **Verify:** manual with a reconciled belief.

#### T6.3 — Session-open ritual
- **Depends:** T0.2, T0.3, T4.3
- **Files:** `src/server-ui.ts` (chat handler, first-turn branch)
- **Contract:** beyond `selectMemoriesForContext`, inject active entity summaries relevant to the topic +
  `open_loop` records + stale-artifact flags (spec §9).
- **Verify:** handler test; injected context present on first turn only.

---

## 4. Definition of done (whole layer)

- All ledger boxes ticked; `npm run typecheck && npm test` green under `CLAUDE_CLI_DISABLED=1`.
- Manual end-to-end: brain dump → thread pick → play runs → Challenger card appears → grounding fires on a
  ruminating input (and Challenger suppressed) → session close writes episodic + consolidates → a forced
  belief pivot produces a reconciliation visible in the timeline → an artifact versions correctly.
- Every §1 invariant demonstrably holds. `pm`/`chairman`/ActionCards/`memories.jsonl` unchanged.

---

## 5. Progress ledger (update as you go)

```
Phase 0  [ ] T0.1  [ ] T0.2  [ ] T0.3  [ ] T0.4  [ ] T0.5
Phase 1  [ ] T1.1  [ ] T1.2  [ ] T1.3  [ ] T1.4(GATE)  [ ] T1.5  [ ] T1.6  [ ] T1.7  [ ] T1.8(GATE)
Phase 2  [ ] T2.1  [ ] T2.2  [ ] T2.3  [ ] T2.4
Phase 3  [ ] T3.1  [ ] T3.2  [ ] T3.3
Phase 4  [ ] T4.1  [ ] T4.2  [ ] T4.3
Phase 5  [ ] T5.1  [ ] T5.2
Phase 6  [ ] T6.1  [ ] T6.2  [ ] T6.3
```

---

## 6. Open decisions — STOP and ask Mike (do not guess)

1. **State classifier approach (T1.3).** Heuristic+LLM hybrid is the starting point, but the
   processing-vs-rumination call needs a labelled **eval set** before it gates real sessions. Decide:
   build a fixture set now (preferred) vs. a small fine-tune later. This is the highest-stakes piece.
2. **Referral content (T1.8).** Real outward pointers — who/what the `refer` path surfaces. Must be
   confirmed, not invented.
3. **Prism wiring.** `PrismTier` → concrete model resolution. If Prism isn't callable from this service
   yet, fall back to the persona `model` field and flag it. Confirm the tier→role mapping (spec §11).
4. **Existing `memories.jsonl`.** Leave as-is (recommended) vs. backfill any of it into typed entities.
5. **Consolidation trigger cadence.** On-close only (default) vs. also a nightly cron — confirm before
   adding scheduling.

---

## 7. Start here

```
1. Create branch feat/advisor-coaching.
2. Read docs/advisor-architecture.md and docs/advisor-coaching-spec.md fully.
3. Paste the Progress Ledger (§5) into the PR description.
4. Begin T0.1. One task, verify, tick, commit. Repeat.
5. At T1.4 and T1.8, stop at the GATE until its condition holds.
6. Surface every §6 item to Mike before implementing anything that depends on it.
```
