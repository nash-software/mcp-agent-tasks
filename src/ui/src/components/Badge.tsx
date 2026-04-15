import React from 'react'
import type { TaskType, TaskPriority, TaskStatus } from '../types'

const TYPE_COLORS: Record<TaskType, string> = {
  feature: 'bg-violet-900 text-violet-300',
  bug:     'bg-red-900 text-red-300',
  chore:   'bg-slate-700 text-slate-300',
  spike:   'bg-amber-900 text-amber-300',
  spec:    'bg-blue-900 text-blue-300',
}

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high:   'bg-red-900 text-red-300',
  medium: 'bg-amber-900 text-amber-300',
  low:    'bg-slate-700 text-slate-300',
  normal: 'bg-slate-700 text-slate-300',
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  queued:      'bg-slate-700 text-slate-300',
  in_progress: 'bg-blue-900 text-blue-300',
  blocked:     'bg-red-900 text-red-300',
  done:        'bg-green-900 text-green-300',
}

interface Props {
  variant: 'type' | 'priority' | 'status'
  value: string
}

export function Badge({ variant, value }: Props): React.JSX.Element {
  let cls = 'bg-slate-700 text-slate-300'
  if (variant === 'type') cls = TYPE_COLORS[value as TaskType] ?? cls
  else if (variant === 'priority') cls = PRIORITY_COLORS[value as TaskPriority] ?? cls
  else if (variant === 'status') cls = STATUS_COLORS[value as TaskStatus] ?? cls

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>
      {value.replace('_', ' ')}
    </span>
  )
}
