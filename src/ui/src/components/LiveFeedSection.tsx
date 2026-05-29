import React from 'react'
import { useAcrStatus } from '../hooks/useAcrStatus'
import type { AcrJob } from '../types'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-700 text-slate-300',
  running: 'bg-blue-900 text-blue-300',
  done: 'bg-emerald-900 text-emerald-300',
  failed: 'bg-red-900 text-red-300',
}

function statusChipClass(status: string): string {
  return STATUS_COLORS[status] ?? 'bg-slate-700 text-slate-300'
}

function JobRow({ job }: { job: AcrJob }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded bg-slate-800">
      <span className="flex-1 text-sm text-slate-200 truncate">{job.title}</span>
      <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusChipClass(job.status)}`}>
        {job.status}
      </span>
    </div>
  )
}

export function LiveFeedSection(): React.JSX.Element {
  const { data, isLoading } = useAcrStatus()

  return (
    <section className="space-y-2">
      <h3 className="text-slate-300 text-sm font-semibold uppercase tracking-wide">
        Live Feed
      </h3>

      {isLoading && (
        <p className="text-slate-500 text-sm italic">Loading ACR status...</p>
      )}

      {!isLoading && data?.offline && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-slate-700 text-slate-400">
          ACR offline
        </span>
      )}

      {!isLoading && data && !data.offline && (
        <>
          {data.jobs.length === 0 ? (
            <p className="text-slate-500 text-sm italic">No ACR jobs.</p>
          ) : (
            <div className="space-y-1">
              {data.jobs.slice(0, 5).map(job => (
                <JobRow key={job.id} job={job} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
