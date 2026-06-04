# MCPAT-070 — Life OS Phase 3 UI Reskin (epic orchestration pack)

Self-contained spec + asset pack for the `relay-orchestrate` run of MCPAT-070. Committed to `main`
so every fresh-`origin/main` VPS worktree gets the specs and design assets natively.

## Contents

- `phase3-lifeos-spec.md` — authoritative epic spec (6 phases A–F).
- `phase3-lifeos-picture.md` — reference appendix (delta map, contracts, CSS selector list, decisions).
- `phase-A-spec.md` … `phase-F-spec.md` — per-phase pipeline tickets (scope boundary + AC + tests + gate).
- `design_handoff/` — prototype source of truth: `reference/*.jsx` (exact prototype components),
  `reference/styles.css` (port Phase-3 selectors from here), `screenshots/08-advisor.png` +
  `09-notes.png` (canonical Phase-3 visual targets).

## DAG / batches (relay-orchestrate)

Worktrees branch from fresh `origin/main`; the merge gate is the cross-phase dependency mechanism.

| Batch | Phase(s) | Branch | Shared-file reason |
|-------|----------|--------|--------------------|
| 1 | A — capture modes | `feat/MCPAT-070-p3a-capture-modes` | owns `App.tsx` base + `focusCapture` |
| 2 | B — sidebar groups | `feat/MCPAT-070-p3b-sidebar-groups` | `App.tsx` after A |
| 3 | C — today toolbar | `feat/MCPAT-070-p3c-today-toolbar` | `App.tsx` after B |
| 4 | E ∥ F (parallel) | `…-p3e-notes-grid` / `…-p3f-completed-restyle` | after C; E owns `api.ts`/`server-ui.ts`, F isolated |
| 5 | D — advisor chat | `feat/MCPAT-070-p3d-advisor-chat` | `App.tsx`+`api.ts`+`server-ui.ts`, opens last |

Each phase: own branch, own PR, gated on root `npm run type-check` (`tsc -b`) + full vitest suite.
