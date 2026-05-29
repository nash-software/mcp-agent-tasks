import React from 'react'
import { useToday } from '../hooks/useToday'
import type { Task, TaskArea } from '../types'

const AREA_COLORS: Record<TaskArea, string> = {
  client:    'bg-violet-900 text-violet-300',
  personal:  'bg-emerald-900 text-emerald-300',
  outsource: 'bg-amber-900 text-amber-300',
  internal:  'bg-slate-700 text-slate-300',
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function AreaBadge({ area }: { area: TaskArea | undefined }): React.JSX.Element {
  const resolved: TaskArea = area ?? 'internal'
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${AREA_COLORS[resolved]}`}>
      {resolved}
    </span>
  )
}

function CapacityGauge({ committedMinutes, targetMinutes }: { committedMinutes: number; targetMinutes: number }): React.JSX.Element {
  const pct = targetMinutes > 0 ? committedMinutes / targetMinutes : 0
  const clampedPct = Math.min(pct, 1)

  let barColor: string
  if (pct > 1) {
    barColor = 'bg-red-500'
  } else if (pct >= 0.8) {
    barColor = 'bg-amber-500'
  } else {
    barColor = 'bg-emerald-500'
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-400">
        <span>Capacity</span>
        <span>{formatMinutes(committedMinutes)} / {formatMinutes(targetMinutes)}</span>
      </div>
      <div className="h-2 bg-slate-700 rounded overflow-hidden">
        <div
          className={`h-full rounded transition-all ${barColor}`}
          style={{ width: `${Math.round(clampedPct * 100)}%` }}
        />
      </div>
    </div>
  )
}

interface TaskCardProps {
  task: Task
  action: React.ReactNode
}

function TaskCard({ task, action }: TaskCardProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded bg-slate-800 hover:bg-slate-750">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-slate-500">{task.project ?? ''}-</span>
          <span className="text-sm text-slate-100 truncate">{task.title}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <AreaBadge area={task.area} />
          {task.project && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-900 text-indigo-300 font-mono">
              {task.project}
            </span>
          )}
        </div>
      </div>
      {action}
    </div>
  )
}

function groupByArea(tasks: Task[]): Map<TaskArea, Task[]> {
  const map = new Map<TaskArea, Task[]>()
  for (const task of tasks) {
    const area: TaskArea = task.area ?? 'internal'
    const group = map.get(area)
    if (group) {
      group.push(task)
    } else {
      map.set(area, [task])
    }
  }
  return map
}

interface Props {
  targetMinutes?: number
}

export function TodayView({ targetMinutes }: Props): React.JSX.Element {
  const { data, isLoading, error, scheduleForToday, removeFromToday } = useToday(targetMinutes)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
        Loading today&apos;s tasks…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-red-400 text-sm">
        Failed to load: {error.message}
      </div>
    )
  }

  if (!data) return <></>

  const { committed, candidates, capacity } = data
  const completedCount = committed.filter(t => t.status === 'done').length
  const committedGroups = groupByArea(committed)

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      {/* Header + stats */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-slate-100 text-xl font-semibold">Today</h2>
          <span className="text-sm text-slate-400">
            {completedCount} completed / {committed.length} committed
          </span>
        </div>
        <CapacityGauge
          committedMinutes={capacity.committedMinutes}
          targetMinutes={capacity.targetMinutes}
        />
      </div>

      {/* Committed tasks */}
      <section>
        <h3 className="text-slate-300 text-sm font-semibold uppercase tracking-wide mb-3">
          Committed
        </h3>
        {committed.length === 0 ? (
          <p className="text-slate-500 text-sm italic">
            Nothing committed yet — add tasks from the queue below.
          </p>
        ) : (
          <div className="space-y-4">
            {Array.from(committedGroups.entries()).map(([area, tasks]) => (
              <div key={area}>
                <div className="flex items-center gap-2 mb-2">
                  <AreaBadge area={area} />
                  <span className="text-xs text-slate-500">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="space-y-1 pl-1">
                  {tasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      action={
                        <button
                          onClick={() => void removeFromToday(task.id)}
                          className="text-xs px-2 py-1 rounded text-slate-400 hover:text-red-300 hover:bg-slate-700 transition-colors shrink-0"
                          title="Remove from today"
                        >
                          Remove
                        </button>
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Candidate queue */}
      <section>
        <h3 className="text-slate-300 text-sm font-semibold uppercase tracking-wide mb-3">
          Queue
        </h3>
        {candidates.length === 0 ? (
          <p className="text-slate-500 text-sm italic">All caught up!</p>
        ) : (
          <div className="space-y-1">
            {candidates.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                action={
                  <button
                    onClick={() => void scheduleForToday(task.id)}
                    className="text-xs px-2 py-1 rounded text-slate-400 hover:text-emerald-300 hover:bg-slate-700 transition-colors shrink-0"
                    title="Commit to today"
                  >
                    + Today
                  </button>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
