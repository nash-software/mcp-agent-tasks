# Spec: MCPAT-070 Phase E — Notes pinned-grid (M)

**Epic:** MCPAT-070 Life OS Phase 3 UI Reskin · **Branch:** `feat/MCPAT-070-p3e-notes-grid`
**Pipeline:** `/run-pipeline docs/epics/MCPAT-070/phase-E-spec.md --phase E --auto`
**Depends on:** Phase C merged (branch from fresh `origin/main` containing A+B+C). Runs in parallel with Phase F (no shared files). **Must merge before Phase D** — D appends to the same `lib/api.ts` + `src/server-ui.ts`.
**Reference appendix:** `phase3-lifeos-picture.md` §Notes + §D5 · prototype `design_handoff/reference/app.jsx` (notes view + NoteCard) · `styles.css` (`.notes-grid`, `.notes-divider`, `.note-*`) · visual target screenshot `09-notes.png` (canonical).

## Scope boundary — ONLY these files

UI root is `src/ui/src/`; backend at repo `src/`. Touch **only**:
- `views/NotesView.tsx`
- `components/NoteCard.tsx` (new)
- `lib/api.ts` (append notes create/delete client only)
- `index.css` (append `.notes-*` selectors)
- `src/server-ui.ts` (add `POST /api/notes`, `DELETE /api/notes/:id` — append)

## D5 — Note submit path (authoritative)

Capture Note-mode and Infer→note both submit to the **existing `POST /api/capture/note`** (already populates `fresh:true` + area inference). NotesView "New note" affordance routes through `focusCapture('note')` (the Phase-A entry) → capture bar → `/api/capture/note`. The capture path stays single and canonical. `POST /api/notes` is added for CRUD parity but is **not** the capture path.

## Acceptance Criteria

- [ ] Head: h1 "Notes", sub `{shown.length} captured`, New note button (top-right) → `focusCapture('note')`.
- [ ] FilterBar present (same `matchFilter`). Pinned notes render first in a 2-col `.notes-grid`; if both pinned and rest exist, a `.notes-divider`; then rest in a 2-col grid.
- [ ] `NoteCard`: head (PrefixBadge project · area dot · ⭐ amber if pinned · `.note-at` timestamp), title (14/600), body (text-2), `.note-tags` (#tag chips). Null-guard tags.
- [ ] Empty state points at the capture-bar Note mode.
- [ ] Backend: `POST /api/notes {title, body?, project?, tags?}` (create, CRUD parity), `DELETE /api/notes/:id`. `GET/PATCH /api/notes(/:id)` already exist — do not change them.
- [ ] D5 honoured: NotesView "New note" routes via `focusCapture('note')` → `/api/capture/note`, not `POST /api/notes`.
- [ ] `POST /api/notes` failure → capture flash shows failure, input preserved; never lose typed text.

## Tests

- [ ] Backend: `POST/DELETE /api/notes` validation (follow existing `server-ui` test style — title required, unknown id → 404, etc.).
- [ ] Run the FULL vitest suite before PR.

## Gate

- [ ] Root `npm run type-check` (`tsc -b`). No `any`; components <200 lines, functions <50; try/catch all async; optimistic mutations flip only client-known fields (server-computed come from response).
