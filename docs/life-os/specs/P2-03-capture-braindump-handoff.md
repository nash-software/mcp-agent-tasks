# P2-03 — Capture → Brain Dump handoff

**Type:** Feature
**Phase:** Phase 2 (Additive)
**Epic:** MCPAT-022 — Life OS UI Reskin + Agent Layer
**Size:** S

> Read `docs/life-os/specs/00-epic-overview.md` first for shared tokens (§3), data shapes (§4),
> client conventions (§5), and anti-patterns (§9). This spec does not repeat them.
> Reference: `design_handoff_life_os/README.md` §7.3 (lines 338–340, "Capture → Brain Dump handoff").
> This is the **glue** between two already-specified seams:
> - **P1-06** (`docs/life-os/specs/P1-06-capture-bar.md`) — ships the *affordances*: the capture
>   bar's expand icon and `Shift+Enter` both fire an `onExpand(text)` callback and clear the bar
>   (P1-06 AC 7, Out of Scope). It deliberately does **not** wire that callback to anything.
> - **P1-07** (`docs/life-os/specs/P1-07-braindump-view.md`) — ships the *receiver*: `BrainDumpView`
>   accepts an `initialText?: string` prop (+ optional nonce) that prefills and focuses the textarea
>   on mount and on each new handoff (P1-07 AC "Accepts initial text", Technical Notes "`initialText`
>   entry point for P2-03").
> This spec connects the two through `App.tsx`. No backend.

---

## Description

**WHY:** The single thought captured in the top bar and the freeform multi-line brain dump are the
**same act at two scales** — "get it out of my head". The frictionless path is to *start* typing in
the always-visible capture bar (one `Ctrl+Space` away, per P1-06) and, the moment the thought grows
past one line, **escalate without losing a keystroke**: the text already typed flows straight into
the Brain Dump editor, the view switches, and the cursor lands at the end of the prefilled text ready
to keep going. Without this glue the user has to re-type or copy-paste what they already wrote — a
friction tax on exactly the habit the system most wants to reward. P1-06 built the launch affordances
and P1-07 built the landing pad; both are inert until this spec joins them. Per epic §9, the handoff
must never ask "where does this go?" — it just moves the text and the focus.

Two ways to escalate, one outcome:
- **`Shift+Enter`** in the capture bar (the hidden power-user chord).
- The **expand icon** button in the bar's right cluster (the explicit, discoverable affordance —
  README §7.3 mandates this so we *don't rely on the chord alone*).

The mic transcript may also target Brain Dump rather than appending to the bar — this resolves the
P1-06 Open Question (mic destination) by routing through the same seam.

---

## Acceptance Criteria

1. **`Shift+Enter` escalates to Brain Dump with text prefilled + focused.** Pressing `Shift+Enter`
   in the capture-bar input with non-empty text: switches the active view to Brain Dump, prefills the
   Brain Dump textarea with exactly the bar's current text (verbatim, including any `#PREFIX` token),
   and focuses the textarea with the caret at the end. No quick-capture (`POST /api/capture/quick`)
   call fires for this path.
2. **The expand icon does the same.** Clicking the expand-icon button in the capture bar's right
   cluster performs the identical handoff (switch view → prefill → focus) with the bar's current
   text. The two paths share one code path (the `onExpand(text)` callback from P1-06).
3. **The capture bar clears after handoff.** Once the text has been handed off (either path), the
   capture-bar input is emptied so the user does not see the same text in two places. (P1-06 already
   clears the bar inside its `onExpand` affordance; this AC verifies the clear still happens after
   the callback is wired to a real consumer.)
4. **The seed is consumed exactly once.** After Brain Dump prefills from a handoff, navigating away
   and back to Brain Dump (or re-rendering it) does **not** re-apply the same text — the textarea
   keeps whatever the user has since typed (or emptied). The transient handoff state is cleared by
   the consumer after it is read.
5. **A fresh handoff while already on Brain Dump re-prefills.** If the user is already on Brain Dump
   and triggers a new handoff (e.g. mic transcript, or returns to the bar and expands again), the new
   text re-prefills the textarea even though the view did not change — disambiguated by a nonce so two
   handoffs of identical text still re-trigger (resolves P1-07 Open Question "`initialText` re-trigger
   key").

---

## Technical Notes

### The contract: `App`-level transient handoff state

`App.tsx` (`C:\code\mcp-agent-tasks\src\ui\src\App.tsx`) owns a single transient seed state and passes
it down to both ends of the handoff. Use a small object so identical text can be re-handed-off:

```ts
// App.tsx
interface BrainDumpSeed { text: string; nonce: number }

const [brainDumpSeed, setBrainDumpSeed] = useState<BrainDumpSeed | null>(null)

// passed to the capture bar (the producer)
const handleExpand = useCallback((text: string): void => {
  const trimmed = text.trim()
  if (trimmed === '') return               // empty → no-op (see Failure Modes)
  setBrainDumpSeed({ text, nonce: Date.now() })  // keep original text; nonce disambiguates
  setActiveTab('braindump')                // switch view (current state lives in App, see below)
}, [])
```

> Note: the current `App.tsx` is the pre-P1-02 flex-column shell using
> `const [activeTab, setActiveTab] = useState<TabId>('today')` (line 21) and renders
> `<BrainDumpView projects={projects} />` (line 59). After P1-02 the view state may be the
> prototype's `view`/`lifeos-view` localStorage state instead of `activeTab` — **wire to whatever the
> P1-02 shell exposes as the view setter**; the seed contract is independent of which it is.

### Producer side — capture bar (`CaptureOverlay`)

`C:\code\mcp-agent-tasks\src\ui\src\components\CaptureOverlay.tsx`. P1-06 already adds the
`onExpand(text: string)` prop and fires it from both `Shift+Enter` and the expand-icon click, then
clears the bar input. This spec only requires that `App` passes a real `onExpand={handleExpand}`
(today `App` renders the old modal `CaptureOverlay` with `onClose`/`onCaptured` — that wiring is
replaced by P1-06/P1-02). No new logic inside `CaptureOverlay` beyond what P1-06 specifies.

### Mic transcript target

The mic (`VoiceButton`/`useVoiceTranscribe`, see P1-06 + `VoiceCapture.tsx` lines 28–69) may route its
transcript through the **same** `onExpand(text)` seam instead of appending to the bar — i.e. a
finished transcription calls `handleExpand(transcript)`, landing the dictated text in Brain Dump
prefilled + focused. This resolves the P1-06 Open Question on mic destination. Recommended: the bar's
mic appends to the bar input (review-then-Enter) and the **expand/Shift+Enter** path is what escalates
to Brain Dump; if the product decision is "mic → Brain Dump", it simply calls the same `handleExpand`.
Either way the seed contract is unchanged.

### Consumer side — `BrainDumpView`

`C:\code\mcp-agent-tasks\src\ui\src\views\BrainDumpView.tsx`. P1-07 already adds the `initialText`
entry point with a change-detected effect. Pass the seed through and have the consumer clear it once
read:

```tsx
// App.tsx render
<BrainDumpView
  projects={projects}
  initialText={brainDumpSeed?.text}
  seedNonce={brainDumpSeed?.nonce}
  onSeedConsumed={() => setBrainDumpSeed(null)}   // consume-once: clears App state after prefill
/>
```

Inside `BrainDumpView`, the prefill effect keys on `seedNonce` (not on `initialText` value, so
identical text re-triggers), prefills + focuses the textarea, then calls `onSeedConsumed()`:

```ts
useEffect(() => {
  if (seedNonce == null || initialText == null) return
  setDump(initialText)
  setPhase('input')
  textareaRef.current?.focus()
  // caret to end
  onSeedConsumed()        // clears the App seed → cannot re-apply on revisit (AC 4)
}, [seedNonce])           // eslint-disable-line react-hooks/exhaustive-deps — intentional nonce key
```

Clearing `brainDumpSeed` in `App` after consumption is what guarantees AC 4 (the prop is `undefined`
on the next render, so a remount/revisit has nothing to re-apply).

---

## Failure Modes

- **Empty / whitespace-only text → no-op.** `handleExpand` trims; an empty or whitespace-only string
  neither sets the seed nor switches the view. (Mirrors P1-06 AC 3 — empty Enter is never valid;
  empty Shift+Enter / expand is likewise inert.)
- **Seed double-apply guard.** The consume-once contract (AC 4): `BrainDumpView` reads the seed in a
  `seedNonce`-keyed effect and immediately calls `onSeedConsumed()`, which nulls `brainDumpSeed` in
  `App`. Because the effect keys on the nonce (not on view mount or `initialText` value), neither
  re-mounting Brain Dump nor toggling views re-applies stale text. A genuinely new handoff produces a
  new nonce and re-triggers correctly (AC 5).
- **Handoff while a dump is in progress.** If the user already has unsaved candidates/text in Brain
  Dump and triggers a fresh handoff, the new seed overwrites the textarea and resets to the input
  phase (per P1-07's `initialText` behaviour: "set phase to input, clear stale candidates"). This is
  the intended P1-07 semantics — call it out so it is not treated as data loss; the prior dump was
  unsaved by definition.

---

## Out of Scope

- **Backend — none.** This is pure client glue between two existing UI seams. No `server-ui.ts`
  change, no new endpoint, no task-store/schema change.
- **Building the affordances themselves** — the expand icon, `Shift+Enter` handler, and bar-clear are
  P1-06. The `initialText`/nonce prop and prefill effect are P1-07. This spec only adds the `App`-level
  seed state and the two ends' wiring.
- **Routing the captured/escalated text to Hermes or ACR** (Phase 2, P2-05/P2-06).
- **Persisting the seed** across reloads — it is intentionally transient (in-memory `useState`); a
  reload discards an un-consumed handoff, which is acceptable for a sub-2s escalation flow.

---

## Dependencies

- **P1-06** — Global capture bar. Provides the `onExpand(text)` callback fired by `Shift+Enter` and
  the expand icon, and the post-handoff bar clear. **Must merge first.**
- **P1-07** — Brain Dump view reskin. Provides the `initialText` (+ nonce) entry point, the prefill +
  focus + phase-reset effect, and the change-detected re-trigger. **Must merge first.**
- (Transitively) **P1-02** — app shell, which owns the view-switching state (`view`/`lifeos-view`)
  that `handleExpand` calls into. Wire to whichever view setter the shell exposes.

---

## Testing

- **Unit (Vitest + Testing Library):**
  - `Shift+Enter` in the capture bar with text "buy milk #GEN" → view switches to Brain Dump, Brain
    Dump textarea contains exactly "buy milk #GEN" and is focused; `quickCapture` not called.
  - Expand-icon click with non-empty text → identical outcome (same assertions); both paths invoke
    the one `onExpand`/`handleExpand` code path.
  - After handoff, the capture-bar input is empty (AC 3).
  - Consume-once: trigger a handoff, prefill asserted; switch view away and back to Brain Dump →
    textarea is **not** re-prefilled (retains whatever was there); `onSeedConsumed` was called once
    (AC 4).
  - Fresh re-handoff with identical text (new nonce) while already on Brain Dump → textarea
    re-prefills (AC 5) — guards the "key on nonce, not on text value" decision.
  - Empty/whitespace text via `Shift+Enter` or expand → no view switch, no seed set, no-op
    (Failure Modes).
- **Type/build gate:** `npm run type-check` (strict, no `any`) and `npm run build` pass.
- **In-browser (`serve-ui`):** type in the capture bar, press `Shift+Enter` (and separately click the
  expand icon) → lands in Brain Dump with the text prefilled, caret at end, ready to keep typing; the
  bar is cleared.

---

## Open Questions

1. **Mic → Brain Dump vs append-to-bar (resolves P1-06 OQ 1).** Default per P1-06 recommendation: the
   bar's mic *appends to the bar input* (user reviews, then Enter or Shift+Enter to escalate); the
   explicit expand / `Shift+Enter` is the escalation path. If the product preference is "dictation
   goes straight to Brain Dump", route the transcript through the same `handleExpand` seam — no
   contract change. Confirm the default during build.
2. **Caret position after prefill.** Place the caret at the **end** of the prefilled text (so the user
   keeps typing) rather than selecting-all or caret-at-start. Default: caret at end. Confirm against
   the prototype feel.
3. **Should the `#PREFIX` token survive the handoff?** Default: yes — carry the bar text verbatim,
   including any leading `#PREFIX`, since the brain-dump LLM (`POST /api/capture/braindump`) does its
   own routing per candidate and the user may want the prefix as a hint. Revisit if it proves noisy.
