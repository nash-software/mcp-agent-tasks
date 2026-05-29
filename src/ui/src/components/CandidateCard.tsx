import React, { useState } from 'react'
import type { BrainDumpCandidate } from '../hooks/useBrainDump'

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
}: Props): React.JSX.Element {
  const [title, setTitle] = useState(candidate.title)
  const [project, setProject] = useState(candidate.project)
  const [area, setArea] = useState<BrainDumpCandidate['area']>(candidate.area)
  const [why, setWhy] = useState(candidate.why ?? '')
  const [showWhy, setShowWhy] = useState(Boolean(candidate.why))

  const current: BrainDumpCandidate = { title, project, area, ...(why ? { why } : {}) }

  const actionDone = committed || dispatched

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-2">
          {/* Title */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={actionDone}
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200
              focus:outline-none focus:border-violet-500 disabled:opacity-60"
            placeholder="Task title"
          />

          {/* Project + Area row */}
          <div className="flex gap-2">
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              disabled={actionDone}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300
                focus:outline-none focus:border-violet-500 disabled:opacity-60"
            >
              {projects.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
              {!projects.includes('GEN') && <option value="GEN">GEN</option>}
            </select>

            <select
              value={area}
              onChange={(e) => setArea(e.target.value as BrainDumpCandidate['area'])}
              disabled={actionDone}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300
                focus:outline-none focus:border-violet-500 disabled:opacity-60"
            >
              {AREAS.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>

            <button
              onClick={() => setShowWhy(v => !v)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors ml-auto"
              type="button"
            >
              {showWhy ? 'hide why' : 'add why'}
            </button>
          </div>

          {/* Why field */}
          {showWhy && (
            <textarea
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              disabled={actionDone}
              rows={2}
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-xs text-slate-300
                focus:outline-none focus:border-violet-500 resize-none disabled:opacity-60"
              placeholder="Why is this task important?"
            />
          )}
        </div>

        {/* Discard button */}
        {!actionDone && (
          <button
            onClick={onRemove}
            className="text-slate-500 hover:text-red-400 transition-colors text-lg leading-none mt-0.5"
            title="Discard"
            type="button"
          >
            ×
          </button>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 justify-end">
        {committed ? (
          <span className="text-xs text-emerald-400 font-medium">Created ✓</span>
        ) : dispatched ? (
          <span className={`text-xs font-medium ${acrOffline ? 'text-amber-400' : 'text-violet-400'}`}>
            {acrOffline ? 'ACR offline' : 'Sent ✓'}
          </span>
        ) : (
          <>
            <button
              onClick={() => onDispatch(current)}
              disabled={acrOffline}
              title={acrOffline ? 'ACR is offline' : undefined}
              className="px-3 py-1 text-xs rounded border border-slate-600 text-slate-300
                hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              type="button"
            >
              Send to ACR
            </button>
            <button
              onClick={() => onCommit(current)}
              disabled={!title.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded bg-emerald-800 text-emerald-200
                hover:bg-emerald-700 disabled:opacity-50 transition-colors"
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
