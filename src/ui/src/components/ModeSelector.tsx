/**
 * ModeSelector.tsx — Tab bar for switching advisor personas.
 */
import React from 'react'
import { PERSONAS, type PersonaId } from '../lib/advisor'

interface Props {
  mode: PersonaId
  onModeChange: (mode: PersonaId) => void
}

const PERSONA_ORDER: PersonaId[] = ['pm', 'chairman', 'coach']

export function ModeSelector({ mode, onModeChange }: Props): React.JSX.Element {
  return (
    <div className="mode-selector" role="tablist" aria-label="Advisor mode">
      {PERSONA_ORDER.map(id => {
        const p = PERSONAS[id]
        return (
          <button
            key={id}
            role="tab"
            aria-selected={mode === id}
            className={`mode-tab${mode === id ? ' active' : ''}`}
            onClick={() => onModeChange(id)}
          >
            <span className="mode-tab-label">{p.label}</span>
            <span className="mode-tab-desc">{p.descriptor}</span>
          </button>
        )
      })}
    </div>
  )
}
