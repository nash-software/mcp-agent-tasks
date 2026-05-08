import React from 'react'
import { useMutation } from '@tanstack/react-query'
import type { FilterState } from '../types'
import { useMilestones } from '../hooks/useMilestones'
import { useTasks } from '../hooks/useTasks'
import { Badge } from '../components/Badge'
import { createMilestone } from '../api'

interface Props {
  filters: FilterState
}

export function RoadmapView({ filters }: Props): React.JSX.Element {
  const { milestones, isLoading: mlLoading } = useMilestones()
  const { tasks, isLoading: tLoading } = useTasks({
    project: filters.project || undefined,
  })
  const mutation = useMutation({ mutationFn: createMilestone })

  if (mlLoading || tLoading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-28 bg-slate-800 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-end">
        <button className="px-3 py-1.5 bg-violet-600 text-white text-sm rounded hover:bg-violet-500">
          New Milestone
        </button>
      </div>
      {milestones.length === 0 && (
        <p className="text-slate-500 text-sm">No milestones found.</p>
      )}
      {milestones.map(ms => {
        const related = tasks.filter(t => t.milestone === ms.id)
        const done = related.filter(t => t.status === 'done').length
        const pct = related.length > 0 ? Math.round((done / related.length) * 100) : 0

        return (
          <div key={ms.id} className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-slate-200 font-medium">{ms.title}</h2>
              <Badge variant="status" value={ms.status} />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{done}/{related.length} tasks done</span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 bg-slate-700 rounded overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            {ms.due_date && (
              <p className="text-xs text-slate-500">Due {ms.due_date}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
