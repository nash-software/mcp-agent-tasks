import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Task } from '../types'
import { useMilestones } from '../hooks/useMilestones'
import { useTasks } from '../hooks/useTasks'
import { createMilestone, updateTask } from '../api'
import { ViewHeader } from '../components/ViewHeader'
import { type Filter, matchFilter, type Area } from '../lib/filter'
import { milestoneProject } from '../lib/milestone'

interface Props {
  filter: Filter
  areaMap?: Record<string, Area>
}

/** Status dot colour per task status, matching the design-token colour palette. */
function statusDotClass(status: Task['status']): string {
  switch (status) {
    case 'done':       return 'bg-status-green'
    case 'in_progress': return 'bg-status-blue'
    case 'blocked':    return 'bg-status-red'
    case 'closed':     return 'bg-ink-muted'
    default:           return 'bg-ink-2'
  }
}

/**
 * Inline task picker for a single milestone card.
 * Shows tasks in the same project that are not yet assigned to this milestone.
 */
interface TaskPickerProps {
  milestoneId: string
  /** All tasks available — filtered by project and current assignment inside. */
  candidates: Task[]
  onSelect: (taskId: string) => void
  onClose: () => void
  isPending: boolean
}

function TaskPicker({ milestoneId, candidates, onSelect, onClose, isPending }: TaskPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const filtered = candidates.filter(t =>
    !query || t.title.toLowerCase().includes(query.toLowerCase()) || t.id.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div className="mt-2 bg-surface-2 border border-surface-3 rounded-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          className="flex-1 bg-surface-1 border border-surface-3 rounded-input px-2 py-1 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent/60"
          placeholder="Search tasks…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          disabled={isPending}
        />
        <button
          className="text-xs text-ink-muted hover:text-ink transition-colors"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-ink-muted py-1">
          {candidates.length === 0 ? 'All tasks already linked or no tasks in this project.' : 'No tasks match.'}
        </p>
      ) : (
        <ul className="space-y-0.5 max-h-48 overflow-y-auto">
          {filtered.map(t => (
            <li key={t.id}>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-3 transition-colors text-left group"
                onClick={() => onSelect(t.id)}
                disabled={isPending}
              >
                <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${statusDotClass(t.status)}`} />
                <span className="flex-1 text-xs text-ink truncate">{t.title}</span>
                <span className="shrink-0 text-xs text-ink-muted font-mono opacity-60 group-hover:opacity-100">{t.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Milestone id shown in the picker as a reference, hidden — used only for aria / test */}
      <span className="sr-only" data-milestone-id={milestoneId} />
    </div>
  )
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
  // P5-06: surface a visible error when a milestone-assign fails (was a silent rollback).
  const [assignError, setAssignError] = useState<string | null>(null)

  // Per-milestone picker open state (milestoneId or null)
  const [pickerOpen, setPickerOpen] = useState<string | null>(null)

  const createMutation = useMutation({
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

  // Assign / unassign task mutation — optimistic update on tasks list
  const assignMutation = useMutation({
    mutationFn: ({ taskId, milestoneId }: { taskId: string; milestoneId: string | null }) =>
      updateTask(taskId, { milestone: milestoneId }),
    onMutate: async ({ taskId, milestoneId }) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['tasks'] })
      const previous = queryClient.getQueryData<Task[]>(['tasks'])
      // Optimistically update the task in cache
      if (previous) {
        queryClient.setQueryData<Task[]>(
          ['tasks'],
          prev => prev?.map(t =>
            t.id === taskId ? { ...t, milestone: milestoneId ?? undefined } : t,
          ) ?? [],
        )
      }
      return { previous }
    },
    onError: (err: unknown, _vars, context) => {
      // Roll back on error AND surface it (P5-06: was a silent rollback — overview §5).
      if (context?.previous) {
        queryClient.setQueryData(['tasks'], context.previous)
      }
      setAssignError(err instanceof Error ? err.message : 'Failed to assign task to milestone')
      setTimeout(() => setAssignError(null), 5000)
    },
    onSettled: () => {
      // Refetch to ensure consistency
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['milestones'] })
    },
  })

  const handleCreate = useCallback((): void => {
    const title   = newTitle.trim()
    const project = newProject.trim().toUpperCase()
    if (!title)   { setFormError('Title is required');   return }
    if (!project) { setFormError('Project is required'); return }
    // Generate a simple ID: PROJECT-ms-<timestamp>
    const id = `${project}-ms-${Date.now().toString(36)}`
    createMutation.mutate({
      id,
      title,
      project,
      ...(newDue ? { due_date: newDue } : {}),
    })
  }, [newTitle, newProject, newDue, createMutation])

  const handleAssign = useCallback((taskId: string, milestoneId: string): void => {
    assignMutation.mutate({ taskId, milestoneId })
    setPickerOpen(null)
  }, [assignMutation])

  const handleUnassign = useCallback((taskId: string): void => {
    assignMutation.mutate({ taskId, milestoneId: null })
  }, [assignMutation])

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
      {/* P5-06: visible error when a milestone-assign fails (was a silent rollback) */}
      {assignError && (
        <div
          role="alert"
          className="px-3 py-2 rounded text-xs text-status-red bg-status-red/10 border border-status-red/20 flex items-start gap-2"
        >
          <span className="flex-1 leading-relaxed">{assignError}</span>
          <button
            onClick={() => setAssignError(null)}
            className="text-status-red/70 hover:text-status-red flex-shrink-0 leading-none"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}
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
              disabled={createMutation.isPending}
              onClick={handleCreate}
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
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

        // Candidate tasks: same project, not already linked to this milestone
        const candidates = tasks.filter(t =>
          t.project === project && t.milestone !== ms.id,
        )

        const isPickerOpen = pickerOpen === ms.id
        const isAssigning  = assignMutation.isPending

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

            {/* Assigned tasks list */}
            {related.length > 0 && (
              <ul className="space-y-0.5 pt-1 border-t border-surface-3">
                {related.map(t => (
                  <li key={t.id} className="flex items-center gap-2 py-1 group">
                    <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${statusDotClass(t.status)}`} />
                    <span className="flex-1 text-xs text-ink truncate">{t.title}</span>
                    <span className="shrink-0 text-xs text-ink-muted font-mono opacity-60">{t.id}</span>
                    <button
                      className="shrink-0 text-xs text-ink-muted hover:text-status-red transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove from milestone"
                      onClick={() => handleUnassign(t.id)}
                      disabled={isAssigning}
                      aria-label={`Remove ${t.id} from milestone`}
                    >
                      &times;
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Add task control */}
            {isPickerOpen ? (
              <TaskPicker
                milestoneId={ms.id}
                candidates={candidates}
                onSelect={(taskId) => handleAssign(taskId, ms.id)}
                onClose={() => setPickerOpen(null)}
                isPending={isAssigning}
              />
            ) : (
              <button
                className="w-full flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors py-0.5"
                onClick={() => setPickerOpen(ms.id)}
                disabled={isAssigning}
              >
                <span className="text-base leading-none">+</span>
                <span>Add task</span>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
