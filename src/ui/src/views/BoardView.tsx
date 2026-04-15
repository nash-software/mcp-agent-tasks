import React from 'react'
import type { Task, TaskStatus, FilterState } from '../types'
import { useTasks } from '../hooks/useTasks'
import { TaskCard } from '../components/TaskCard'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'queued',      label: 'Queued' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'blocked',     label: 'Blocked' },
  { status: 'done',        label: 'Done' },
]

interface Props {
  filters: FilterState
  onTaskClick?: (task: Task) => void
}

export function BoardView({ filters, onTaskClick }: Props): React.JSX.Element {
  const { tasks, isLoading, error } = useTasks({
    project:   filters.project || undefined,
    milestone: filters.milestone || undefined,
    label:     filters.label || undefined,
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-6">
        {COLUMNS.map(col => (
          <div key={col.status} className="space-y-3">
            <div className="h-5 bg-slate-800 rounded w-24 animate-pulse" />
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-slate-800 rounded animate-pulse" />
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-red-400 text-sm">
        Failed to load tasks: {error.message}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-6">
      {COLUMNS.map(col => {
        const colTasks = tasks.filter(t => t.status === col.status)
        return (
          <div key={col.status} className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
              {col.label} <span className="text-slate-600">({colTasks.length})</span>
            </h2>
            {colTasks.map(task => (
              <TaskCard key={task.id} task={task} onClick={() => onTaskClick?.(task)} />
            ))}
            {colTasks.length === 0 && (
              <p className="text-xs text-slate-600 italic">No tasks</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
