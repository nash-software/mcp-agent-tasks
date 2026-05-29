/**
 * LiveFeedSection — persistent right ambient rail (P1-05)
 *
 * Three hairline-separated sections rendered in the App grid `ambient` slot:
 *   1. ACR · Agent Control Room
 *   2. Knowledge (Brain search)
 *   3. Recent Activity
 *
 * Each section fails independently — one offline service never blocks another.
 * Zero error surfaces: offline states show calm grey affordances only.
 */
import React, { useState, useEffect } from 'react'
import { Server, Brain, Activity } from 'lucide-react'
import { useAcrStatus } from '../hooks/useAcrStatus'
import { useBrainSearch } from '../hooks/useBrainSearch'
import { useActivity } from '../hooks/useActivity'
import { StatusDot } from './atoms'
import { relativeTime } from '../lib/time'
import type { AcrJob, TaskStatus, PanelState } from '../types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface LiveFeedSectionProps {
  onOpenPanel: (panel: PanelState) => void
}

// ── ACR dot logic (status of the whole service) ───────────────────────────────
// green if any job running; red if none running but any failed; grey otherwise

type AcrDotVariant = 'running' | 'failed' | 'idle'

function resolveAcrDot(jobs: AcrJob[], offline: boolean): AcrDotVariant {
  if (offline) return 'idle'
  if (jobs.some(j => j.status === 'running')) return 'running'
  if (jobs.some(j => j.status === 'failed')) return 'failed'
  return 'idle'
}

// ── ACR status dot element ────────────────────────────────────────────────────

function AcrDot({ variant }: { variant: AcrDotVariant }): React.JSX.Element {
  if (variant === 'running') {
    return (
      <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: 9, height: 9 }}>
        <span
          className="absolute inset-0 rounded-full animate-pulse"
          style={{ background: '#3B82F6', opacity: 0.3, transform: 'scale(1.8)' }}
        />
        <span className="rounded-full bg-status-blue" style={{ width: 8, height: 8 }} />
      </span>
    )
  }
  if (variant === 'failed') {
    return <span className="rounded-full bg-status-red shrink-0" style={{ width: 8, height: 8 }} />
  }
  // idle / offline
  return <span className="rounded-full bg-ink-muted shrink-0" style={{ width: 8, height: 8 }} />
}

// ── ACR job status chip ───────────────────────────────────────────────────────

const JOB_CHIP: Record<AcrJob['status'], string> = {
  pending: 'bg-surface-2 text-ink-muted',
  running: 'bg-blue-950 text-status-blue',
  done:    'bg-green-950 text-status-green',
  failed:  'bg-red-950 text-status-red',
}

function AcrJobRow({ job }: { job: AcrJob }): React.JSX.Element {
  const chipClass = JOB_CHIP[job.status] ?? JOB_CHIP.pending
  return (
    <div className="flex items-center gap-2 py-1.5">
      {job.status === 'running' && (
        <span className="relative inline-flex shrink-0" style={{ width: 8, height: 8 }}>
          <span
            className="absolute inset-0 rounded-full animate-pulse"
            style={{ background: '#3B82F6', opacity: 0.3, transform: 'scale(1.8)' }}
          />
          <span className="rounded-full bg-status-blue" style={{ width: 8, height: 8 }} />
        </span>
      )}
      <span className="flex-1 text-xs text-ink-2 truncate min-w-0">{job.title}</span>
      {job.elapsed_s !== undefined && job.status === 'running' && (
        <span className="font-mono text-xs text-ink-muted tabular-nums shrink-0">{job.elapsed_s}s</span>
      )}
      <span className={`text-xs px-1.5 py-0.5 rounded-badge font-medium shrink-0 ${chipClass}`}>
        {job.status}
      </span>
    </div>
  )
}

// ── ACR Section ───────────────────────────────────────────────────────────────

function AcrSection(): React.JSX.Element {
  const { data } = useAcrStatus()

  const offline = data?.offline ?? false
  const jobs = data?.jobs ?? []
  const dotVariant = resolveAcrDot(jobs, offline || !data)

  return (
    <div className="px-4 py-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Server size={13} className="text-ink-muted shrink-0" />
        <span className="text-xs font-medium text-ink-2 tracking-wide flex-1">ACR · Agent Control Room</span>
        <AcrDot variant={dotVariant} />
      </div>

      {/* Offline */}
      {offline && (
        <p className="text-xs text-ink-muted">ACR offline ○</p>
      )}

      {/* Jobs (online) */}
      {!offline && data && jobs.length === 0 && (
        <p className="text-xs text-ink-muted">No active jobs</p>
      )}

      {!offline && data && jobs.length > 0 && (
        <div>
          {jobs.slice(0, 5).map(job => (
            <AcrJobRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Knowledge Section ─────────────────────────────────────────────────────────

function KnowledgeSection(): React.JSX.Element {
  const [inputValue, setInputValue] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(inputValue), 400)
    return () => clearTimeout(timer)
  }, [inputValue])

  const { data, isLoading } = useBrainSearch(debouncedQuery)

  const offline = data?.offline === true

  return (
    <div className="px-4 py-4 border-t border-surface-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Brain size={13} className="text-ink-muted shrink-0" />
        <span className="text-xs font-medium text-ink-2 tracking-wide">Knowledge</span>
      </div>

      {/* Search input */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-input bg-surface-2 focus-within:ring-1 focus-within:ring-surface-3 mb-2">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          placeholder="Search knowledge…"
          className="flex-1 bg-transparent text-xs text-ink-2 placeholder-ink-muted outline-none min-w-0"
        />
      </div>

      {/* Results */}
      {debouncedQuery.trim().length > 0 && (
        <>
          {isLoading && !offline && (
            <p className="text-xs text-ink-muted py-1">Searching…</p>
          )}

          {offline && (
            <p className="text-xs text-ink-muted py-1">Brain unavailable</p>
          )}

          {!isLoading && !offline && data && data.results.length === 0 && (
            <p className="text-xs text-ink-muted py-1">No results</p>
          )}

          {!isLoading && !offline && data && data.results.length > 0 && (
            <div className="space-y-2">
              {data.results.slice(0, 5).map((result, idx) => (
                <div key={idx} className="space-y-0.5">
                  <p className="text-xs font-medium text-ink truncate">{result.title}</p>
                  <p className="text-xs text-ink-muted line-clamp-2 leading-relaxed">{result.snippet}</p>
                  {result.source && (
                    <p className="font-mono text-xs text-ink-faint truncate">{result.source}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Recent Activity Section ───────────────────────────────────────────────────

// Map any activity status to a renderable TaskStatus for StatusDot
function toTaskStatus(s: string): TaskStatus {
  const valid: TaskStatus[] = ['todo', 'in_progress', 'done', 'blocked', 'archived', 'draft', 'approved']
  if (valid.includes(s as TaskStatus)) return s as TaskStatus
  // prototype 'queued' → 'todo'
  if (s === 'queued' || s === 'cancelled') return 'todo'
  return 'todo'
}

function statusLabel(s: string): string {
  switch (s) {
    case 'todo':        return 'todo'
    case 'in_progress': return 'in progress'
    case 'done':        return 'done'
    case 'blocked':     return 'blocked'
    case 'archived':    return 'archived'
    case 'draft':       return 'draft'
    case 'approved':    return 'approved'
    default:            return s
  }
}

interface RecentActivitySectionProps {
  onOpenPanel: (panel: PanelState) => void
}

function RecentActivitySection({ onOpenPanel }: RecentActivitySectionProps): React.JSX.Element {
  const { activity, isLoading } = useActivity()

  const recent = activity.slice(0, 6)

  return (
    <div className="px-4 py-4 border-t border-surface-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Activity size={13} className="text-ink-muted shrink-0" />
        <span className="text-xs font-medium text-ink-2 tracking-wide">Recent Activity</span>
      </div>

      {isLoading && (
        <p className="text-xs text-ink-muted">Loading…</p>
      )}

      {!isLoading && recent.length === 0 && (
        <p className="text-xs text-ink-muted">No recent activity</p>
      )}

      {!isLoading && recent.length > 0 && (
        <div>
          {recent.map((entry, idx) => (
            <button
              key={`${entry.task_id}-${idx}`}
              onClick={() => onOpenPanel({ mode: 'detail', taskId: entry.task_id })}
              className="w-full flex items-center gap-2 py-1.5 text-left hover:bg-surface-2 rounded transition-colors group"
            >
              <StatusDot status={toTaskStatus(entry.to_status)} />
              <span className="flex-1 text-xs text-ink-2 truncate min-w-0 group-hover:text-ink transition-colors">
                {entry.title}
              </span>
              <span className="text-xs text-ink-muted shrink-0">→ {statusLabel(entry.to_status)}</span>
              <span className="font-mono text-xs text-ink-faint shrink-0 tabular-nums">{relativeTime(entry.at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── LiveFeedSection (root export) ─────────────────────────────────────────────

export function LiveFeedSection({ onOpenPanel }: LiveFeedSectionProps): React.JSX.Element {
  return (
    <div className="h-full overflow-y-auto text-ink-2">
      <AcrSection />
      <KnowledgeSection />
      <RecentActivitySection onOpenPanel={onOpenPanel} />
    </div>
  )
}
