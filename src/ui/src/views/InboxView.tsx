import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchTasks } from '../api'
import { VoiceCapture } from '../components/VoiceCapture'
import type { Task } from '../types'

async function promoteTask(id: string): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}/promote`, { method: 'POST' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<Task>
}

interface Props {
  projects: string[]
}

export function InboxView({ projects }: Props): React.JSX.Element {
  const queryClient = useQueryClient()

  const { data: tasks = [], isLoading, error } = useQuery({
    queryKey: ['tasks', { status: 'draft' }],
    queryFn: () => fetchTasks({ status: 'draft' }),
  })

  const promote = useMutation({
    mutationFn: promoteTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  const defaultProject = projects[0] ?? 'default'

  if (isLoading) {
    return <div className="p-6 text-slate-500 text-sm">Loading...</div>
  }

  if (error) {
    return <div className="p-6 text-red-400 text-sm">Failed to load inbox: {error.message}</div>
  }

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <VoiceCapture project={defaultProject} />

      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
        Captured Tasks ({tasks.length})
      </h2>

      {tasks.length === 0 && (
        <p className="text-slate-500 text-sm italic">No captured tasks awaiting review.</p>
      )}

      {tasks.map(task => (
        <div
          key={task.id}
          className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-start justify-between gap-4"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-slate-500 font-mono">{task.id}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">{task.type}</span>
              {task.auto_captured && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900 text-violet-300">captured</span>
              )}
            </div>
            <p className="text-sm text-slate-200 truncate">{task.title}</p>
            {task.why && (
              <p className="text-xs text-slate-500 mt-1 truncate">{task.why}</p>
            )}
          </div>
          <button
            onClick={() => promote.mutate(task.id)}
            disabled={promote.isPending}
            className="px-3 py-1.5 text-xs font-medium rounded bg-emerald-800 text-emerald-200 hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            Promote
          </button>
        </div>
      ))}
    </div>
  )
}
