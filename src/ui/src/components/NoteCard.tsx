import React from 'react'
import { Star } from 'lucide-react'
import { PrefixBadge, AreaDot } from './atoms'
import { areaOfProject } from '../lib/filter'
import { relativeTime } from '../lib/time'
import type { NoteRecord } from '../api'
import type { TaskArea } from '../types'

interface NoteCardProps {
  note: NoteRecord
  areaMap: Record<string, TaskArea>
}

export function NoteCard({ note, areaMap }: NoteCardProps): React.JSX.Element {
  const area = areaOfProject(note.project, areaMap)
  const title = note.title ?? note.body.slice(0, 60)
  const bodyPreview = note.title ? note.body.slice(0, 140) : note.body.slice(60, 200)
  const tags = note.tags ?? []

  return (
    <div className="note-card">
      <div className="note-card-head">
        <PrefixBadge project={note.project} />
        {area && <AreaDot area={area} />}
        {note.pinned && (
          <Star size={13} style={{ color: '#F59E0B', fill: '#F59E0B' }} aria-label="Pinned" />
        )}
        <span className="note-at">{relativeTime(note.created_at)}</span>
      </div>
      {title && <div className="note-title">{title}</div>}
      {bodyPreview && <div className="note-body">{bodyPreview}</div>}
      {tags.length > 0 && (
        <div className="note-tags">
          {tags.map(tag => (
            <span key={tag} className="note-tag">#{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}
