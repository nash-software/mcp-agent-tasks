import React from 'react'
import { Star, WifiOff } from 'lucide-react'
import { PrefixBadge, AreaDot } from './atoms'
import { areaOfProject } from '../lib/filter'
import { relativeTime } from '../lib/time'
import type { NoteRecord } from '../api'
import type { TaskArea } from '../types'

interface NoteCardProps {
  note: NoteRecord
  areaMap: Record<string, TaskArea>
  onClick?: () => void
}

export function NoteCard({ note, areaMap, onClick }: NoteCardProps): React.JSX.Element {
  const area = areaOfProject(note.project, areaMap)
  const title = note.title ?? note.body.slice(0, 60)
  const bodyPreview = note.title ? note.body.slice(0, 140) : note.body.slice(60, 200)
  const tags = note.tags ?? []

  return (
    <div className="note-card" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="note-card-head">
        <PrefixBadge project={note.project} />
        {area && <AreaDot area={area} />}
        {note.pinned && (
          <Star size={13} style={{ color: '#F59E0B', fill: '#F59E0B' }} aria-label="Pinned" />
        )}
        {note.brain_sync_failed && (
          <WifiOff
            size={12}
            style={{ color: '#EF4444', marginLeft: 'auto' }}
            aria-label="Brain sync failed"
          />
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
