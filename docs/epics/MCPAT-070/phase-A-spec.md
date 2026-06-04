# Spec: MCPAT-070 Phase A — Capture modes finish (S)

**Epic:** MCPAT-070 Life OS Phase 3 UI Reskin · **Branch:** `feat/MCPAT-070-p3a-capture-modes`
**Pipeline:** `/run-pipeline docs/epics/MCPAT-070/phase-A-spec.md --phase A --auto`
**Reference appendix:** `docs/epics/MCPAT-070/phase3-lifeos-picture.md` · prototype source `docs/epics/MCPAT-070/design_handoff/reference/app.jsx` (capture bar) + `styles.css` (`.capture-*` selectors) · visual target screenshot `08-advisor.png` (capture bar at top of shell).

## Scope boundary — ONLY these files

UI root is `src/ui/src/`. Touch **only**:
- `components/CaptureOverlay.tsx`
- `hooks/useCaptureOverlay.ts`
- `hooks/useGlobalKeyboard.ts`
- `App.tsx` (capture wiring only — do not touch nav/sort/advisor regions)
- `index.css` (append `.capture-*` Phase-3 selectors; do not edit other phases' blocks)

Do not create or modify any file outside this list. Capture pills/placeholders/mode-routed submit already exist — this is finishing work, not greenfield.

## Shared contracts (authoritative)

- `CaptureMode = 'infer' | 'task' | 'note'` (discriminated union, no bare string). Persisted `localStorage('lifeos-capmode')`, default `'infer'`.
- Infer route regex: `/^(note|idea|remember|thought|todo think)[:\-]/i` → note, else task.
- Note strip regex (narrower): `/^(note|idea|remember|thought)[:\-]\s*/i`.
- Submit flash ~700ms; text `Captured as task` / `Captured` / `Noted` with mode icon.
- Mode-routed submit unchanged: infer → `/api/capture/infer`, note → `/api/capture/note`, task → quick. (No backend change in this phase.)

## Acceptance Criteria

- [ ] Capture mode persists to `localStorage('lifeos-capmode')` (default `'infer'`); restored on load. Corrupt/unavailable localStorage → fall back to `'infer'`, never crash mount.
- [ ] `focusCapture(mode?: CaptureMode)` focuses the input AND switches mode when `mode` passed; no-arg focuses only. Wired to: Ctrl+Space (no arg), nav "New task" (`'task'`), Notes "New note" (`'note'`).
- [ ] Lead-glyph tint per mode via `.capture-input-wrap[data-mode]`: `task`→accent, `note`→amber, `infer`→muted.
- [ ] Submit routing/flash unchanged in behaviour: infer uses route regex (note vs task) + strips note token; flash text + mode icon ~700ms.
- [ ] Placeholders match prototype `PLACEHOLDER` map exactly per mode (see `app.jsx`).

## Tests

- [ ] Unit: capture infer route regex + strip regex behaviour (note vs task classification, token stripping) — follow existing `src/ui` test patterns.
- [ ] Run the FULL vitest suite before PR (source-inspection tests break on changed strings — project memory).

## Gate

- [ ] Authoritative type-check: root `npm run type-check` (`tsc -b`). `tsc --noEmit` inside `src/ui` gives false greens — do not rely on it.
- [ ] No `any`; functions <50 lines; components <200 lines.

## Notes

- `focusCapture` becomes the single canonical focus/switch entry; downstream phases (B nav "New task", E notes "New note") call it. Export/lift it so App can pass it to Nav/NotesView.
- Optimistic mutations: flip only client-known fields; let server-computed values come from the response.
