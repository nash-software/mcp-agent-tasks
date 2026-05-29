import React from 'react'
import type { Task, TaskStatus, FilterState, PanelState } from '../types'
import { useTasks } from '../hooks/useTasks'
import { TaskCard } from '../components/TaskCard'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo',        label: 'Queued' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'blocked',     label: 'Blocked' },
  { status: 'done',        label: 'Done' },
]

interface Props {
  filters: FilterState
  onOpenPanel: (panel: PanelState) => void
}

export function BoardView({ filters, onOpenPanel }: Props): React.JSX.Element {
  const { tasks, isLoading, error } = useTasks({
    project:   filters.project || undefined,
    milestone: filters.milestone || undefined,
    label:     filters.label || undefined,
  })

  if (isLoading) {
    return (
      <div
        className="grid gap-4 p-6"
        style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}
      >
        {COLUMNS.map(col => (
          <div key={col.status} className="space-y-3">
            <div className="h-4 bg-surface-2 rounded w-24 animate-pulse" />
            {[1, 2, 3].map(i => (
              <div key={i} className="h-10 bg-surface-2 rounded animate-pulse" />
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-status-red text-sm">
        Failed to load tasks: {error.message}
      </div>
    )
  }

  return (
    <div
      className="grid gap-4 p-6"
      style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}
    >
      {COLUMNS.map(col => {
        const colTasks = tasks.filter((t: Task) => t.status === col.status)
        return (
          <div key={col.status} className="space-y-2">
            {/* Column header — 11px/600/muted/uppercase */}
            <h2
              className="font-semibold text-ink-muted uppercase tracking-wider"
              style={{ fontSize: 11 }}
            >
              {col.label}{' '}
              <span className="text-ink-faint font-mono tabular-nums">
                ({colTasks.length})
              </span>
            </h2>

            {/* Cards */}
            {colTasks.map((task: Task) => (
              <TaskCard
                key={task.id}
                task={task}
                mode="committed"
                onClick={() => onOpenPanel({ mode: 'detail', taskId: task.id })}
              />
            ))}

            {/* Empty placeholder */}
            {colTasks.length === 0 && (
              <p className="text-xs text-ink-muted italic px-3 py-2">No tasks</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
