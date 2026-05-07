import React from 'react'
import type { Task, TaskStatus } from '../types'
import { Badge } from './Badge'
import { relativeTime } from '../lib/time'

interface Props {
  task: Task | null
  onClose: () => void
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  queued:      'text-slate-400',
  in_progress: 'text-blue-400',
  blocked:     'text-red-400',
  done:        'text-green-400',
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  )
}

function DateRow({ label, iso }: { label: string; iso?: string }): React.JSX.Element | null {
  if (!iso) return null
  const date = new Date(iso)
  const abs = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300" title={iso}>{abs} · {relativeTime(iso)}</span>
    </div>
  )
}

export function TaskDetailPanel({ task, onClose }: Props): React.JSX.Element {
  const visible = task !== null

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 z-40 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-96 bg-slate-900 border-l border-slate-700 z-50 flex flex-col shadow-2xl transition-transform duration-200 ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {task && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-700">
              <div className="space-y-1 min-w-0">
                <span className="text-xs text-slate-500 font-mono">{task.id}</span>
                <h2 className="text-sm font-semibold text-slate-100 leading-snug">{task.title}</h2>
              </div>
              <button
                onClick={onClose}
                className="text-slate-500 hover:text-slate-300 flex-shrink-0 mt-0.5 text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">

              {/* Badges */}
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="status" value={task.status} />
                <Badge variant="priority" value={task.priority} />
                <Badge variant="type" value={task.type} />
              </div>

              {/* Project / Milestone */}
              {(task.project || task.milestone) && (
                <Section title="Context">
                  <div className="flex flex-wrap gap-2 text-xs">
                    {task.project && (
                      <span className="bg-slate-800 text-slate-300 px-2 py-1 rounded font-mono">{task.project}</span>
                    )}
                    {task.milestone && (
                      <span className="bg-indigo-900/50 text-indigo-300 px-2 py-1 rounded">{task.milestone}</span>
                    )}
                  </div>
                </Section>
              )}

              {/* Description */}
              {task.why && (
                <Section title="Description">
                  <p className="text-sm text-slate-300 leading-relaxed">{task.why}</p>
                </Section>
              )}

              {/* Labels */}
              {task.labels && task.labels.length > 0 && (
                <Section title="Labels">
                  <div className="flex flex-wrap gap-1">
                    {task.labels.map(l => (
                      <span key={l} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-400">
                        {l}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {/* Git */}
              {task.git && (task.git.branch || task.git.pr) && (
                <Section title="Git">
                  <div className="space-y-1 text-xs">
                    {task.git.branch && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">Branch</span>
                        <span className="font-mono text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded truncate">{task.git.branch}</span>
                      </div>
                    )}
                    {task.git.pr && (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">PR</span>
                        {task.git.pr.url ? (
                          <a
                            href={task.git.pr.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-400 hover:text-indigo-300 underline"
                          >
                            #{task.git.pr.number}
                          </a>
                        ) : (
                          <span className="text-slate-300">#{task.git.pr.number}</span>
                        )}
                        <span className={`${task.git.pr.state === 'merged' ? 'text-purple-400' : task.git.pr.state === 'open' ? 'text-green-400' : 'text-slate-400'}`}>
                          {task.git.pr.state}
                        </span>
                      </div>
                    )}
                  </div>
                </Section>
              )}

              {/* Dates */}
              <Section title="Dates">
                <div className="space-y-1">
                  <DateRow label="Created" iso={task.created} />
                  <DateRow label="Updated" iso={task.updated} />
                  <DateRow label="Last activity" iso={task.last_activity} />
                </div>
              </Section>

              {/* Claimed by */}
              {task.claimed_by && (
                <Section title="Claimed by">
                  <span className="text-xs font-mono text-amber-400 bg-amber-900/30 px-2 py-1 rounded">{task.claimed_by}</span>
                </Section>
              )}

              {/* Transition history */}
              {task.transitions && task.transitions.length > 0 && (
                <Section title="History">
                  <div className="space-y-2">
                    {[...task.transitions].reverse().slice(0, 6).map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                          <span className={STATUS_COLORS[t.from as TaskStatus] ?? 'text-slate-400'}>{t.from}</span>
                          <span className="text-slate-600">→</span>
                          <span className={STATUS_COLORS[t.to as TaskStatus] ?? 'text-slate-400'}>{t.to}</span>
                        </div>
                        <div className="text-slate-500 min-w-0">
                          <span>{relativeTime(t.at)}</span>
                          {t.reason && <p className="text-slate-600 truncate" title={t.reason}>{t.reason}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

            </div>
          </>
        )}
      </div>
    </>
  )
}
