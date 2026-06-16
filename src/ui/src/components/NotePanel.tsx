import React, { useState, useEffect, useRef } from 'react'
import { X, Tag } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchNote, updateNote } from '../api'
import { PrefixBadge } from './atoms'
import { relativeTime } from '../lib/time'

interface NotePanelProps {
  noteId: string | null
  onClose: () => void
}

export function NotePanel({ noteId, onClose }: NotePanelProps): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const isOpen = noteId !== null

  const { data: note } = useQuery({
    queryKey: ['note', noteId],
    queryFn: () => fetchNote(noteId!),
    enabled: isOpen,
    staleTime: 30_000,
  })

  const [body, setBody] = useState('')
  const [saved, setSaved] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (note) setBody(note.body)
  }, [note?.id, note?.body])

  const mut = useMutation({
    mutationFn: (newBody: string) => updateNote(noteId!, { body: newBody }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] })
      void queryClient.invalidateQueries({ queryKey: ['note', noteId] })
      setSaved(true)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => setSaved(false), 2000)
    },
  })

  function handleBlur(): void {
    if (note && body !== note.body) mut.mutate(body)
  }

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const tags = note?.tags ?? []
  const title = note?.title ?? note?.body.slice(0, 60) ?? ''

  return (
    <>
      <div className="note-panel-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="note-panel" role="dialog" aria-label="Note detail">
        <div className="note-panel-head">
          <div className="note-panel-meta">
            {note && <PrefixBadge project={note.project} />}
            {note && (
              <span className="note-at" style={{ marginLeft: 6 }}>
                {relativeTime(note.created_at)}
              </span>
            )}
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            aria-label="Close note"
          >
            <X size={16} />
          </button>
        </div>

        {title && <div className="note-panel-title">{title}</div>}

        {tags.length > 0 && (
          <div className="note-tags" style={{ padding: '0 16px 8px' }}>
            <Tag size={11} style={{ color: 'var(--text-muted)', marginRight: 4 }} />
            {tags.map(tag => (
              <span key={tag} className="note-tag">#{tag}</span>
            ))}
          </div>
        )}

        <div className="note-panel-body">
          <textarea
            className="note-panel-textarea"
            value={body}
            onChange={e => setBody(e.target.value)}
            onBlur={handleBlur}
            placeholder="Note body…"
            aria-label="Note body"
          />
        </div>

        <div className="note-panel-foot">
          {saved && <span className="note-saved-hint">Saved</span>}
          {mut.isPending && <span className="note-saved-hint" style={{ opacity: 0.6 }}>Saving…</span>}
          <button
            className="btn-sm btn-primary"
            onClick={() => { if (note && body !== note.body) mut.mutate(body) }}
            disabled={!note || body === note.body || mut.isPending}
          >
            Save
          </button>
        </div>
      </div>
    </>
  )
}
