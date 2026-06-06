/**
 * SuggestionCard.tsx — Presentational card for a single Advisor suggestion.
 * No local state. Pure render from Suggestion props.
 * Matches advisor.jsx SuggestionCard structure exactly.
 */
import React from 'react'
import { X, Plus, Bot, ArrowRight } from 'lucide-react'
import { SEV_LABEL } from '../lib/advisor'
import type { Suggestion, SuggestionId } from '../lib/advisor'

interface SuggestionCardProps {
  s: Suggestion
  onDismiss: (id: SuggestionId) => void
  onOpen: (taskId: string) => void
  onCommit: (taskId: string) => void
  onHermes: (taskId: string) => void
}

export function SuggestionCard({ s, onDismiss, onOpen, onCommit, onHermes }: SuggestionCardProps): React.JSX.Element {
  return (
    <div className="sugg-card" data-sev={s.severity}>
      <div className="sugg-top">
        <span className="sugg-rank">{String(s.rank).padStart(2, '0')}</span>
        <span className="sev-badge" data-sev={s.severity}>
          <span className="d" />{SEV_LABEL[s.severity]}
        </span>
        <button className="sugg-dismiss" title="Dismiss" onClick={() => onDismiss(s.id)}>
          <X size={14} />
        </button>
      </div>
      <div className="sugg-title">{s.title}</div>
      <div className="sugg-rationale">{s.rationale}</div>
      <div className="sugg-foot">
        {s.taskIds.length > 0 && (
          <div className="sugg-chips">
            {s.taskIds.map(id => (
              <button key={id} className="id-chip" onClick={() => onOpen(id)}>{id}</button>
            ))}
          </div>
        )}
        <div className="sugg-actions">
          {s.actions.includes('commit') && s.taskIds[0] && (
            <button className="btn-sm" onClick={() => onCommit(s.taskIds[0])}><Plus size={14} />Commit</button>
          )}
          {s.actions.includes('hermes') && s.taskIds[0] && (
            <button className="btn-sm" onClick={() => onHermes(s.taskIds[0])}><Bot size={14} />Hand to Hermes</button>
          )}
          {s.actions.includes('open') && s.taskIds[0] && (
            <button className="btn-sm-ghost" onClick={() => onOpen(s.taskIds[0])}>Open<ArrowRight size={14} /></button>
          )}
        </div>
      </div>
      {s.basis && <div className="sugg-basis">based on {s.basis}</div>}
    </div>
  )
}
