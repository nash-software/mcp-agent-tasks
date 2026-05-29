# P1-06 — Global Capture Bar

**Type:** Feature
**Phase:** Phase 1 (Reskin)
**Epic:** MCPAT-022 — Life OS UI Reskin + Agent Layer
**Size:** M

> Read `docs/life-os/specs/00-epic-overview.md` first for shared tokens (§3), data shapes (§4),
> client conventions (§5), and anti-patterns (§9). This spec does not repeat them.
> Reference: `design_handoff_life_os/README.md` §6.1 (lines 207–221) + keyboard table (lines 181–199);
> prototype `design_handoff_life_os/reference/app.jsx` `CaptureBar` (lines 68–135) and
> `reference/styles.css` `.capture-*` rules (lines 122–189).

---

## Description

**WHY:** Capture must be sub-2-second and frictionless. The single highest-leverage habit in the
system is "thought → captured" with zero ceremony. Today's `CaptureOverlay` is a centred modal —
it darkens the screen, steals focus context, and demands a deliberate open/close cycle. The target
turns it into an **always-visible top bar** spanning the full grid width: the cursor is one
`Ctrl+Space` away at all times, Enter saves to the GEN inbox, and the bar **never asks where a
thought goes** (§9 anti-pattern). Routing is inferred from an optional `#prefix`; absent that,
everything lands in GEN. The user types and presses Enter — that is the entire interaction.

---

## Acceptance Criteria

1. **Always-visible top bar (not a modal).** `CaptureOverlay.tsx` renders into the `capture` grid
   area defined in P1-02 (spans all grid columns at the top). There is no backdrop, no
   `fixed inset-0`, no centred panel, no open/close visibility state. The bar is permanently mounted.
2. **Layout matches the prototype.** Left brand block (`Life`**OS**, 22px accent rounded-square
   logo) sized to nav width (`calc(var(--nav-w) - 16px)`, 216px nav). Input row: `surface-1` bg,
   1px `surface-3` border, radius 6px, 34px tall, with a muted lead `+` glyph inside-left; border
   turns `accent` (and bg → `surface-2`) on focus-within. Right cluster: `Ctrl Space` kbd hint,
   expand icon button, mic button.
3. **Enter → quick capture, flash, clear.** Pressing Enter on a non-empty field calls
   `POST /api/capture/quick`, flashes a green "Captured ✓" inside the input (~600ms), then clears
   the field. An empty/whitespace-only field is never valid (Enter is a no-op); any non-empty string
   is valid and is **never rejected for lacking a destination**.
4. **`#prefix` autocomplete with keyboard nav.** Typing `#` followed by chars shows a dropdown of
   matching projects (filter by prefix or name). `↑`/`↓` move the selection, `Tab` or `Enter`
   (while the caret is on the `#token`) accepts the highlighted project and inserts `#PREFIX `;
   a subsequent Enter then captures routed to that project.
5. **`Ctrl+Space` focuses from any view.** From anywhere in the app (including while typing in
   another input), `Ctrl+Space` moves focus to the capture input. It no longer toggles a modal.
6. **Mic transcribes.** The mic button records audio and calls `POST /api/transcribe` (Groq
   Whisper). While recording, the button shows the recording state (red, `animate-pulse`); the
   transcript result is delivered to Brain Dump or appended to the bar input (see Open Questions).
7. **Shift+Enter affordance present.** `Shift+Enter` in the bar invokes the Brain Dump handoff
   callback with the current text and clears the field; the expand icon does the same on click. (The
   actual Brain Dump prefill lands in P2-03 — see Out of Scope.)

---

## Technical Notes

### Files
- **Rewrite** `src/ui/src/components/CaptureOverlay.tsx` — modal → top bar. Drop the
  `fixed inset-0 … backdropFilter` wrapper (lines 73–78), the backdrop click handler
  (`handleBackdropClick`, lines 33–38), the `onClose` prop, and the `CaptureToast` export
  (lines 127–143; the flash is now inline in the input per AC 3). Replace hardcoded
  `slate/indigo/emerald` utilities with the §3 tokens (`surface-1/2/3`, `accent`, status `green`).
- **Rewrite** `src/ui/src/hooks/useCaptureOverlay.ts` — convert from toggle-modal to focus-bar.
  Replace `isOpen/open/close/toggle` with a registered focus callback: expose
  `registerFocus(fn)` + `focus()` (mirror the prototype's `captureFocusRef` pattern,
  `app.jsx` lines 75, 441, 507). The `Ctrl+Space` handler (`e.ctrlKey && e.code === 'Space'`)
  stays but now calls `focus()` instead of `toggle()`, and must fire **even while typing in an
  input** (remove the INPUT/TEXTAREA early-return guard for this binding only — prototype line 441).
- **Reuse** transcription logic from `src/ui/src/components/VoiceCapture.tsx` (lines 28–69:
  `getUserMedia` → `MediaRecorder('audio/webm')` → `transcribeAudio(blob, 'recording.webm')`).
  Extract the record/transcribe state machine into a small reusable hook
  (`useVoiceTranscribe`) or lift it inline; do not duplicate the MediaRecorder wiring.
- `App.tsx` (owned by P1-02) mounts `<CaptureOverlay />` in the `capture` grid slot and passes the
  Brain Dump handoff callback + the focus registration.

### API / data shapes
- `quickCapture(text)` already exists in `src/ui/src/api.ts` (line 83) →
  `POST /api/capture/quick` body `{ text }` → `{ taskId, project }`. The server extracts
  `#PREFIX` server-side and defaults to GEN, so the client may send the raw `#PREFIX rest`
  string verbatim. Match the prototype's parse (`app.jsx` lines 89–91) only for the local
  autocomplete UX, not for routing authority.
- `transcribeAudio(blob, filename)` already exists (`api.ts` line 41) →
  `POST /api/transcribe` (multipart `file`) → `{ text }`.
- **Project list for autocomplete:** the prototype filters by both prefix **and name**, but the
  current bar only has prefixes from `fetchConfig().projectPrefixes`. `GET /api/projects` returns
  `{ prefix, path }[]` (server-ui.ts line 460) — **no `name`/`area`**. Add a `fetchProjects()`
  client fn and a `['projects']` query (§5), filtering by prefix (and `name` once the endpoint
  carries it — see Open Questions). Until then, reuse the existing `fetchConfig` prefix list and
  filter by prefix substring (adapt current lines 21–31).

### Mutation
- Wrap the capture call in a TanStack mutation; on success invalidate `['today']` and `['tasks']`
  (§5) so a freshly captured GEN task appears without a manual refresh.

### Migration note
This converts a **modal** into a **persistent grid-area bar**. No animated opacity-to-hidden
(§9) — the bar is never hidden, so there is no enter/exit transition to get wrong. The only
motion is the 600ms green flash and the 100ms hover/focus border transitions from `styles.css`.

---

## Failure Modes

- **`POST /api/capture/quick` fails** (network/500): do **not** clear the field and do **not** flash
  green. Keep the typed text intact, surface a quiet inline retry affordance (e.g. a muted "couldn't
  save — Enter to retry" hint in `red`), and let a second Enter re-attempt. Never lose the user's text.
- **`POST /api/transcribe` fails or `GROQ_API_KEY` is unset** (server returns non-200): stop the
  recording state, show a brief inline mic error (reuse `VoiceCapture` error copy, e.g. "Transcription
  failed"), and leave any typed text untouched. Mic permission denied (`NotAllowedError`) → show the
  "allow mic access" message (VoiceCapture line 57).
- **Project list empty / `/api/projects` 404 or offline:** the bar still works — `#prefix` typing
  simply shows no autocomplete dropdown, and capture proceeds (server defaults to GEN). Never block
  capture on the project list being available.

---

## Out of Scope

- **The actual Brain Dump prefill handoff is P2-03.** Here we ship only the *affordances*:
  `Shift+Enter` and the expand icon both fire a `onExpand(text)` callback and clear the bar. Wiring
  that callback to `BrainDumpView` (carrying the text into the dump editor, prefilled) is P2-03.
- Hermes / agent routing of captured tasks (Phase 2).
- Adding `name`/`area` to the `/api/projects` payload (backend change; see Open Questions) — Phase 1
  filters by prefix if the field is absent.
- The command-palette "Quick capture" entry that calls the focus callback (owned by P1-10; this spec
  only exposes the focus registration it consumes).

---

## Dependencies

- **P1-01** — design-system foundation (tokens, Geist, `surface-*`/`accent`/status colours, radii,
  `--nav-w`). All styling assumes these exist.
- **P1-02** — app shell provides the `capture` grid area the bar spans, mounts `<CaptureOverlay />`,
  and owns the global keyboard layer that registers the `Ctrl+Space` focus binding.

---

## Testing

- **Unit (Vitest + Testing Library):**
  - Empty/whitespace field + Enter → `quickCapture` not called.
  - Non-empty + Enter → `quickCapture` called with the text; field clears; green flash appears then
    disappears (~600ms, fake timers).
  - Capture rejection → field retains text, no flash, retry hint shown, second Enter re-calls.
  - Typing `#AC` shows a dropdown filtered to matching projects; `↓` then `Tab` inserts `#ACR `;
    Enter then captures routed (assert payload).
  - `Ctrl+Space` dispatched while focus is in an unrelated input → capture input receives focus.
  - Mic click → `MediaRecorder` started (mocked); stop → `transcribeAudio` called; failure path
    shows the mic error and does not clear typed text.
- **Type/build gate:** `npm run type-check` (strict, no `any`) and `npm run build` pass.
- **Visual:** matches `design_handoff_life_os/screenshots/` capture-bar reference at high fidelity
  (brand block width, 34px input height, focus border → accent).

---

## Open Questions

1. **Mic destination default:** does the transcript land **in the capture bar input** (append, user
   reviews then Enter) or go **straight to Brain Dump** (P2-03)? README §6.1 line 221 says "lands in
   Brain Dump … or appends". Recommendation: append to the bar in Phase 1 (Brain Dump prefill isn't
   wired until P2-03), promote to Brain Dump once P2-03 lands. Resolve with P2-03.
2. **`/api/projects` name field:** the prototype filters autocomplete by prefix **and** name, but the
   endpoint currently returns only `{ prefix, path }`. Add `name` (and `area`) to the payload now
   (small server-ui change) or filter by prefix only for Phase 1? Default: prefix-only for Phase 1.
