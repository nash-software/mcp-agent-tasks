/**
 * ActionCard.tsx — Inline draft card shown below advisor messages.
 * Renders an ActionDraft in pending / editing / confirmed / error / dismissed states.
 */
import React, { useState } from 'react'
import { CheckCircle, Edit2, X, RefreshCw, Layers, FileText, Target } from 'lucide-react'
import type { ActionDraft, ActionDraftType, TaskPriority } from '../types'
import { approveAction } from '../api'

// ── Props ──────────────────────────────────────────────────────────────────

export interface ActionCardProps {
  draft: ActionDraft
  /** Available project prefixes for the project selector in edit mode. */
  projects?: string[]
  onStatusChange: (id: string, status: ActionDraft['status']) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<ActionDraftType, string> = {
  create_task: 'Task',
  create_note: 'Note',
  set_milestone: 'Milestone',
}

const TYPE_ICON: Record<ActionDraftType, React.ReactNode> = {
  create_task: <Layers size={11} />,
  create_note: <FileText size={11} />,
  set_milestone: <Target size={11} />,
}

const PRIORITY_OPTIONS: TaskPriority[] = ['critical', 'high', 'medium', 'low']

// ── ActionCard ─────────────────────────────────────────────────────────────

export function ActionCard({ draft, projects = [], onStatusChange }: ActionCardProps): React.JSX.Element | null {
  const [editTitle, setEditTitle] = useState(draft.title)
  const [editProject, setEditProject] = useState(draft.project ?? '')
  const [editPriority, setEditPriority] = useState<TaskPriority>(draft.priority ?? 'medium')
  const [editing, setEditing] = useState(false)
  const [confirmedId, setConfirmedId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (draft.status === 'dismissed') return null

  if (draft.status === 'approved' && confirmedId !== null) {
    const label = draft.type === 'create_task' ? `Task created: ${confirmedId}` : draft.type === 'create_note' ? `Note created` : `Milestone set`
    return (
      <div className="action-card confirmed" role="status">
        <CheckCircle size={12} className="action-confirmed-icon" />
        <span className="action-confirmed-label">{label}</span>
      </div>
    )
  }

  async function handleApprove(overrides?: { title: string; project: string; priority: TaskPriority }): Promise<void> {
    // Double-approve guard: only proceed if still pending
    if (draft.status !== 'pending') return
    if (busy) return
    setBusy(true)
    setErrorMsg(null)
    // Signal approved immediately to prevent double-click
    onStatusChange(draft.id, 'approved')
    try {
      const result = await approveAction({
        type: draft.type,
        title: overrides?.title ?? draft.title,
        project: overrides?.project || draft.project,
        priority: overrides?.priority ?? draft.priority,
        body: draft.body,
        taskId: undefined,
      })
      if (!result.success) {
        setErrorMsg(result.error ?? 'Failed to create')
        onStatusChange(draft.id, 'pending')
        return
      }
      setConfirmedId(result.created_id ?? draft.title)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error'
      setErrorMsg(msg)
      onStatusChange(draft.id, 'pending')
    } finally {
      setBusy(false)
    }
  }

  function handleDismiss(): void {
    onStatusChange(draft.id, 'dismissed')
  }

  function handleEdit(): void {
    setEditing(true)
  }

  async function handleSaveAndCreate(): Promise<void> {
    const title = editTitle.trim()
    if (!title) return
    setEditing(false)
    onStatusChange(draft.id, 'edited')
    await handleApprove({ title, project: editProject, priority: editPriority })
  }

  const typeLabel = TYPE_LABEL[draft.type]
  const typeIcon = TYPE_ICON[draft.type]

  if (editing) {
    return (
      <div className="action-card editing" role="form" aria-label="Edit action">
        <div className="action-card-type-badge">
          {typeIcon}
          <span>{typeLabel}</span>
        </div>
        <div className="action-card-edit-fields">
          <input
            className="action-card-edit-title"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            placeholder="Title"
            maxLength={200}
            aria-label="Title"
          />
          {draft.type === 'create_task' && (
            <>
              {projects.length > 0 && (
                <select
                  className="action-card-edit-project"
                  value={editProject}
                  onChange={e => setEditProject(e.target.value)}
                  aria-label="Project"
                >
                  <option value="">No project</option>
                  {projects.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              )}
              <select
                className="action-card-edit-priority"
                value={editPriority}
                onChange={e => setEditPriority(e.target.value as TaskPriority)}
                aria-label="Priority"
              >
                {PRIORITY_OPTIONS.map(p => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="action-card-buttons">
          <button
            className="action-btn approve"
            onClick={() => void handleSaveAndCreate()}
            disabled={!editTitle.trim() || busy}
          >
            Save & Create
          </button>
          <button className="action-btn dismiss" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="action-card pending" role="group" aria-label={`Action suggestion: ${draft.title}`}>
      <div className="action-card-header">
        <span className="action-card-type-badge">
          {typeIcon}
          <span>{typeLabel}</span>
        </span>
        <span className="action-card-title">{draft.title}</span>
        {draft.project && <span className="action-card-project">{draft.project}</span>}
        {draft.priority && draft.type === 'create_task' && (
          <span className={`action-card-priority ${draft.priority}`}>{draft.priority}</span>
        )}
      </div>
      {errorMsg !== null && (
        <div className="action-card-error" role="alert">
          <span>Couldn't create — {errorMsg}</span>
          <button
            className="action-btn retry"
            onClick={() => { setErrorMsg(null); void handleApprove() }}
          >
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      )}
      <div className="action-card-buttons">
        <button
          className="action-btn approve"
          onClick={() => void handleApprove()}
          disabled={busy || draft.status !== 'pending'}
          aria-label="Approve"
        >
          <CheckCircle size={12} /> Approve
        </button>
        <button
          className="action-btn edit"
          onClick={handleEdit}
          disabled={busy}
          aria-label="Edit"
        >
          <Edit2 size={12} /> Edit
        </button>
        <button
          className="action-btn dismiss"
          onClick={handleDismiss}
          disabled={busy}
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
