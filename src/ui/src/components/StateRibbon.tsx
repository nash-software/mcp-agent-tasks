/**
 * StateRibbon — Shows active coach state (ground/refer) and active play chip.
 * Appears between the chat header and the message thread when the state-gate
 * has intervened or a play is active.
 */
import React from 'react'
import { AlertTriangle, Phone, Activity } from 'lucide-react'

interface Props {
  stateAction: 'ground' | 'refer' | null
  activePlay: string | null
  activePlayLabel: string | null
}

export function StateRibbon({ stateAction, activePlay, activePlayLabel }: Props): React.JSX.Element | null {
  if (stateAction === null && activePlay === null) return null

  return (
    <div className="state-ribbon">
      {stateAction === 'refer' && (
        <div className="state-ribbon-flag refer">
          <Phone size={12} />
          <span>Grounded check-in — consider speaking to someone you trust</span>
        </div>
      )}
      {stateAction === 'ground' && (
        <div className="state-ribbon-flag ground">
          <AlertTriangle size={12} />
          <span>Grounding mode active</span>
        </div>
      )}
      {activePlay !== null && (
        <div className="state-ribbon-play">
          <Activity size={12} />
          <span>{activePlayLabel ?? activePlay}</span>
        </div>
      )}
    </div>
  )
}
