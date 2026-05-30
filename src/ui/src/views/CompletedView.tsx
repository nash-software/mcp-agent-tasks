/**
 * CompletedView — sprint-closure summary tab (P4-02).
 *
 * Renders closed tasks grouped by close_batch (falling back to closed_at date).
 * Each group shows: date heading, task count, total estimate_hours burned, and task titles.
 * Read-only. Empty state when no closed tasks exist.
 */
import React from 'react'
import { useTasks } from '../hooks/useTasks'
import { ViewHeader } from '../components/ViewHeader'
import type { Task } from '../types'

interface ClosureBatch {
  batchId: string        // close_batch value or date string for fallback grouping
  label: string          // human-readable heading
  tasks: Task[]
  totalEstimateHours: number
}

/** Format epoch ms or ISO string to a readable local date. */
function fmtDate(closedAt: number | string | undefined): string {
  if (closedAt === undefined) return 'Unknown date'
  const ms = typeof closedAt === 'number' ? closedAt : new Date(closedAt).getTime()
  if (isNaN(ms)) return 'Unknown date'
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Extract a readable date label from a close_batch id like "close-2026-05-30T14:22:00.000Z" */
function batchLabel(batchId: string, closedAt: number | undefined): string {
  // Prefer a date derived from close_batch id if it matches our format
  const m = batchId.match(/^close-(\d{4}-\d{2}-\d{2})/)
  if (m) {
    const d = new Date(m[1] + 'T00:00:00Z')
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    }
  }
  // Fallback: use closed_at epoch ms
  return fmtDate(closedAt)
}

/** Group closed tasks by close_batch, sorted newest-first. */
function groupBatches(tasks: Task[]): ClosureBatch[] {
  const byBatch = new Map<string, Task[]>()
  for (const t of tasks) {
    // Group key: close_batch when present, else date string from closed_at
    const key = t.close_batch ?? fmtDate(t.closed_at)
    const bucket = byBatch.get(key) ?? []
    bucket.push(t)
    byBatch.set(key, bucket)
  }

  const batches: ClosureBatch[] = []
  for (const [batchId, batchTasks] of byBatch) {
    // Representative closed_at for the batch (first task)
    const closedAt = batchTasks[0]?.closed_at
    const total = batchTasks.reduce((sum, t) => sum + (typeof t.estimate_hours === 'number' ? t.estimate_hours : 0), 0)
    batches.push({
      batchId,
      label: batchTasks[0]?.close_batch ? batchLabel(batchId, closedAt) : fmtDate(closedAt),
      tasks: batchTasks,
      totalEstimateHours: total,
    })
  }

  // Sort: newest first — use close_batch id or closed_at of first task as sort key
  batches.sort((a, b) => {
    const aTs = a.tasks[0]?.closed_at ?? 0
    const bTs = b.tasks[0]?.closed_at ?? 0
    return bTs - aTs
  })

  return batches
}

export function CompletedView(): React.JSX.Element {
  // Fetch all tasks and filter client-side to closed — spec recommends this; avoids a new GET route.
  const { tasks: allTasks, isLoading, error } = useTasks()

  const closedTasks = allTasks.filter(t => t.status === 'closed')
  const batches = groupBatches(closedTasks)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <ViewHeader title="Completed" subtitle="Sprint-closure summaries" />
        <div className="space-y-4">
          {[1, 2].map(i => (
            <div key={i} className="bg-surface-1 rounded-lg p-4 space-y-2 animate-pulse">
              <div className="h-4 bg-surface-2 rounded w-40" />
              <div className="h-3 bg-surface-2 rounded w-24" />
              <div className="space-y-1.5 mt-3">
                {[1, 2, 3].map(j => <div key={j} className="h-3 bg-surface-2 rounded" />)}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <ViewHeader title="Completed" subtitle="Sprint-closure summaries" />
        <p className="text-status-red text-sm">Failed to load tasks: {error.message}</p>
      </div>
    )
  }

  if (batches.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <ViewHeader title="Completed" subtitle="Sprint-closure summaries" />
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <p className="text-ink-muted text-sm">No completed sprints yet.</p>
          <p className="text-ink-faint text-xs max-w-xs">
            Use "Complete all" in the Board's Done column to archive a batch of finished tasks here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ViewHeader title="Completed" subtitle="Sprint-closure summaries" />
      <div className="space-y-4">
        {batches.map(batch => (
          <div
            key={batch.batchId}
            className="bg-surface-1 rounded-lg p-4 space-y-3"
          >
            {/* Batch heading */}
            <div className="flex items-baseline gap-3">
              <h2 className="font-semibold text-ink" style={{ fontSize: 14 }}>
                {batch.label}
              </h2>
              <span className="text-ink-faint text-xs font-mono tabular-nums">
                {batch.tasks.length} task{batch.tasks.length === 1 ? '' : 's'}
              </span>
              {batch.totalEstimateHours > 0 && (
                <span
                  className="ml-auto text-ink-muted text-xs font-mono tabular-nums"
                  title="Total estimated hours burned in this sprint"
                >
                  {batch.totalEstimateHours.toFixed(1)}h burned
                </span>
              )}
            </div>

            {/* Task list */}
            <ul className="space-y-1.5">
              {batch.tasks.map(task => (
                <li
                  key={task.id}
                  className="flex items-center gap-2 text-sm text-ink-muted"
                >
                  {/* Closed indicator dot */}
                  <span className="w-1.5 h-1.5 rounded-full bg-ink-faint flex-shrink-0" />
                  <span className="flex-1 truncate" title={task.title}>{task.title}</span>
                  <span className="text-ink-faint font-mono text-xs flex-shrink-0">{task.id}</span>
                  {typeof task.estimate_hours === 'number' && task.estimate_hours > 0 && (
                    <span className="text-ink-faint text-xs flex-shrink-0">
                      {task.estimate_hours}h
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
