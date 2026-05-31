/**
 * NewTaskModal — full-field "New task" entry form (P5-04).
 *
 * A create form is a discrete data-entry action, not a detail view, so a modal is the correct
 * affordance here (overview §9 reserves slide-in panels for detail views). Submits to POST /api/tasks
 * via createTask(), invalidates ['tasks']/['today'] on success, and surfaces server errors inline.
 */
import React, { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TaskPriority, TaskArea } from '../types'
import { createTask, type NewTaskFields } from '../api'
import type { ProjectEntry } from '../api'

interface Props {
  open: boolean
  onClose: () => void
  projects: ProjectEntry[]
}

const PRIORITIES: TaskPriority[] = ['critical', 'high', 'medium', 'low']
const AREAS: TaskArea[] = ['client', 'personal', 'outsource', 'internal']

export function NewTaskModal({ open, onClose, projects }: Props): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const titleRef = useRef<HTMLInputElement>(null)

  const [title, setTitle]       = useState('')
  const [project, setProject]   = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [area, setArea]         = useState<TaskArea | ''>('')
  const [estimate, setEstimate] = useState('')
  const [why, setWhy]           = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Reset + focus on open
  useEffect(() => {
    if (open) {
      setTitle(''); setProject(projects[0]?.prefix ?? ''); setPriority('medium')
      setArea(''); setEstimate(''); setWhy(''); setErrorMsg(null)
      setTimeout(() => titleRef.current?.focus(), 0)
    }
  }, [open, projects])

  const mutation = useMutation({
    mutationFn: (fields: NewTaskFields) => createTask(fields),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['today'] })
      onClose()
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    },
  })

  if (!open) return null

  const canSubmit = title.trim().length > 0 && project.length > 0 && !mutation.isPending

  function handleSubmit(): void {
    setErrorMsg(null)
    const trimmed = title.trim()
    if (!trimmed || !project) {
      setErrorMsg('Title and project are required.')
      return
    }
    const est = estimate.trim() === '' ? undefined : parseFloat(estimate)
    if (est !== undefined && (isNaN(est) || est < 0)) {
      setErrorMsg('Estimate must be a non-negative number.')
      return
    }
    mutation.mutate({
      title: trimmed,
      project,
      priority,
      ...(area ? { area } : {}),
      ...(est !== undefined ? { estimate_hours: est } : {}),
      ...(why.trim() ? { why: why.trim() } : {}),
    })
  }

  const fieldClass = 'w-full text-sm text-ink bg-surface-2 border border-surface-3 rounded px-2 py-1.5 outline-none focus:border-accent'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New task"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div
        className="w-[440px] max-w-[92vw] bg-surface-1 border border-surface-3 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-3">
          <h2 className="text-sm font-semibold text-ink">New task</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink text-lg leading-none" aria-label="Close">×</button>
        </div>

        {errorMsg && (
          <div role="alert" className="mx-4 mt-3 px-3 py-2 rounded text-xs text-status-red bg-status-red/10 border border-status-red/20">
            {errorMsg}
          </div>
        )}

        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="block text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Title</label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
              className={fieldClass}
              aria-label="Task title"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Project</label>
              <select value={project} onChange={(e) => setProject(e.target.value)} className={fieldClass} aria-label="Project">
                {projects.length === 0 && <option value="">(no projects)</option>}
                {projects.map(p => <option key={p.prefix} value={p.prefix}>{p.prefix}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={fieldClass} aria-label="Priority">
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Area</label>
              <select value={area} onChange={(e) => setArea(e.target.value as TaskArea | '')} className={fieldClass} aria-label="Area">
                <option value="">(none)</option>
                {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Estimate (h)</label>
              <input
                type="number" min="0" step="0.5" value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
                className={fieldClass}
                aria-label="Estimate hours"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1">Why</label>
            <textarea
              value={why}
              maxLength={1000}
              rows={3}
              onChange={(e) => setWhy(e.target.value)}
              className={`${fieldClass} resize-none`}
              aria-label="Why"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface-3">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs font-medium bg-surface-2 text-ink-2 hover:bg-surface-3 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              canSubmit ? 'bg-accent/20 text-accent hover:bg-accent/30' : 'bg-surface-2 text-ink-faint opacity-50 cursor-not-allowed'
            }`}
          >
            {mutation.isPending ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  )
}
