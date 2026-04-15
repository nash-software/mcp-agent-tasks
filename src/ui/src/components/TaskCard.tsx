import React from 'react'
import type { Task } from '../types'
import { Badge } from './Badge'

interface Props {
  task: Task
  onClick?: () => void
}

export function TaskCard({ task, onClick }: Props): React.JSX.Element {
  const labels = task.labels?.slice(0, 3) ?? []
  return (
    <div
      className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-2 cursor-pointer hover:border-slate-500 hover:bg-slate-750 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-slate-500 font-mono">{task.id}</span>
        <Badge variant="priority" value={task.priority} />
      </div>
      <p className="text-sm text-slate-200 leading-snug">{task.title}</p>
      <div className="flex flex-wrap gap-1">
        <Badge variant="type" value={task.type} />
        {labels.map(l => (
          <span key={l} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-slate-700 text-slate-400">
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}
