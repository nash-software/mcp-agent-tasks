/**
 * GoalsList.tsx — Goals section for the combined Goals + Milestones page.
 * Supports create, edit (inline), and achieve (soft-complete) for up to 5 active goals.
 */
import React, { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createGoal, updateGoal } from '../api'
import type { Goal } from '../types'

const MAX_ACTIVE = 5

interface Props {
  goals: Goal[]
  isLoading: boolean
}

function statusBadgeClass(status: Goal['status']): string {
  switch (status) {
    case 'active':   return 'bg-status-blue/20 text-status-blue'
    case 'achieved': return 'bg-status-green/20 text-status-green'
    case 'paused':   return 'bg-ink-2/20 text-ink-muted'
  }
}

function statusLabel(status: Goal['status']): string {
  switch (status) {
    case 'active':   return 'Active'
    case 'achieved': return 'Achieved'
    case 'paused':   return 'Paused'
  }
}

export function GoalsList({ goals, isLoading }: Props): React.JSX.Element {
  const queryClient = useQueryClient()

  const [showForm, setShowForm]       = useState(false)
  const [newTitle, setNewTitle]       = useState('')
  const [newDesc, setNewDesc]         = useState('')
  const [newMetric, setNewMetric]     = useState('')
  const [newDate, setNewDate]         = useState('')
  const [formError, setFormError]     = useState<string | null>(null)
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editTitle, setEditTitle]     = useState('')
  const [editDesc, setEditDesc]       = useState('')
  const [editMetric, setEditMetric]   = useState('')
  const [editDate, setEditDate]       = useState('')
  const [editError, setEditError]     = useState<string | null>(null)

  const activeCount = goals.filter(g => g.status === 'active').length

  const createMut = useMutation({
    mutationFn: createGoal,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals'] })
      setShowForm(false)
      setNewTitle(''); setNewDesc(''); setNewMetric(''); setNewDate('')
      setFormError(null)
    },
    onError: (err: Error) => setFormError(err.message),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateGoal>[1] }) =>
      updateGoal(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['goals'] })
      setEditingId(null)
      setEditError(null)
    },
    onError: (err: Error) => setEditError(err.message),
  })

  const handleCreate = useCallback((): void => {
    const title = newTitle.trim()
    if (!title) { setFormError('Title is required'); return }
    createMut.mutate({
      title,
      description: newDesc.trim() || undefined,
      metric: newMetric.trim() || undefined,
      target_date: newDate || null,
    })
  }, [newTitle, newDesc, newMetric, newDate, createMut])

  const startEdit = useCallback((g: Goal): void => {
    setEditingId(g.id)
    setEditTitle(g.title)
    setEditDesc(g.description ?? '')
    setEditMetric(g.metric ?? '')
    setEditDate(g.target_date ?? '')
    setEditError(null)
  }, [])

  const saveEdit = useCallback((): void => {
    if (!editingId) return
    const title = editTitle.trim()
    if (!title) { setEditError('Title is required'); return }
    updateMut.mutate({
      id: editingId,
      data: {
        title,
        description: editDesc.trim() || undefined,
        metric: editMetric.trim() || undefined,
        target_date: editDate || null,
      },
    })
  }, [editingId, editTitle, editDesc, editMetric, editDate, updateMut])

  const achieve = useCallback((id: string): void => {
    updateMut.mutate({ id, data: { status: 'achieved' } })
  }, [updateMut])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => (
          <div key={i} className="h-20 bg-surface-2 rounded-card animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Create form */}
      {showForm && (
        <div className="bg-surface-1 border border-surface-3 rounded-card p-4 space-y-3">
          <h3 className="text-sm font-medium text-ink">New Goal</h3>
          {formError && <p className="text-xs text-status-red">{formError}</p>}
          <div className="space-y-2">
            <input
              className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent/60"
              placeholder="Title * (e.g. Reach £5k MRR)"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              maxLength={200}
            />
            <input
              className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent/60"
              placeholder="Metric (optional, e.g. £5k MRR)"
              value={newMetric}
              onChange={e => setNewMetric(e.target.value)}
              maxLength={100}
            />
            <textarea
              className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent/60 resize-none"
              placeholder="Description (optional)"
              rows={2}
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
            />
            <input
              type="date"
              className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-sm text-ink-2 font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-accent/60"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
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
              disabled={createMut.isPending}
              onClick={handleCreate}
            >
              {createMut.isPending ? 'Creating…' : 'Create Goal'}
            </button>
          </div>
        </div>
      )}

      {/* New Goal button */}
      {!showForm && (
        <button
          className="w-full flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors py-0.5 disabled:opacity-40"
          disabled={activeCount >= MAX_ACTIVE}
          onClick={() => setShowForm(true)}
          title={activeCount >= MAX_ACTIVE ? `Max ${MAX_ACTIVE} active goals` : 'Add a new goal'}
        >
          <span className="text-base leading-none">+</span>
          <span>New Goal {activeCount >= MAX_ACTIVE ? `(${MAX_ACTIVE} active max)` : ''}</span>
        </button>
      )}

      {/* Goal cards */}
      {goals.length === 0 && !showForm && (
        <p className="text-ink-muted text-sm">No goals yet — add your first active goal above.</p>
      )}

      {goals.map(g => (
        <div key={g.id} className="bg-surface-1 border border-surface-3 rounded-card p-4 space-y-2">
          {editingId === g.id ? (
            <div className="space-y-2">
              {editError && <p className="text-xs text-status-red">{editError}</p>}
              <input
                className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent/60"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                maxLength={200}
              />
              <input
                className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent/60"
                placeholder="Metric (optional)"
                value={editMetric}
                onChange={e => setEditMetric(e.target.value)}
                maxLength={100}
              />
              <textarea
                className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent/60 resize-none"
                placeholder="Description (optional)"
                rows={2}
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
              />
              <input
                type="date"
                className="w-full bg-surface-2 border border-surface-3 rounded-input px-3 py-1.5 text-sm text-ink-2 font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-accent/60"
                value={editDate}
                onChange={e => setEditDate(e.target.value)}
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  className="px-2 py-1 text-xs text-ink-muted hover:text-ink transition-colors"
                  onClick={() => { setEditingId(null); setEditError(null) }}
                >
                  Cancel
                </button>
                <button
                  className="px-2 py-1 bg-accent hover:bg-accent-hover text-white text-xs rounded-input transition-colors disabled:opacity-50"
                  disabled={updateMut.isPending}
                  onClick={saveEdit}
                >
                  {updateMut.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-block px-1.5 py-0.5 rounded-badge text-xs font-medium ${statusBadgeClass(g.status)}`}>
                    {statusLabel(g.status)}
                  </span>
                  {g.metric && (
                    <span className="text-xs text-ink-muted font-mono">{g.metric}</span>
                  )}
                </div>
                <h2 className="text-sm font-medium text-ink">{g.title}</h2>
                {g.description && (
                  <p className="text-xs text-ink-muted leading-relaxed">{g.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {g.target_date && (
                  <span className="text-xs text-ink-muted font-mono tabular-nums mr-1">{g.target_date}</span>
                )}
                <button
                  className="text-xs text-ink-muted hover:text-ink transition-colors px-1.5 py-0.5 rounded hover:bg-surface-2"
                  onClick={() => startEdit(g)}
                  title="Edit goal"
                >
                  Edit
                </button>
                {g.status === 'active' && (
                  <button
                    className="text-xs text-status-green hover:text-status-green/80 transition-colors px-1.5 py-0.5 rounded hover:bg-surface-2 disabled:opacity-50"
                    disabled={updateMut.isPending}
                    onClick={() => achieve(g.id)}
                    title="Mark as achieved"
                  >
                    Achieve
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
