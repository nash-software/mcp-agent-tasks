import React, { useState, useRef, useEffect } from 'react'
import type { BrainDumpCandidate } from '../hooks/useBrainDump'
import { AREA_DOT } from '../lib/tokens'

const AREAS: BrainDumpCandidate['area'][] = ['client', 'personal', 'outsource', 'internal']

interface Props {
  candidate: BrainDumpCandidate
  projects: string[]
  onCommit: (candidate: BrainDumpCandidate) => void
  onDispatch: (candidate: BrainDumpCandidate) => void
  onRemove: () => void
  committed?: boolean
  dispatched?: boolean
  acrOffline?: boolean
  /** When true, auto-focuses the title input on mount (set for index === 0) */
  autoFocus?: boolean
}

export function CandidateCard({
  candidate,
  projects,
  onCommit,
  onDispatch,
  onRemove,
  committed = false,
  dispatched = false,
  acrOffline = false,
  autoFocus = false,
}: Props): React.JSX.Element {
  const [title, setTitle] = useState(candidate.title)
  const [project, setProject] = useState(candidate.project)
  const [area, setArea] = useState<BrainDumpCandidate['area']>(candidate.area)
  const [why, setWhy] = useState(candidate.why ?? '')
  // Open why by default when a why was inferred from the LLM
  const [showWhy, setShowWhy] = useState(Boolean(candidate.why))
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus && titleRef.current) {
      titleRef.current.focus()
    }
  }, [autoFocus])

  const current: BrainDumpCandidate = { title, project, area, ...(why ? { why } : {}) }

  const actionDone = committed || dispatched

  return (
    <div className="bg-surface-1 border border-surface-3 rounded-card p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-2.5">
          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={actionDone}
            className="w-full bg-transparent border-b border-surface-3 pb-1 text-sm text-ink
              focus:outline-none focus:border-accent disabled:opacity-50 transition-colors
              placeholder-ink-faint"
            placeholder="Task title"
          />

          {/* Project + Area row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Project select */}
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              disabled={actionDone}
              className="bg-surface-2 border border-surface-3 rounded-badge px-2 py-1 text-xs text-ink-2
                focus:outline-none focus:border-accent disabled:opacity-50 transition-colors appearance-none
                cursor-pointer"
            >
              {projects.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
              {!projects.includes('GEN') && <option value="GEN">GEN</option>}
            </select>

            {/* Area chips */}
            <div className="flex items-center gap-1.5">
              {AREAS.map(a => (
                <button
                  key={a}
                  type="button"
                  disabled={actionDone}
                  onClick={() => !actionDone && setArea(a)}
                  className={[
                    'flex items-center gap-1.5 px-2 py-0.5 rounded-badge text-xs transition-colors',
                    area === a
                      ? 'bg-surface-3 text-ink border border-surface-3'
                      : 'bg-transparent text-ink-muted hover:bg-surface-2 border border-transparent hover:border-surface-3',
                    actionDone ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                  ].join(' ')}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${AREA_DOT[a]}`} />
                  <span>{a}</span>
                </button>
              ))}
            </div>

            {/* Why toggle */}
            <button
              onClick={() => setShowWhy(v => !v)}
              className="text-xs text-ink-faint hover:text-ink-2 transition-colors ml-auto"
              type="button"
            >
              {showWhy ? '− why' : '+ why'}
            </button>
          </div>

          {/* Collapsible Why field */}
          {showWhy && (
            <textarea
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              disabled={actionDone}
              rows={2}
              className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-xs text-ink-2
                focus:outline-none focus:border-accent resize-none disabled:opacity-50 transition-colors
                placeholder-ink-faint"
              placeholder="Why is this task important?"
            />
          )}
        </div>

        {/* Discard button */}
        {!actionDone && (
          <button
            onClick={onRemove}
            className="text-ink-faint hover:text-status-red transition-colors text-lg leading-none mt-0.5 shrink-0"
            title="Discard"
            type="button"
          >
            ×
          </button>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 justify-end items-center pt-0.5">
        {committed ? (
          <span className="text-xs text-status-green font-medium flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Created
          </span>
        ) : dispatched ? (
          <span className={`text-xs font-medium ${acrOffline ? 'text-status-amber' : 'text-accent'}`}>
            {acrOffline ? 'ACR offline' : 'Sent to ACR ✓'}
          </span>
        ) : (
          <>
            <button
              onClick={() => onDispatch(current)}
              disabled={acrOffline}
              title={acrOffline ? 'ACR offline' : '→ ACR'}
              className={[
                'px-3 py-1.5 text-xs rounded-input border transition-colors',
                acrOffline
                  ? 'border-surface-3 text-ink-faint cursor-not-allowed opacity-50'
                  : 'border-surface-3 text-ink-2 hover:bg-surface-2 hover:text-ink',
              ].join(' ')}
              type="button"
            >
              → ACR
            </button>
            <button
              onClick={() => onCommit(current)}
              disabled={!title.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-input bg-status-green text-white
                hover:bg-status-green/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              type="button"
            >
              Create task
            </button>
          </>
        )}
      </div>
    </div>
  )
}
