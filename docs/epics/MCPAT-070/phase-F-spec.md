# Spec: MCPAT-070 Phase F — Completed restyle (S–M)

**Epic:** MCPAT-070 Life OS Phase 3 UI Reskin · **Branch:** `feat/MCPAT-070-p3f-completed-restyle`
**Pipeline:** `/run-pipeline docs/epics/MCPAT-070/phase-F-spec.md --phase F --auto`
**Depends on:** Phase C merged (branch from fresh `origin/main` containing A+B+C). Runs in parallel with Phase E (no shared files — F touches only CompletedView + index.css).
**Reference appendix:** `phase3-lifeos-picture.md` §Completed + §D1 · prototype `design_handoff/reference/app.jsx` (completed/done rows) · `styles.css` (`.done-*` selectors) · visual reference current `02-hermes.png` for batch headings style.

## Scope boundary — ONLY these files

UI root is `src/ui/src/`. Touch **only**:
- `views/CompletedView.tsx`
- `index.css` (append `.done-*` selectors)

## D1 — Keep batch grouping, restyle only (authoritative)

Keep the existing `close_batch`/`closed_at` sprint-batch grouping and "Nh burned" headings. Do **NOT** drop sprint-batch grouping. Only restyle the rows to the prototype's done-row visuals.

## Acceptance Criteria

- [ ] Keep the existing `close_batch`/`closed_at` sprint-batch grouping and "Nh burned" headings (D1).
- [ ] Restyle each row to `.done-row`: `.done-check` green check chip, `.done-title` strikethrough (muted, ellipsis), area dot + project badge + `.done-when` timestamp. Click opens the task.
- [ ] Remains filter-aware via existing `useTasks()`.

## Tests

- [ ] If `CompletedView` has existing source-inspection tests, update expectations to the new `.done-*` structure (do not weaken assertions — match the new DOM).
- [ ] Run the FULL vitest suite before PR.

## Gate

- [ ] Root `npm run type-check` (`tsc -b`). No `any`; components <200 lines, functions <50.
