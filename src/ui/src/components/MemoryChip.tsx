/**
 * MemoryChip.tsx — Inline chip shown below an assistant bubble when a
 * memory_candidate SSE event arrives. Lets the user save or dismiss the
 * detected fact.
 */
import React, { useState, useEffect } from 'react'
import { Brain, X, Check } from 'lucide-react'

export interface MemoryCandidate {
  id: string
  text: string
}

interface Props {
  candidate: MemoryCandidate
  onSave: (candidate: MemoryCandidate) => Promise<void>
  onDismiss: (id: string) => void
  saving: boolean
}

export function MemoryChip({ candidate, onSave, onDismiss, saving }: Props): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(false)
  const [remembered, setRemembered] = useState(false)

  useEffect(() => {
    if (!remembered) return
    const t = setTimeout(() => setDismissed(true), 2000)
    return () => clearTimeout(t)
  }, [remembered])

  if (dismissed) return null

  if (remembered) {
    return (
      <div className="memory-chip remembered" role="status">
        <Check size={11} />
        <span>Remembered</span>
      </div>
    )
  }

  async function handleSave(): Promise<void> {
    await onSave(candidate)
    setRemembered(true)
  }

  return (
    <div className="memory-chip" role="group" aria-label="Save as memory">
      <Brain size={11} className="memory-chip-icon" />
      <span className="memory-chip-text">{candidate.text}</span>
      <button
        className="memory-chip-btn save"
        onClick={() => void handleSave()}
        disabled={saving}
        aria-label="Save memory"
      >
        Remember
      </button>
      <button
        className="memory-chip-btn dismiss"
        onClick={() => onDismiss(candidate.id)}
        aria-label="Dismiss"
      >
        <X size={10} />
      </button>
    </div>
  )
}
