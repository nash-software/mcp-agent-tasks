# Notes Usability: Full Detail Panel, Inline Editing, Pin/Unpin, and Delete

**Type**: Feature

## Description

Notes are currently render-only sticky cards with truncated bodies (140 chars max), no way to click in and read the full content, and no way to edit, pin/unpin, or delete a note from the UI. The backend has full CRUD (`PATCH /api/notes/:id`, `DELETE /api/notes/:id`, `updateNote()`, `deleteNote()` in `api.ts`) but the PATCH endpoint only accepts `body` and `tags` — not `title` or `pinned`. The result is notes you can capture but never meaningfully interact with. This ticket makes notes a first-class surface: click to open a detail panel, read the full body, edit title/body/tags inline, toggle pin, and delete.

## Domain Model

- **NoteRecord** (existing) — `{id, title?, body, tags[], pinned, project, created_at, updated_at, linked_task_id?}`. No changes to the schema.
- **NotePanel** — A slide-in detail panel for a single note. Similar to `TaskPanel`. Modes: `read` (default) and `edit` (activated by clicking the body or Edit button). Not a new route — overlay on the Notes view.
- **Invariants**: A note's `body` must be non-empty after trim (enforced server-side; client should prevent saving an empty body). Title is optional. Tags are an array of lowercase strings.

## Acceptance Criteria

- [ ] Clicking anywhere on a `NoteCard` opens `NotePanel` for that note; panel slides in from the right (same animation as `TaskPanel`)
- [ ] `NotePanel` shows: full `body` text (no truncation), `title` (if set), `tags` as chips, project badge, created/updated timestamps, and linked task chip (if `linked_task_id` is set)
- [ ] `NotePanel` has an "Edit" button that switches to edit mode: `title` becomes an input, `body` becomes a `<textarea>` (auto-resizing), tags become editable chips (click × to remove, type to add)
- [ ] In edit mode, "Save" (or Ctrl+Enter) fires `PATCH /api/notes/:id` with updated `{body, title, tags}`; on success the panel updates to read mode with the new content and the notes list refetches
- [ ] In edit mode, "Cancel" discards changes and returns to read mode; if the user has unsaved changes, a confirm dialog ("Discard changes?") appears before discarding
- [ ] The Star icon in `NoteCard` and in `NotePanel` is clickable; clicking it fires `PATCH /api/notes/:id` with `{pinned: !current}` and immediately reflects the new pin state (optimistic update)
- [ ] `NotePanel` has a Delete button (with a "Delete note?" confirm step); on confirm fires `DELETE /api/notes/:id`, closes the panel, and removes the card from the notes list
- [ ] Pressing Escape closes `NotePanel` (with the unsaved-changes guard if in edit mode)
- [ ] `PATCH /api/notes/:id` server endpoint is extended to accept `title` (string | null) and `pinned` (boolean) fields alongside the existing `body` and `tags`
- [ ] `updateNote()` in `api.ts` is updated to accept `title?: string | null` and `pinned?: boolean` in its fields parameter

### Testing
- [ ] Unit tests for `NotePanel`: read mode renders full body, edit mode shows inputs, save fires PATCH with correct payload, cancel with changes shows confirm dialog
- [ ] Unit tests for pin toggle: optimistic update sets pinned immediately, reverts on error
- [ ] Unit tests for delete: confirm step shown, DELETE fires on confirm, panel closes and note disappears from list
- [ ] Unit tests for server PATCH extension: `title` and `pinned` fields accepted and persisted
- [ ] Visual QA: NotePanel (read and edit mode), NoteCard pin state, delete confirm, panel open/close animation

## Technical Notes

- `NotePanel.tsx` — new component at `src/ui/src/components/NotePanel.tsx`. Follow `TaskPanel.tsx` for slide animation (`transform-only slide`), absolute positioning, and overlay structure. Accept props: `note: NoteRecord | null`, `onClose: () => void`, `onUpdated: (note: NoteRecord) => void`, `onDeleted: (id: string) => void`.
- `NotesView.tsx` — add `selectedNoteId: string | null` state; pass `onClick={() => setSelectedNoteId(note.id)}` to each `NoteCard`; render `<NotePanel>` with the selected note; handle `onUpdated`/`onDeleted` by invalidating `['notes']` query.
- `NoteCard.tsx` — add `onClick` prop; make the `<div className="note-card">` a button (or add `role="button"` + `tabIndex={0}`) for accessibility; make the Star icon `<button>` that calls `onPinToggle` and stops event propagation.
- Server PATCH extension (`src/server-ui.ts`, line ~2630): add `title` and `pinned` fields to the parsed body and `updateFields`. For `title`: accept `string | null` (null clears the title). For `pinned`: accept `boolean`.
- `NoteStore.update()` (`src/store/note-store.ts`) — check if it already supports `title`/`pinned` or needs to be extended. If the store doesn't support these fields, add them.
- `updateNote()` in `api.ts` (line 184) — extend the `fields` parameter type: `{ body?: string; tags?: string[]; title?: string | null; pinned?: boolean }`.
- Auto-resizing textarea: use `onInput` to set `element.style.height = 'auto'; element.style.height = element.scrollHeight + 'px'`.
- Tag editing: show existing tags as removable chips; below the chips, a small text input where pressing Enter or comma adds a new tag. Filter out empty/duplicate entries.

## Failure Modes

- **PATCH fails (network/validation)** → revert optimistic pin update; show inline error in panel ("Couldn't save — try again"); stay in edit mode for save failures.
- **DELETE fails** → show inline error in panel ("Couldn't delete — try again"); panel stays open.
- **Note not found (404)** → panel closes with a toast "Note no longer exists"; list refetches.
- **Body emptied and saved** → client blocks Save (disables button) when body is empty after trim; server also rejects with 400.

## Out of Scope

- Full markdown rendering of note body (plain text only in this ticket)
- Moving a note to a different project
- Searching note content
- Note version history / undo
- Linking a note to a task from the panel (link already set at capture time)
- Note sharing or export
- Keyboard navigation between notes in the panel

## Dependencies

- Existing `TaskPanel.tsx` — reference for slide animation and panel structure
- Existing `PATCH /api/notes/:id` endpoint (extend, not replace)
- Existing `updateNote()` and `deleteNote()` in `src/ui/src/api.ts`
- `NoteStore.update()` in `src/store/note-store.ts` (may need extending for `title`/`pinned`)

## Open Questions

- [ ] **`NoteStore.update()` scope** — does the existing `NoteStore.update()` already accept `title` and `pinned`? Verify at implementation before assuming a store change is needed.

## Effort Estimate

**M** (1-2 days)

Rationale: New `NotePanel.tsx` component (moderate UI work), minor server PATCH extension, `NoteCard` click wiring, `api.ts` type extension. The delete + pin paths are small. The tag editing UI is the most complex piece.
