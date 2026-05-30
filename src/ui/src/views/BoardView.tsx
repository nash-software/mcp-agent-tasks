import React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Task, TaskStatus, PanelState } from '../types'
import { useTasks } from '../hooks/useTasks'
import { closeBatch } from '../api'
import { BoardCard } from '../components/BoardCard'
import { ViewHeader } from '../components/ViewHeader'
import { type Filter, matchFilter, type Area } from '../lib/filter'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo',        label: 'Queued' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'blocked',     label: 'Blocked' },
  { status: 'done',        label: 'Done' },
]

interface Props {
  filter: Filter
  areaMap?: Record<string, Area>
  onOpenPanel: (panel: PanelState) => void
}

export function BoardView({ filter, areaMap = {}, onOpenPanel }: Props): React.JSX.Element {
  const { tasks: allTasks, isLoading, error } = useTasks()
  const tasks = allTasks.filter(t => matchFilter(filter, t.project ?? '', t.area, areaMap))

  // "Complete all" — batch-close every done task into the Completed sprint-closure (P4-02)
  const queryClient = useQueryClient()
  const completeAll = useMutation({
    mutationFn: () => closeBatch(),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['tasks'] }) },
  })

  if (isLoading) {
    return (
      <div
        className="grid gap-4"
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
      <div className="text-status-red text-sm">
        Failed to load tasks: {error.message}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ViewHeader title="Board" subtitle="All tasks across every project" />
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}
      >
      {COLUMNS.map(col => {
        const colTasks = tasks.filter((t: Task) => t.status === col.status)
        return (
          <div key={col.status} className="space-y-2">
            {/* Column header — 11px/600/muted/uppercase */}
            <div className="flex items-center justify-between">
              <h2
                className="font-semibold text-ink-muted uppercase tracking-wider"
                style={{ fontSize: 11 }}
              >
                {col.label}{' '}
                <span className="text-ink-faint font-mono tabular-nums">
                  ({colTasks.length})
                </span>
              </h2>
              {/* Complete all — closes every done task into the Completed tab (P4-02) */}
              {col.status === 'done' && colTasks.length > 0 && (
                <button
                  type="button"
                  onClick={() => completeAll.mutate()}
                  disabled={completeAll.isPending}
                  className="text-[10px] font-medium text-accent hover:underline disabled:opacity-50"
                  title="Move all done tasks to Completed"
                >
                  {completeAll.isPending ? 'Completing…' : 'Complete all'}
                </button>
              )}
            </div>

            {/* Cards */}
            {colTasks.map((task: Task) => (
              <BoardCard
                key={task.id}
                task={task}
                onOpenPanel={onOpenPanel}
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
    </div>
  )
}
