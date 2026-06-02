import React, { useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StickyNote, X, Tag } from 'lucide-react'
import { fetchNotes, updateNote, captureNote } from '../api'
import type { NoteRecord } from '../api'
import { PrefixBadge } from '../components/atoms'
import { ViewHeader } from '../components/ViewHeader'
import { relativeTime } from '../lib/time'

// ── helpers ───────────────────────────────────────────────────────────────────

function notePreview(body: string, maxLen = 120): string {
  return body.length <= maxLen ? body : body.slice(0, maxLen) + '…'
}

// ── NoteCard ─────────────────────────────────────────────────────────────────

function NoteCard({
  note,
  selected,
  onClick,
}: {
  note: NoteRecord
  selected: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <div
      className={`note-card${selected ? ' selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      aria-pressed={selected}
    >
      <div className="note-card-header">
        <PrefixBadge project={note.project} />
        {note.brain_sync_failed && (
          <span className="note-sync-dot" title="Brain sync pending" aria-label="Brain sync pending" />
        )}
        <span className="note-timestamp">{relativeTime(note.created_at)}</span>
      </div>
      <p className="note-preview">{notePreview(note.body)}</p>
      {note.tags.length > 0 && (
        <div className="note-tags">
          {note.tags.map(tag => (
            <span key={tag} className="note-tag">
              <Tag size={10} />
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── NotePanel ─────────────────────────────────────────────────────────────────

function NotePanel({
  note,
  onClose,
}: {
  note: NoteRecord
  onClose: () => void
}): React.JSX.Element {
  const [body, setBody] = useState(note.body)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const queryClient = useQueryClient()
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveMutation = useMutation({
    mutationFn: (newBody: string) => updateNote(note.id, { body: newBody }),
    onSuccess: () => {
      setSaved(true)
      setSaveError(false)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => setSaved(false), 1500)
      void queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
    onError: () => {
      setSaveError(true)
    },
  })

  const handleBlur = useCallback(() => {
    if (body !== note.body) {
      setSaveError(false)
      saveMutation.mutate(body)
    }
  }, [body, note.body, saveMutation])

  // Close on Escape
  React.useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Sync body when note changes
  React.useEffect(() => {
    setBody(note.body)
  }, [note.id, note.body])

  return (
    <div className="note-panel">
      <div className="note-panel-header">
        <div className="flex items-center gap-2">
          <PrefixBadge project={note.project} />
          {note.task_id && (
            <span className="note-linked-task" title={`Linked to ${note.task_id}`}>
              {note.task_id}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="note-saved-indicator">Saved</span>}
          {saveError && <span className="note-save-error">Save failed</span>}
          <button
            type="button"
            className="note-panel-close"
            onClick={onClose}
            aria-label="Close note panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <textarea
        className="note-panel-body"
        value={body}
        onChange={e => {
          setBody(e.target.value)
          setSaved(false)
          setSaveError(false)
        }}
        onBlur={handleBlur}
        aria-label="Note body"
        maxLength={10000}
      />

      <div className="note-panel-meta">
        {note.tags.length > 0 && (
          <div className="note-tags">
            {note.tags.map(tag => (
              <span key={tag} className="note-tag">
                <Tag size={10} /> {tag}
              </span>
            ))}
          </div>
        )}
        <div className="note-panel-dates">
          <span>Created {relativeTime(note.created_at)}</span>
          {note.updated_at !== note.created_at && (
            <span> · Updated {relativeTime(note.updated_at)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── NotesView ─────────────────────────────────────────────────────────────────

export function NotesView(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [projectFilter] = useState<string | undefined>(undefined)
  const queryClient = useQueryClient()

  const notesQuery = useQuery({
    queryKey: ['notes', projectFilter],
    queryFn: () => fetchNotes({ project: projectFilter, limit: 100 }),
    staleTime: 30_000,
  })

  const notes = notesQuery.data ?? []
  const selectedNote = selectedId ? notes.find(n => n.id === selectedId) ?? null : null

  const newNoteMutation = useMutation({
    mutationFn: (text: string) => captureNote(text),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] })
      setSelectedId(data.noteId)
    },
  })

  const handleNewNote = useCallback(() => {
    newNoteMutation.mutate('New note — edit here…')
  }, [newNoteMutation])

  return (
    <div className="notes-view">
      <ViewHeader
        title="Notes"
        right={
          <button
            type="button"
            className="btn-sm btn-primary"
            onClick={handleNewNote}
            disabled={newNoteMutation.isPending}
          >
            + New note
          </button>
        }
      />

      <div className="notes-layout">
        {/* List */}
        <div className="notes-list">
          {notes.length === 0 && !notesQuery.isLoading && (
            <div className="notes-empty">
              <StickyNote size={32} className="text-ink-faint" />
              <p className="text-ink-muted text-sm mt-2">
                No notes yet — capture your first thought with{' '}
                <kbd>Ctrl+Shift+N</kbd>
              </p>
            </div>
          )}

          {notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              selected={selectedId === note.id}
              onClick={() => setSelectedId(prev => prev === note.id ? null : note.id)}
            />
          ))}
        </div>

        {/* Side panel */}
        {selectedNote && (
          <NotePanel
            note={selectedNote}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  )
}
