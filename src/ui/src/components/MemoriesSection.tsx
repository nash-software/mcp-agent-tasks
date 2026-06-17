/**
 * MemoriesSection.tsx — Collapsible section showing user's advisor memories.
 * Pinned memories are shown first. Each row has a pin toggle and delete button.
 */
import React, { useState } from 'react'
import { Brain, Pin, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { useMemories } from '../hooks/useMemories'

export function MemoriesSection(): React.JSX.Element | null {
  const { memories, patchMemory, deleteMemory } = useMemories()
  const [expanded, setExpanded] = useState(false)

  if (memories.length === 0) return null

  return (
    <div className="memories-section">
      <button
        className="memories-section-head"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <Brain size={13} className="memories-section-icon" />
        <span className="section-label">Memories</span>
        <span className="memories-section-count">{memories.length}</span>
        <span className="memories-section-sub">things I know about you</span>
        {expanded ? <ChevronUp size={13} className="memories-chevron" /> : <ChevronDown size={13} className="memories-chevron" />}
      </button>

      {expanded && (
        <div className="memories-list">
          {memories.map(m => (
            <div key={m.id} className={`memory-row${m.pinned ? ' pinned' : ''}`}>
              <span className="memory-row-content">{m.content}</span>
              <div className="memory-row-actions">
                <button
                  className={`memory-row-btn pin${m.pinned ? ' active' : ''}`}
                  title={m.pinned ? 'Unpin' : 'Pin'}
                  aria-label={m.pinned ? 'Unpin memory' : 'Pin memory'}
                  onClick={() => void patchMemory(m.id, !m.pinned)}
                >
                  <Pin size={11} />
                </button>
                <button
                  className="memory-row-btn delete"
                  title="Delete"
                  aria-label="Delete memory"
                  onClick={() => void deleteMemory(m.id)}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
