import React, { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Milestone } from '../types'
import { useMilestones } from '../hooks/useMilestones'
import { useTasks } from '../hooks/useTasks'
import { createMilestone } from '../api'
import { ViewHeader } from '../components/ViewHeader'
import { type Filter, matchFilter, type Area } from '../lib/filter'

interface Props {
  filter: Filter
  areaMap?: Record<string, Area>
}

/**
 * A milestone's owning project is encoded in its ID. The real Milestone type has no `project`
 * field, and milestones live in a per-project store keyed as `PREFIX-ms-<ts>`. Derive the project
 * from the ID prefix (everything before `-ms-`, falling back to the first dash segment) so filtering
 * uses the milestone's own project rather than the fragile related-task derivation.
 */
function milestoneProject(ms: Milestone): string {
  const msIdx = ms.id.indexOf('-ms-')
  if (msIdx > 0) return ms.id.slice(0, msIdx)
  const dash = ms.id.indexOf('-')
  return dash > 0 ? ms.id.slice(0, dash) : ms.id
}

export function RoadmapView({ filter, areaMap = {} }: Props): React.JSX.Element {
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

  // Milestones carry no `area`; filter by the milestone's own project (derived from its ID),
  // with area resolved from that project via the shared areaMap.
  const visibleMilestones = milestones.filter(ms =>
    matchFilter(filter, milestoneProject(ms), undefined, areaMap),
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <ViewHeader
        title="Roadmap"
        right={
          <button
            className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm rounded-input transition-colors font-sans"
            onClick={() => setShowForm(s => !s)}
          >
            {showForm ? 'Cancel' : 'New Milestone'}
          </button>
        }
      />

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
        const project   = milestoneProject(ms)

        return (
          <div key={ms.id} className="bg-surface-1 border border-surface-3 rounded-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                {/* Project badge — from the milestone's own project (ID prefix) */}
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
