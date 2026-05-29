# P1-07: Reskin the Brain Dump view (multi-line capture → LLM-decomposed candidate cards)

**Type**: Feature  **Phase**: 1  **Epic**: MCPAT-022  **Size**: M

> Size rationale: `BrainDumpView` is one of the **most-complete existing views** — the full
> input → processing → review → done flow already works against the real endpoints (parse, commit,
> ACR dispatch, Whisper). This spec is therefore largely a **token reskin** of two files plus a few
> behavioural gaps (in-panel processing message, content preservation guarantees, "Create all N",
> "Dump again" reset, and an `initialText` entry point for the P2-03 handoff). No new endpoints, no
> new client state shape — so it is an M, not an L.

---

## Description

**WHY:** A brain dump is the one capture surface that deliberately removes every routing decision at
write time. The user writes anything — tasks, ideas, worries, plans — in one freeform blob; the LLM
(`POST /api/capture/braindump`) decomposes it into discrete, routed task candidates that the user can
then triage and commit. This is the antidote to the epic-wide anti-pattern *"asking 'where does this
go?' at capture time"* (`docs/life-os/specs/00-epic-overview.md` §9): the user offloads cognition in
bulk and reviews structured output, rather than making N micro-decisions while the thought is still
forming. The flow must therefore feel safe to dump into — **input is never lost**, on processing,
on parse failure, or on a network error — because a capture tool that can drop a thought is one the
user will stop trusting and stop using.

The existing implementation (`src/ui/src/views/BrainDumpView.tsx`,
`src/ui/src/components/CandidateCard.tsx`, `src/ui/src/hooks/useBrainDump.ts`) is **functionally
complete** against the real endpoints but visually plain — hardcoded `slate/violet/emerald`
utilities, a 5-row textarea with a hard border, a `🎙`/`⏹` emoji mic, and an `<option>`-list area
selector instead of the design's area chips. This spec reskins it to the P1-01 token layer to match
the prototype and screenshot, and fills the behavioural gaps below.

See for context (do not duplicate — cite):
- `docs/life-os/specs/00-epic-overview.md` §3 (tokens), §4 (data shapes), §5 (client conventions),
  §6 (`braindump.jsx` → `views/BrainDumpView.tsx` + `components/CandidateCard.tsx`), §9 (anti-patterns).
- `design_handoff_life_os/README.md` §6.5 (Brain Dump view spec).
- `design_handoff_life_os/reference/braindump.jsx` (`BrainDumpView` + `CandidateCard` — visual/behavioural reference only, not production code).
- `design_handoff_life_os/screenshots/04-braindump.png` (target fidelity).

---

## Acceptance Criteria

- [ ] **Input panel reskin.** The view is a full main-content panel (not a modal). A large
      `<textarea>` of **≥8 rows** sits on a subtle `surface-1` background with **no hard border**,
      placeholder exactly `Write anything. Tasks, ideas, worries, plans. ⌘+Enter to process.`. A mic
      button (Whisper) sits **top-right** of the textarea; a **char/line counter** ("N chars · M
      lines") sits **bottom-left**. The **Process** primary CTA carries a `⌘↵` kbd hint and is
      disabled while the textarea is empty. All colours/typography come from the P1-01 tokens
      (`bg`/`surface.*`/`ink.*`/`accent`, Geist) — no remaining `slate/violet/emerald` literals.
- [ ] **⌘/Ctrl+Enter processes** the dump from the input phase (matches the existing
      `handleKeyDown` + global listener), and the Process button triggers the same path.
- [ ] **Content preserved during processing.** While `parseMutation.isPending`, the view shows an
      **in-panel** progress line of the form `Parsing N tasks from your dump…` (N from the current
      text) and the **textarea content is retained** (never cleared on submit); processing aborts at
      a **60s** cap with the text intact (see Failure Modes).
- [ ] **Candidate review.** On success, the input is replaced by a `CandidateCard` list from
      `POST /api/capture/braindump`'s `{ title, project, area, why }[]`. Each card has an **editable
      title** (the **first card auto-focused**), a **project `<select>`**, **four area chips**
      (`client`/`personal`/`outsource`/`internal`, each with its area-colour dot from P1-01
      `tokens.ts`, selected chip highlighted), a **collapsible "Why"** (open by default when a `why`
      was inferred), and actions **Create task** (green/`status.green`) / **→ ACR** / discard `×`.
- [ ] **→ ACR greyed when offline.** The `→ ACR` action is disabled (greyed, `cursor-not-allowed`,
      `title="ACR offline"`) whenever `useAcrStatus()` reports `offline` — never an error, never a
      thrown request (epic §5 graceful degradation).
- [ ] **Create all N.** A bulk action at the top of the review list reads **`Create all N`** (N =
      pending candidate count) and commits all not-yet-actioned candidates via
      `POST /api/capture/commit` in one call.
- [ ] **Parse failure preserves text.** If the parse returns no candidates (or errors), the view
      returns to the input phase showing `Couldn't parse this — here's your text back.` with the
      **raw textarea content still present** — input is never lost.
- [ ] **Done + reset.** When all candidates have been actioned, a done state shows
      `N task{s} created` and a **Dump again** button that clears the text and returns to the input
      phase.
- [ ] **Accepts initial text (P2-03 entry point).** The view accepts an `initialText?: string`
      prop (or equivalent route/handoff param) that, when present, prefills the textarea in the input
      phase and focuses it — defining the seam the P2-03 capture-bar handoff will pass text through.
      Re-supplying text (a new handoff) re-prefills via a change-detected effect (prototype uses a
      `seed.nonce`; the real impl may use the prop value/identity).

---

## Technical Notes

**Files touched (current state confirmed 2026-05-29):**
- `src/ui/src/views/BrainDumpView.tsx` — **reskin + gap-fill.** Already implements input/processing/
  review/done phasing, `⌘/Ctrl+Enter`, parse/commit/dispatch wiring, an inline `VoiceButton`
  (Whisper via `POST /api/transcribe`), and `Create all`. Restyle to P1-01 tokens; rename the bulk
  button to `Create all N`; add the in-panel `Parsing N tasks…` line; add the parse-failure copy
  `Couldn't parse this — here's your text back.`; add the done state `N tasks created` + `Dump
  again` reset; add the `initialText` prop/effect. The `max-w-3xl` content width can stay.
- `src/ui/src/components/CandidateCard.tsx` — **reskin + gap-fill.** Already has editable title,
  project `<select>`, collapsible why, and Create/ACR/discard actions. Replace the **area `<select>`
  with four area chips** (colour dots from P1-01 `tokens.ts`); restyle to tokens; ensure the first
  card is auto-focused (pass an `autoFocus` prop, set on `index === 0`); make the **Create task**
  button green and the **→ ACR** button the greyed-when-offline variant.
- `src/ui/src/hooks/useBrainDump.ts` — **no change expected.** Already exposes
  `parseMutation`/`commitMutation`/`dispatchMutation` and invalidates `['tasks']` + `['stats']` on
  commit. Add a 60s abort cap here only if the parse is not already bounded (see Failure Modes).
- `src/ui/src/lib/tokens.ts` (from P1-01) — **consume**, do not re-derive. Area chip dot colours and
  status-green come from this single source of truth; do not hardcode area hexes in the card.

**Endpoint shapes (already wired in `src/ui/src/api.ts` — do not change the server):**
- `POST /api/capture/braindump` — `{ text: string } → { candidates: BrainDumpCandidate[]; error?: string }`,
  where `BrainDumpCandidate = { title: string; project: string; area: 'client'|'personal'|'outsource'|'internal'; why?: string }`.
- `POST /api/capture/commit` — `{ candidates: BrainDumpCandidate[] } → { created: string[] }` (throws on non-2xx).
- `POST /api/acr/dispatch` — `{ title, detail } → { jobId?: string; error?: string }` (an `error` value = ACR offline/unavailable, not a thrown failure).
- `GET /api/acr/status` via `useAcrStatus()` — drives the `→ ACR` greyed state (`offline` boolean).
- `POST /api/transcribe` via the inline `VoiceButton` — multipart `audio/webm` → `{ text }`, appended to the dump.

**What already exists vs. what is a reskin gap:**
- *Exists:* phase state machine, `⌘/Ctrl+Enter`, parse→review→commit/dispatch flow, Whisper mic,
  per-card commit + bulk commit, ACR offline disabling on the card, project select, collapsible why.
- *Gap (reskin):* token-based styling, ≥8-row borderless textarea, top-right mic, bottom-left
  char/line counter, area **chips** (not a select), green Create button, `⌘↵` kbd hint on Process.
- *Gap (behaviour):* in-panel `Parsing N tasks from your dump…` copy; the exact parse-failure copy
  `Couldn't parse this — here's your text back.`; the `N tasks created` + `Dump again` done state;
  the `initialText` prop entry point; an explicit 60s cap on processing.

**`initialText` entry point for P2-03.** Add `initialText?: string` to `BrainDumpView`'s props (the
view is already prop-driven — it takes `projects: string[]`). On mount, and whenever a *new*
`initialText` arrives, prefill the textarea, set phase to `input`, clear stale candidates, and focus
the textarea. The prototype models this with a `seed = { text, nonce }` object and a
`useEffect([seed.nonce])`; the real impl can key the effect on the prop value or a passed nonce. The
**handoff wiring itself is P2-03** — this spec only guarantees the prop exists and behaves.

**Enum note:** the prototype's `inferCandidate`/`PROJECT_HINTS` client-side parsing is **reference
only** — the real view calls the LLM endpoint and must not reintroduce a client parser. Areas use the
canonical `'client'|'personal'|'outsource'|'internal'` union already in `api.ts`.

---

## Failure Modes

- **Parse failure (no candidates / `error` returned):** return to the input phase, show
  `Couldn't parse this — here's your text back.`, and keep the raw textarea content. **Never lose
  input.** (Existing code already preserves `dump` and surfaces `result.error` — verify, don't
  rebuild.)
- **Network/parse error (`onError`):** same guarantee — text retained, a non-destructive error
  message shown, view stays usable; no uncaught rejection.
- **ACR offline / dispatch returns `error`:** the `→ ACR` action is greyed and disabled while
  `useAcrStatus()` is offline; if a dispatch nonetheless returns `{ error }`, the card shows the
  offline/failed state rather than throwing (epic §5).
- **Transcribe (Whisper) failure / mic permission denied:** the inline `VoiceButton` already catches
  `getUserMedia` `NotAllowedError` and transcription failures and surfaces a small inline message
  while leaving any already-typed dump untouched; reskin must preserve this (no thrown error, text
  intact).
- **Processing exceeds 60s:** the parse is capped at **60s**; on timeout the view returns to the
  input phase with the text preserved and a non-destructive timeout/parse-failure message — it must
  not spin indefinitely or blank the panel.

---

## Out of Scope

- **The capture-bar → Brain Dump prefill handoff itself (P2-03).** This spec only *defines and
  honours* the `initialText` entry point; wiring `CaptureOverlay`/the capture bar to pass text into
  it is P2-03.
- **Backend changes — none.** All four endpoints (`braindump`, `commit`, `acr/dispatch`,
  `transcribe`) and `GET /api/acr/status` already exist and are unchanged. No new endpoint, no
  `server-ui.ts` edit, no task-store/schema change.
- Reskinning other views or the shell (P1-02..P1-06, P1-08..P1-10).
- The Hermes/agent layer and any `agent_status` interaction (Phase 2).
- Shipping `reference/braindump.jsx`, `reference/data.js`, or any mock layer (epic §6, §10).

---

## Dependencies

- **P1-01** (design-system foundation) — provides the token layer (`tailwind.config.js`,
  `index.css` base, `lib/tokens.ts` area/status colour maps) this reskin consumes. Per the epic
  overview §7, P1-07 depends only on P1-01 and is otherwise parallelizable with P1-03..P1-10.

---

## Testing

- `npm run type-check` passes (strict, no `any`) and `npm run build` succeeds.
- **Parse-failure preserves input (primary regression guard):** with `POST /api/capture/braindump`
  returning `{ candidates: [], error: ... }`, the view returns to the input phase, shows
  `Couldn't parse this — here's your text back.`, and the textarea still contains the original dump
  verbatim. Add/keep a test asserting the dump string is unchanged after a failed parse.
- **Content preserved during processing:** while the parse mutation is pending, the textarea content
  is unchanged and the panel shows `Parsing N tasks from your dump…`.
- **→ ACR greyed when offline:** with `useAcrStatus()` reporting `offline: true`, every card's
  `→ ACR` action is disabled and carries the `title="ACR offline"` (or equivalent) attribute; no
  dispatch request fires on click.
- **Create all N + done reset:** committing all candidates leaves a `N tasks created` done state and
  a working `Dump again` reset that returns to an empty input phase.
- **`initialText` entry point:** rendering `<BrainDumpView initialText="…" />` prefills and focuses
  the textarea in the input phase; supplying new `initialText` re-prefills.
- In-browser (run `serve-ui`): visual match against `screenshots/04-braindump.png` — ≥8-row
  borderless textarea on `surface-1`, top-right mic, bottom-left counter, area chips with colour
  dots, green Create button, `⌘↵` on Process.

---

## Open Questions

- **InboxView absorbed here — DECIDED.** `InboxView` is deleted (P1-02 decision). Any `status:'draft'`
  tasks created by the passive-capture hook must surface as candidates in the Brain Dump candidate
  review list on load (via a `GET /api/tasks?status=draft` query merged with normal candidates, or the
  existing `/api/capture/braindump` flow). The `POST /api/tasks/:id/promote` action maps to "Create
  task" in the candidate card. Implement this draft-surfacing on entry to the Brain Dump view.
  *(User confirmed 2026-05-29.)*
- **Done-state copy + redirect:** README §6.5 specifies `N tasks created` + `Dump again`; the
  prototype also adds the sub-line "They're in your inbox and ready to commit to today." — keep that
  sub-line, or drop it? (Default: keep — it tells the user where the tasks went.)
- **`initialText` re-trigger key:** key the prefill effect on the prop value/identity, or require an
  explicit nonce from the P2-03 caller (matching the prototype's `seed.nonce`)? Decide with P2-03 so
  the same dump text dispatched twice still re-prefills. (Default: accept an optional nonce alongside
  `initialText` to disambiguate identical-text handoffs.)
- **60s cap mechanism:** enforce the timeout via an `AbortController` on the fetch in the API layer,
  or a client-side timer that resets phase? (Default: `AbortController` so the in-flight request is
  actually cancelled, not just visually abandoned.)
