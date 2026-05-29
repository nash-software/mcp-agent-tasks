import React, { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Task } from '../types'
import { useMilestones } from '../hooks/useMilestones'
import { useTasks } from '../hooks/useTasks'
import { createMilestone } from '../api'
import { type Filter, matchFilter } from '../lib/filter'

interface Props {
  filter: Filter
}

/** Derive the first project prefix found among milestone-related tasks. */
function deriveProject(related: Task[]): string | null {
  for (const t of related) {
    if (t.project) return t.project
  }
  return null
}

export function RoadmapView({ filter }: Props): React.JSX.Element {
  const queryClient = useQueryClient()
  const { milestones, isLoading: mlLoading, error: mlError } = useMilestones()
  const { tasks, isLoading: tLoading } = useTasks()

  // Inline create form state
  const [showForm, setShowForm]     = useState(false)
  const [newTitle, setNewTitle]     = useState('')
  const [newProject, setNewProject] = useState('')
  const [newDue, setNewDue]         = useState('')
  const [formError, setFormError]   = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: createMilestone,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['milestones'] })
      setShowForm(false)
      setNewTitle('')
      setNewProject('')
      setNewDue('')
      setFormError(null)
    },
    onError: (err: Error) => {
      setFormError(err.message)
    },
  })

  const handleCreate = useCallback((): void => {
    const title   = newTitle.trim()
    const project = newProject.trim().toUpperCase()
    if (!title)   { setFormError('Title is required');   return }
    if (!project) { setFormError('Project is required'); return }
    // Generate a simple ID: PROJECT-ms-<timestamp>
    const id = `${project}-ms-${Date.now().toString(36)}`
    mutation.mutate({
      id,
      title,
      project,
      ...(newDue ? { due_date: newDue } : {}),
    })
  }, [newTitle, newProject, newDue, mutation])

  if (mlLoading || tLoading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-28 bg-surface-2 rounded-card animate-pulse" />
        ))}
      </div>
    )
  }

  if (mlError) {
    return (
      <div className="p-6 text-status-red text-sm">
        Failed to load milestones: {mlError.message}
      </div>
    )
  }

  // Milestones carry no `area` — derive project from related tasks, then matchFilter
  // (area resolved via areaOfProject). A milestone whose project can't be derived passes
  // only when no project filter is active.
  const visibleMilestones = milestones.filter(ms => {
    const related = tasks.filter(t => t.milestone === ms.id)
    const project = deriveProject(related)
    if (project == null) return filter.projects.length === 0 && filter.areas.length === 0
    return matchFilter(filter, project)
  })

  return (
    <div className="p-6 space-y-4">
      {/* Header row */}
      <div className="flex justify-end">
        <button
          className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm rounded-input transition-colors"
          onClick={() => setShowForm(s => !s)}
        >
          {showForm ? 'Cancel' : 'New Milestone'}
        </button>
      </div>

      {/* Inline create form */}
      {showForm && (
        <div className="bg-surface-1 border border-surface-3 rounded-card p-4 space-y-3">
          <h3 className="text-sm font-medium text-ink">New Milestone</h3>
          {formError && (
            <p className="text-xs text-status-red">{formError}</p>
          )}
          <div className="space-y-2">
            <input
              className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent/60"
              placeholder="Title *"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
            />
            <input
              className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted font-mono focus:outline-none focus:ring-1 focus:ring-accent/60"
              placeholder="Project prefix * (e.g. MCPAT)"
              value={newProject}
              onChange={e => setNewProject(e.target.value)}
            />
            <input
              type="date"
              className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-sm text-ink-2 font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-accent/60"
              value={newDue}
              onChange={e => setNewDue(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1.5 text-sm text-ink-muted hover:text-ink transition-colors"
              onClick={() => { setShowForm(false); setFormError(null) }}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm rounded-input transition-colors disabled:opacity-50"
              disabled={mutation.isPending}
              onClick={handleCreate}
            >
              {mutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {visibleMilestones.length === 0 && (
        <p className="text-ink-muted text-sm">
          {milestones.length === 0 ? 'No milestones found.' : 'No milestones match this filter.'}
        </p>
      )}

      {/* Milestone cards */}
      {visibleMilestones.map(ms => {
        const related   = tasks.filter(t => t.milestone === ms.id)
        const done      = related.filter(t => t.status === 'done').length
        const pct       = related.length > 0 ? Math.round((done / related.length) * 100) : 0
        const project   = deriveProject(related)

        return (
          <div key={ms.id} className="bg-surface-1 border border-surface-3 rounded-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                {/* Project badge — derived from related tasks */}
                {project && (
                  <span className="inline-block px-1.5 py-0.5 rounded-badge bg-surface-2 text-ink-2 text-xs font-mono mb-1">
                    {project}
                  </span>
                )}
                <h2 className="text-sm font-medium text-ink truncate">{ms.title}</h2>
              </div>
              {ms.due_date && (
                <span className="shrink-0 text-xs text-ink-muted font-mono tabular-nums">
                  {ms.due_date}
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-ink-muted font-mono tabular-nums">
                <span>{done}/{related.length} done</span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: 'var(--accent, #0070F3)' }}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
