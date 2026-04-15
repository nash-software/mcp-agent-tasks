import React from 'react'
import { useActivity } from '../hooks/useActivity'
import { relativeTime } from '../lib/time'

const STATUS_COLOR: Record<string, string> = {
  queued:      'text-slate-400',
  in_progress: 'text-blue-400',
  blocked:     'text-red-400',
  done:        'text-green-400',
}

export function ActivityView(): React.JSX.Element {
  const { activity, isLoading, error } = useActivity()

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 bg-slate-800 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return <div className="p-6 text-red-400 text-sm">Failed to load activity: {error.message}</div>
  }

  if (activity.length === 0) {
    return <div className="p-6 text-slate-500 text-sm">No activity yet.</div>
  }

  return (
    <div className="p-6">
      <ol className="relative border-l border-slate-700 space-y-6">
        {activity.map((entry, i) => (
          <li key={i} className="ml-4">
            <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-slate-600 bg-slate-800" />
            <div className="space-y-0.5">
              <p className="text-sm text-slate-200">
                {entry.title}
                <span className="ml-2 text-xs text-slate-500 font-mono">{entry.task_id}</span>
              </p>
              <p className="text-xs text-slate-500">
                <span className={STATUS_COLOR[entry.from_status] ?? 'text-slate-400'}>
                  {entry.from_status.replace('_', ' ')}
                </span>
                {' → '}
                <span className={STATUS_COLOR[entry.to_status] ?? 'text-slate-400'}>
                  {entry.to_status.replace('_', ' ')}
                </span>
                {entry.reason && <span className="ml-2 text-slate-600">— {entry.reason}</span>}
                <span className="ml-2">{relativeTime(entry.at)}</span>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
