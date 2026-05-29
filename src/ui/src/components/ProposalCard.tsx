/**
 * ProposalCard — renders an automation Proposal pending review.
 * Port from design_handoff_life_os/reference/agent.jsx (ProposalCard).
 *
 * Props:
 *   proposal  — the Proposal to render
 *   onPromote — called with the proposal when user clicks "Promote to skill"
 *   onDismiss — called with the proposal when user clicks "Dismiss"
 *
 * Layout (per spec P2-06):
 *   head  : Wand glyph + "Automation proposal" + PrefixBadge
 *   title : "Turn this into a skill: **{skillName}**"  from "{taskTitle}"
 *   summary
 *   3 numbered steps
 *   footer: ≈ N saved/run · frequency · Dismiss · Promote
 */
import React from 'react'
import { Wand2, Plus } from 'lucide-react'
import { fmtSaved } from '../lib/triage'
import type { Proposal } from '../types'

interface ProposalCardProps {
  proposal: Proposal
  onPromote: (proposal: Proposal) => void
  onDismiss: (proposal: Proposal) => void
  /** Inline error to show after a failed promote (calm, no toast). */
  promoteError?: string
}

/** Small coloured project prefix badge. */
function PrefixBadge({ project }: { project: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-badge bg-surface-2 font-mono text-xs text-ink-muted shrink-0">
      {project}
    </span>
  )
}

export function ProposalCard({
  proposal,
  onPromote,
  onDismiss,
  promoteError,
}: ProposalCardProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 rounded-card bg-surface-1 border border-surface-3">
      {/* Head */}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-xs font-medium text-accent">
          <Wand2 size={13} />
          Automation proposal
        </span>
        <PrefixBadge project={proposal.project} />
      </div>

      {/* Title */}
      <div className="text-sm font-medium text-ink">
        Turn this into a skill: <strong>{proposal.skillName}</strong>
      </div>
      <div className="text-xs text-ink-muted italic">from &ldquo;{proposal.taskTitle}&rdquo;</div>

      {/* Summary */}
      <div className="text-xs text-ink-2 leading-relaxed">{proposal.summary}</div>

      {/* Steps — render at most 3 per the proposal contract */}
      <div className="flex flex-col gap-2">
        {proposal.steps.slice(0, 3).map((step, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-ink-2">
            <span className="font-mono text-ink-muted shrink-0 w-4 text-right select-none">{i + 1}</span>
            <span>{step}</span>
          </div>
        ))}
      </div>

      {/* Error (calm inline, no toast) */}
      {promoteError && (
        <div className="text-xs text-status-red">{promoteError}</div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <span className="text-xs text-ink-muted shrink-0">
          ≈ <strong className="text-ink">{fmtSaved(proposal.savedPerRun)}</strong> saved / run
        </span>
        <span className="text-xs text-ink-muted shrink-0">{proposal.frequency}</span>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1 px-3 py-1.5 rounded-input bg-surface-2 text-xs text-ink-muted hover:text-ink transition-colors"
          onClick={() => { onDismiss(proposal) }}
        >
          Dismiss
        </button>
        <button
          className="flex items-center gap-1 px-3 py-1.5 rounded-input bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors"
          onClick={() => { onPromote(proposal) }}
        >
          <Plus size={12} />
          Promote to skill
        </button>
      </div>
    </div>
  )
}
