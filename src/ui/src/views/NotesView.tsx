import React, { useState } from 'react'
import { StickyNote } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchNotes } from '../api'
import type { NoteRecord } from '../api'
import { NoteCard } from '../components/NoteCard'
import { NotePanel } from '../components/NotePanel'
import { ViewHeader } from '../components/ViewHeader'
import { matchProjectArea, type Filter } from '../lib/filter'
import type { TaskArea } from '../types'
import type { CaptureMode } from '../hooks/useCaptureOverlay'

interface NotesViewProps {
  filter: Filter
  areaMap: Record<string, TaskArea>
  focusCapture: (mode?: CaptureMode) => void
}

export function NotesView({ filter, areaMap, focusCapture }: NotesViewProps): React.JSX.Element {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const notesQuery = useQuery({
    queryKey: ['notes'],
    queryFn: () => fetchNotes({ limit: 200 }),
    staleTime: 30_000,
  })

  const allNotes: NoteRecord[] = notesQuery.data ?? []
  const projectFiltered = allNotes.filter(n => matchProjectArea(filter, n.project, undefined, areaMap))
  const shown = selectedTag
    ? projectFiltered.filter(n => (n.tags ?? []).includes(selectedTag))
    : projectFiltered

  const allTags = Array.from(new Set(projectFiltered.flatMap(n => n.tags ?? []))).sort()

  const pinned = shown.filter(n => n.pinned === true)
  const rest = shown.filter(n => !n.pinned)

  return (
    <div className="notes-view">
      <ViewHeader
        title="Notes"
        subtitle={`${shown.length} captured`}
        right={
          <button
            type="button"
            className="btn-sm btn-primary"
            onClick={() => { focusCapture('note') }}
          >
            + New note
          </button>
        }
      />

      {allTags.length > 0 && (
        <div className="notes-tag-filter">
          <button
            className={`note-tag-chip${selectedTag === null ? ' active' : ''}`}
            onClick={() => setSelectedTag(null)}
          >
            All
          </button>
          {allTags.map(tag => (
            <button
              key={tag}
              className={`note-tag-chip${selectedTag === tag ? ' active' : ''}`}
              onClick={() => setSelectedTag(prev => prev === tag ? null : tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 && !notesQuery.isLoading && (
        <div className="notes-empty">
          <StickyNote size={32} />
          <p>{selectedTag ? `No notes tagged #${selectedTag}` : 'No notes yet — use Note mode in the capture bar'}</p>
        </div>
      )}

      {pinned.length > 0 && (
        <div className="notes-grid">
          {pinned.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              areaMap={areaMap}
              onClick={() => setSelectedNoteId(note.id)}
            />
          ))}
        </div>
      )}

      {pinned.length > 0 && rest.length > 0 && (
        <div className="notes-divider" role="separator" />
      )}

      {rest.length > 0 && (
        <div className="notes-grid">
          {rest.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              areaMap={areaMap}
              onClick={() => setSelectedNoteId(note.id)}
            />
          ))}
        </div>
      )}

      <NotePanel
        noteId={selectedNoteId}
        onClose={() => setSelectedNoteId(null)}
      />
    </div>
  )
}
