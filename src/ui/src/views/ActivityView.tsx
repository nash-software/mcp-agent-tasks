import React from 'react'
import type { TaskStatus, PanelState } from '../types'
import { useActivity } from '../hooks/useActivity'
import { relativeTime } from '../lib/time'
import { STATUS_DOT } from '../lib/tokens'
import { type Filter, matchFilter, projectOfId } from '../lib/filter'

interface Props {
  filter: Filter
  onOpenPanel: (panel: PanelState) => void
}

/**
 * Map canonical status → node background class.
 * Keyed on `todo` (real store) — never `queued` (prototype alias).
 * Falls back to bg-ink-faint so unknown statuses are still visible.
 */
const STATUS_NODE: Record<TaskStatus, string> = {
  todo:        'bg-ink-muted',
  in_progress: 'bg-status-blue',
  done:        'bg-status-green',
  blocked:     'bg-status-red',
  archived:    'bg-ink-faint',
  draft:       'bg-ink-faint',
  approved:    'bg-status-green',
}

/** Human-readable status label. */
function statusLabel(s: string): string {
  return s.replace(/_/g, ' ')
}

export function ActivityView({ filter, onOpenPanel }: Props): React.JSX.Element {
  const { activity, isLoading, error } = useActivity()

  // Activity rows expose a task id but no `project` field — derive the prefix with projectOfId,
  // then matchFilter (area resolved via areaOfProject).
  const filtered = activity.filter(e => matchFilter(filter, projectOfId(e.task_id)))

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 bg-surface-2 rounded-card animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-status-red text-sm">
        Failed to load activity: {error.message}
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="p-6 text-ink-muted text-sm">
        {activity.length === 0 ? 'No activity yet.' : 'No activity matches this filter.'}
      </div>
    )
  }

  return (
    <div className="p-6">
      <ol className="relative border-l border-surface-3 space-y-6">
        {filtered.map((entry, i) => {
          const nodeClass = STATUS_DOT[entry.to_status] ?? 'bg-ink-faint'
          return (
            <li
              key={i}
              className="ml-4 cursor-pointer group"
              onClick={() => onOpenPanel({ mode: 'detail', taskId: entry.task_id })}
            >
              {/* Timeline node — color from to_status */}
              <div
                className={`absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full border border-surface-3 ${nodeClass}`}
              />

              <div className="space-y-0.5 group-hover:bg-surface-1 rounded transition-colors px-2 py-1 -mx-2">
                {/* Task title + ID */}
                <p className="text-sm text-ink">
                  {entry.title}
                  <span className="ml-2 text-xs text-ink-faint font-mono tabular-nums">
                    {entry.task_id}
                  </span>
                </p>

                {/* Transition + time */}
                <p className="text-xs text-ink-muted">
                  {statusLabel(entry.from_status)}
                  {' → '}
                  <span className="font-medium text-ink-2">
                    {statusLabel(entry.to_status)}
                  </span>
                  {entry.reason && (
                    <span className="ml-2 text-ink-faint">— {entry.reason}</span>
                  )}
                  <span className="ml-2 font-mono tabular-nums text-ink-faint">
                    {relativeTime(entry.at)}
                  </span>
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
