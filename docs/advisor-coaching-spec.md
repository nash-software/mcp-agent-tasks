# Advisor Coaching Layer — Build Spec

> Extends `docs/advisor-architecture.md`. This is a superset, not a rewrite. Every existing
> primitive (persona JSON, `spawnClaudeStream`, SSE frames, `advisorSessionLogs`, reflection-on-close,
> `selectMemoriesForContext`, the ActionCard/MemoryChip UI vocabulary) is reused. New behaviour is added
> by (a) one new persona that routes to **plays**, (b) a typed memory tier beside `memories.jsonl`,
> (c) a consolidation pass that upgrades the existing close handler, and (d) two safety subsystems.

---

## 0. Design stance (non-negotiable)

The coaching layer asks for three things — **persistent memory, personalisation, and progressive
deepening**. Those are the same three properties that, combined, drive belief entrenchment and
rumination loops. Recent literature is consistent on this: memory recall + agreement + deepening is the
mechanism behind sycophantic spiralling, and "deceptive empathy" ("I see you") manufactures false rapport.

Therefore two things are **structural components, not garnish**:

1. **A disconfirmation function** (`Challenger`) that runs as a permanent counterweight, in a *separate
   instance* so it doesn't inherit the coach's sycophancy gradient.
2. **A state-gate** that distinguishes *processing* (movement) from *rumination* (looping with more
   detail), switches from deepening to grounding when dysregulated, and refers outward past a threshold.

**Hard rule:** no deepening play ships to real use before the state-gate and referral path exist
(Phase 1 below). Deepening without the gate is the dangerous configuration.

The system's job is **a mirror with memory, not an oracle**. It asks more than it tells, metabolises the
user's *own* prior insight back to them, and resists closing every loop.

---

## 1. What changes vs. what is preserved

| Existing primitive | Treatment |
|---|---|
| `pm` / `chairman` personas | **Unchanged.** |
| `coach` persona | **Becomes a router.** When `mode === 'coach'`, a triage pre-pass selects a **play**; the play's protocol is injected into the system prompt the same way chairman-only goal context is injected today (invariant #6). |
| `spawnClaudeStream` | Reused as-is for the coach stream. A **second, isolated** spawn is added for the Challenger. |
| `advisorSessionLogs` (in-memory, cap 200) | Unchanged. Becomes the source for the consolidation pass on close. |
| Reflection-on-close (`claude -p` → 2–3 ≤150-char memories) | **Kept**, but runs *alongside* the new consolidation pass. Lightweight memories stay for the "things I know about you" block; typed entities are new. |
| `AdvisorMemory` / `memories.jsonl` | **Unchanged.** A new tier of typed stores sits beside it. |
| `selectMemoriesForContext` / decay | Unchanged. The session-open ritual additionally injects typed-entity context. |
| ActionCard (`create_task` etc.) | Unchanged. Coach still **never** emits ActionCards (invariant preserved). Coach may emit `artifact_draft` and `entity_update`. |
| SSE frame union | **Extended** with 6 new frame types (§7). |
| `/api/advisor/*` surface | **Extended** with triage, entities, artifacts, state-log, consolidate (§8). |

Net: nothing is removed; the coach persona gains a play router, memory gains a typed semantic tier, close gains a consolidation pass, and two safety subsystems are added.

---

## 2. The Play system (frameworks as injectable protocols)

A **play** is a framework rendered as an injectable protocol, structurally identical to a persona JSON so
it loads through the same pattern (`PERSONAS` in `lib/advisor.ts` → add `PLAYS`).

### Schema — `src/ui/src/advisor/plays/*.json`

```typescript
interface Play {
  id: PlayId
  label: string
  intent: string                 // one-line: what the user state looks like when this fits
  trigger_signals: string[]      // phrases/affect the triage classifier keys on
  protocol: string[]             // the ordered method (the "how")
  opening_moves: string[]        // first 1–2 questions, non-leading
  deepening_questions: string[]  // the laddering/arrow engine for this play
  do_not: string[]               // failure modes — e.g. "do not supply the answer to a downward-arrow"
  writes: EntityType[]           // which typed stores this play populates
  artifact?: ArtifactKind        // living doc it can produce
  exit_criteria: string          // when the play is "done" (answers circling = bedrock reached)
  model_hint: PrismTier          // resolved via Prism, not hardcoded
  safe_when_dysregulated: boolean // false ⇒ state-gate blocks it under high arousal
}
```

### Initial play catalogue

| `id` | Fits | Writes | Artifact | `safe_when_dysregulated` |
|---|---|---|---|---|
| `ladder` | "what do I actually want / my why" | `value` | — | true |
| `downward_arrow` | a worry → core belief | `belief` | — | false |
| `odyssey` | life-direction, multiple futures | `value` | `odyssey_plan` | true |
| `best_possible_self` | low motivation, foggy direction | `value` | `future_self_letter` | true |
| `immunity` | a stuck pattern that resists willpower | `commitment`, `belief` | `immunity_map` | true |
| `focusing` | a fear with body charge, pre-verbal | `fear` | `fear_map` | gated |
| `somatic_pendulation` | high activation, needs resourcing | `state` | — | **safe** (this *is* the grounding play) |
| `ifs_parts` | "a part of me…", inner conflict | `fear`, `belief` | — | gated |
| `byron_katie` | a stressful belief stated as fact | `belief` | — | false |
| `fear_setting` | cognitive worst-case spiral | — | — | true |
| `regret_min` | a fork-in-the-road decision | `value` | — | true |

`PlayId` and `ArtifactKind` are string-literal unions in `src/types/advisor.ts`.

### Play router (coach mode only)

On a coach-mode turn, before building the prompt:

1. **State-gate first** (§6) — runs always, cannot be skipped.
2. If gated to grounding → force `play = somatic_pendulation`, emit `state_flag`.
3. Else **triage**: fast classifier (Prism cheap tier) maps the message + recent state to a `PlayId`
   using `trigger_signals`. Emit `play_active { play, reason }`.
4. Inject `play.protocol` + `play.opening_moves`/`deepening_questions` into the system prompt
   (same conditional-injection mechanism as chairman goal context).
5. Stream as normal. The Challenger (§5) runs async in parallel.

The user sees one face. The play indicator surfaces as a chip in `ChatHeader`, nothing more.

---

## 3. Brain-dump decomposer (triage into streams)

New endpoint `POST /api/advisor/triage`. Input: a raw dump. Output: a planner pass (not a router pass)
that **surfaces threads for the user to choose** rather than auto-resolving them.

```
dump → classifier → ThreadCandidate[] (each: label, play, charge 0–1, one-line framing)
     → emit `thread_candidate` SSE frames (rendered as selectable chips, like SUGGESTED_PROMPTS)
     → user taps one → starts a focused coach stream with that play pre-selected
     → remaining threads written as open loops (EpisodicRecord with `open_loop: true`)
```

Rationale: depth beats breadth — one thread fully worked beats four skimmed. Open loops are resurfaced by
the session-open ritual (§9).

---

## 4. Memory architecture v2

Three tiers. The first already exists in your `full_log`; the second and third are new.

### 4.1 Episodic — full fidelity, no write-time summarisation

Your `AdvisorSession.full_log` already stores verbatim turns — keep that, and **do not summarise at write
time**. Summarising on write collapses distinct episodes into generalisations and destroys the episodic
signal (texture, the exact felt-sense words, the moment something shifted) before consolidation can use it.

Promote `full_log` to a queryable store with tags:

```typescript
interface EpisodicRecord {
  id: string
  session_id: string
  ts: string
  role: 'user' | 'assistant'
  content: string              // verbatim, untruncated
  play?: PlayId
  state_tags?: StateTag[]      // affect/somatic markers detected on the turn
  charge?: number              // 0–1 affective intensity
  open_loop?: boolean
}
```

Path: `~/.mcp-tasks/advisor-sessions/episodic/<session_id>.jsonl`

### 4.2 Semantic — typed entities (the psyche's second brain)

These are populated **only** by the consolidation pass (§4.4), never at write time.

```typescript
type EntityStatus = 'active' | 'softening' | 'reconciled' | 'dormant'
type EntityType   = 'belief' | 'fear' | 'value' | 'commitment'

interface BeliefRecord {
  id: string
  statement: string                 // "I'm not good enough"
  downward_arrow: string[]          // chain to bedrock
  first_surfaced: string
  last_surfaced: string
  surfaced_count: number
  status: EntityStatus
  disconfirming_evidence: { ts: string; note: string; source_session: string }[]
  reconciliation?: TimeBoundSummary // written on pivot; never overwritten
  linked_fears?: string[]
  linked_commitments?: string[]
}

interface FearRecord {
  id: string
  name: string
  body_location?: string            // "throat", "chest"
  felt_age?: string                 // "about 7"
  origin?: string
  what_shifts_it?: string[]         // resources that helped (for pendulation)
  sessions: string[]
  status: EntityStatus
}

interface ValueRecord {
  id: string
  value: string                     // terminal value
  ladder: string[]                  // laddering chain that surfaced it
  source_session: string
  confidence: number
}

interface CommitmentRecord {        // Immunity-to-Change map, stored
  id: string
  improvement_goal: string
  counter_behaviours: string[]
  hidden_commitment: string
  big_assumption: string
  tests_run: { ts: string; test: string; outcome: string }[]
  status: EntityStatus
}
```

Paths: `~/.mcp-tasks/advisor-sessions/entities/{beliefs,fears,values,commitments}.jsonl`

### 4.3 State log

```typescript
type StateMode = 'processing' | 'ruminating' | 'grounded' | 'flat'

interface StateLogEntry {
  ts: string
  session_id?: string
  valence: number          // -1..1
  arousal: number          // 0..1  (nervous-system activation)
  mode: StateMode
  somatic_notes?: string
  triggers?: string[]
}
```

Path: `~/.mcp-tasks/advisor-sessions/state-log.jsonl`. Directly chartable (nervous-system trend, theme
frequency, which fears are currently `active`).

### 4.4 Consolidation pass + arbiter (the memory upgrade)

Extends the existing close handler. After `full_log` is persisted, before the in-memory log is deleted:

```
1. Read episodic full_log for the session.
2. Extract candidate entity updates (new/changed beliefs, fears, values, commitments, state).
3. For each candidate, run the ARBITER against existing entities of that type:
     duplicate  → bump surfaced_count / last_surfaced, no new record
     refinement → merge fields, keep id
     pivot      → DO NOT delete; write a TimeBoundSummary into reconciliation,
                  set status accordingly, append the new framing
4. Append StateLogEntry.
5. Artifact staleness check: if a pivot invalidates an assumption referenced by a living
   artifact, flag it (don't auto-edit) → entity_update frame on next open.
```

```typescript
interface TimeBoundSummary {
  // "held as load-bearing until ~2026-02; now held more lightly"
  text: string
  reconciled_at: string
  prior_value: string
  new_value: string
}
```

This is **deliberate, triggered** consolidation — the episodic→semantic transition does not happen
automatically and is the step most systems skip. The arbiter's reconciliation (never overwrite, compress
to a time-bound summary) is what lets the system **show the user their own evolution** — the single most
therapeutically valuable feature here, and one no off-the-shelf product has.

Trigger: on session close (default) and via `POST /api/advisor/consolidate` (manual / scheduled cron).
Must be **idempotent** — re-running on the same session must not double-write (dedupe by
`session_id` + entity content hash).

---

## 5. Challenger (disconfirmation subsystem)

A permanent counterweight to sycophancy. **Runs in a separate spawn with its own context** — if it shares
the coach instance it inherits the agreement gradient and pulls its punches.

```
coach turn streams (instance A)
        │  (in parallel, fire-and-async)
        └─ spawnClaudeStream(instance B, COLD)
             input:  current user claims + matched BeliefRecord(s) + downward_arrow + disconfirming_evidence
             prompt: adversarial-to-the-narrative; job = (a) surface evidence against the current story,
                     (b) test the big_assumption, (c) run a Byron Katie turnaround, (d) flag loop-vs-progress
             output: → emit `challenge { counterpoint, tests[] }`  (max 1 per message)
```

UI: a `ChallengeCard` below the assistant message, beside `ActionCard` — dismissable, same vocabulary.

**Gating:** the Challenger is **suppressed during grounding mode** (you do not challenge someone who is
dysregulated — §6 wins). It also collects, not just confronts: turnaround results and disconfirming notes
are written back to `BeliefRecord.disconfirming_evidence`, so the ledger accrues counter-evidence over time.

Model: a deliberately *different* Prism tier from the coach (rigor-biased), reinforcing the isolation.

---

## 6. State-gate (safety subsystem) — runs first, always

Extends your existing heuristic regex (the `memory_candidate` detector) into a cheap state classifier on
every user message, **before** any deepening play is selected.

```
classify(message, recent StateLog) → { mode, arousal, valence }

ordering (cannot be reordered — invariant):
  if mode === 'ruminating'  OR arousal high:
       → emit state_flag { mode, action: 'ground' }
       → force play = somatic_pendulation (resourcing, NOT deepening)
       → suppress Challenger
  if sustained high distress across N turns  OR crisis language:
       → emit state_flag { action: 'refer' }
       → stop deepening; name it plainly; point OUTWARD
         (Mariyana, osteopath, a human, crisis resources)
       → this OVERRIDES persona/preferences (the one place the system overrules the user)
  else:
       → proceed to triage (§2)
```

For your OCD/anxiety/rumination pattern specifically, the processing-vs-rumination distinction is a
genuine feature, not liability-cover: it stops the system rewarding a loop by feeding it more depth.

UI: reuses your nudge-banner mechanism (a `StateRibbon` instead of/alongside the persona-switch banner).

---

## 7. New SSE frame types

Extend `AdvisorChatFrame`:

```typescript
type AdvisorChatFrame =
    /* …existing: delta | session | done | error | nudge | action_draft | memory_candidate… */
  | { type: 'thread_candidate'; id: string; label: string; play: PlayId; charge: number }
  | { type: 'play_active';      play: PlayId; reason: string }
  | { type: 'challenge';        id: string; counterpoint: string; tests?: string[] }
  | { type: 'state_flag';       mode: StateMode; action: 'ground' | 'pause' | 'refer' }
  | { type: 'artifact_draft';   id: string; kind: ArtifactKind; title: string; body: string }
  | { type: 'entity_update';    id: string; entityType: EntityType; summary: string }
```

Buffering note: `challenge` and `artifact_draft` JSON must be held in `holdBuffer` and parsed out of the
stream exactly like the existing ` ```actions ` block — never leaked as `delta` text.

---

## 8. API surface additions (all in `server-ui.ts`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/advisor/triage` | Brain-dump → `thread_candidate` frames |
| POST | `/api/advisor/consolidate` | Run consolidation pass (manual/scheduled); idempotent |
| GET | `/api/advisor/entities/:type` | List beliefs/fears/values/commitments |
| PATCH | `/api/advisor/entities/:type/:id` | Edit status / fields (user correction) |
| GET | `/api/advisor/entities/:type/:id/timeline` | Evolution view (reconciliations) |
| GET | `/api/advisor/state-log` | For charting (range params) |
| GET | `/api/advisor/artifacts` | List living artifacts |
| POST | `/api/advisor/artifacts` | Create from `artifact_draft` |
| PATCH | `/api/advisor/artifacts/:id` | New version (append to `versions[]`) |

`/api/advisor/chat` is extended in place (play selection, challenge spawn, state-gate). All existing
invariants from the base doc still hold — `sessionId` format guard, `res.on('close')` guard, action-block
buffering, `[switch:…]` nudge protocol, `CLAUDE_CLI_DISABLED`.

---

## 9. Session lifecycle v2

**Open ritual** (extends memory injection). Beyond `selectMemoriesForContext`, inject:
- active `BeliefRecord`/`FearRecord` summaries relevant to the entry topic
- any `open_loop` episodic records ("last time you left a thread about Y")
- any artifact flagged stale by the last consolidation ("your Odyssey Plan B assumed the consultancy
  wouldn't take off — that's shifted; redraw?")

**During.** State-gate → triage → play injection → coach stream + async Challenger. State logged per turn.

**Close** (extends current handler):
```
1. Persist full_log → episodic/<id>.jsonl        (verbatim, no summary)   ← unchanged behaviour, promoted
2. Run consolidation pass + arbiter (§4.4)        (NEW)
3. Lightweight reflection → memories.jsonl         (KEPT, runs alongside)
4. Append StateLogEntry; artifact staleness check  (NEW)
5. Delete in-memory log                             (unchanged)
```

---

## 10. Living artifacts

```typescript
type ArtifactKind =
  'odyssey_plan' | 'immunity_map' | 'values_charter' | 'fear_map'
  | 'future_self_letter' | 'belief_ledger'

interface Artifact {
  id: string
  kind: ArtifactKind
  title: string
  created_at: string
  updated_at: string
  versions: { ts: string; body: string }[]   // versioned — never overwrite
  linked_entities: string[]
}
```

These are simultaneously outputs and memory anchors. Key property: **living and resurfaced**, not
generated once. The open ritual brings them back; consolidation flags them stale. UI: `ArtifactCard` +
collapsible `ArtifactsSection` (mirrors `MemoriesSection`), with a version-history drill-down (mirrors
`AdvisorHistory`'s list→detail pattern).

---

## 11. Model routing (Prism)

Resolve per role rather than hardcoding in persona JSON:

| Role | Prism tier | Why |
|---|---|---|
| State classifier / triage | cheapest, fastest | 50–100ms budget; runs every turn |
| Coach front (default) | mid (sonnet-class) | warm, fluent, present |
| Coach front (depth session) | high (opus-class) | for `immunity` / `ifs_parts` / `odyssey` |
| Challenger | high, **separate instance**, rigor-biased | deliberately uncorrelated with coach |
| Consolidation / arbiter | mid, structured-output | reliable JSON entity extraction |

---

## 12. New / changed invariants (safety-critical)

1. **Challenger isolation** — never shares instance or context with the coach persona.
2. **State-gate ordering** — distress check runs *before* play selection; no deepening play runs under
   high arousal. This ordering is not configurable.
3. **No write-time episodic summarisation** — `full_log` stored verbatim; semantic entities derive only in
   consolidation.
4. **Arbiter never deletes on pivot** — writes a `TimeBoundSummary`; the evolution record *is* the value.
5. **Reconciliations are append-only.**
6. **Challenger gated off during grounding mode.**
7. **Referral override** — sustained-distress threshold overrides persona/preferences and points to
   humans. The only place the system overrules the user.
8. **Coach emits no ActionCards** (preserves base invariant) — may emit `artifact_draft` / `entity_update`.
9. **Play injection mirrors chairman-only context injection** (conditional system-prompt augmentation).
10. **Consolidation idempotency** — dedupe by `session_id` + entity content hash; safe to re-run.

---

## 13. Build phases (sequenced so safety never lands last)

| Phase | Ships | Gate |
|---|---|---|
| **0** | Typed stores + schemas; promote `full_log` to episodic store | — |
| **1** | Play system (JSON + injection + coach router) **+ State-gate + referral path** | **Do not expose any deepening play before the state-gate exists.** |
| **2** | Consolidation pass + arbiter (memory v2) | Idempotency tested |
| **3** | Challenger + `ChallengeCard` (separate instance) | Isolation verified |
| **4** | Living artifacts + versioned `ArtifactsSection` | — |
| **5** | Brain-dump decomposer (`/triage` + `thread_candidate` chips) | — |
| **6** | State chart + entity timeline views | — |

---

## 14. Files to add / modify

| File | Change |
|---|---|
| `src/ui/src/advisor/plays/*.json` | **New** — one per play (§2) |
| `src/types/advisor.ts` | **Modify** — `PlayId`, `ArtifactKind`, entity interfaces, `EpisodicRecord`, `StateLogEntry`, extended `AdvisorChatFrame` |
| `src/store/advisor-memory.ts` | **Modify** — keep existing; add typed-entity read/write |
| `src/store/advisor-entities.ts` | **New** — belief/fear/value/commitment stores + arbiter |
| `src/store/advisor-consolidation.ts` | **New** — consolidation pass |
| `src/store/advisor-state.ts` | **New** — state classifier + state-log |
| `src/ui/src/lib/advisor.ts` | **Modify** — add `PLAYS`, play router, triage |
| `src/ui/src/lib/challenger.ts` | **New** — isolated Challenger spawn |
| `src/ui/src/components/ChallengeCard.tsx` | **New** (mirrors `ActionCard`) |
| `src/ui/src/components/StateRibbon.tsx` | **New** (mirrors nudge banner) |
| `src/ui/src/components/ArtifactCard.tsx` / `ArtifactsSection.tsx` | **New** (mirror Memory components) |
| `src/ui/src/views/StateChartView.tsx` / `EntityTimeline.tsx` | **New** |
| `src/ui/src/advisor/personas/coach.json` | **Modify** — becomes the play-routing front |
| `src/server-ui.ts` | **Modify** — new endpoints (§8); extend chat handler with state-gate, play injection, Challenger spawn, consolidation-on-close |
| `src/ui/src/api.ts` | **Modify** — new fetchers + extended frame handling |
