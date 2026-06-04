import React from 'react'
import { StickyNote } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchNotes } from '../api'
import type { NoteRecord } from '../api'
import { NoteCard } from '../components/NoteCard'
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
  const notesQuery = useQuery({
    queryKey: ['notes'],
    queryFn: () => fetchNotes({ limit: 200 }),
    staleTime: 30_000,
  })

  const allNotes: NoteRecord[] = notesQuery.data ?? []
  const shown = allNotes.filter(n => matchProjectArea(filter, n.project, undefined, areaMap))
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

      {shown.length === 0 && !notesQuery.isLoading && (
        <div className="notes-empty">
          <StickyNote size={32} />
          <p>No notes yet — use Note mode in the capture bar</p>
        </div>
      )}

      {pinned.length > 0 && (
        <div className="notes-grid">
          {pinned.map(note => (
            <NoteCard key={note.id} note={note} areaMap={areaMap} />
          ))}
        </div>
      )}

      {pinned.length > 0 && rest.length > 0 && (
        <div className="notes-divider" role="separator" />
      )}

      {rest.length > 0 && (
        <div className="notes-grid">
          {rest.map(note => (
            <NoteCard key={note.id} note={note} areaMap={areaMap} />
          ))}
        </div>
      )}
    </div>
  )
}
