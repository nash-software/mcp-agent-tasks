/**
 * TaskPanel — peek & detail slide-in panel for task inspection and editing.
 *
 * Positioning: absolute inside .main — NOT fixed, NOT a modal.
 * The list remains visible and interactive beside a peek.
 *
 * Animation: transform-only (translateX), 210ms spring ease.
 * CRITICAL: never animate opacity to a hidden state. Animating opacity from 0
 * on offscreen panels freezes CSS animations at frame 0 and blanks the content
 * (epic §3 anti-pattern §9). Hidden state is reached by translating offscreen only.
 *
 * Width: 380px (peek) | 440px (detail), animates with the same spring ease.
 *
 * P4-01: Fields are now editable (title, why, priority, estimate_hours).
 *        Start button added for todo/blocked tasks → in_progress.
 *        Done button re-pointed to /transition (was /promote).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Task, PanelState, TaskStatus, TaskPriority } from '../types'
import { STATUS_DOT, PRIORITY_COLOR, AREA_DOT } from '../lib/tokens'
import { relativeTime } from '../lib/time'
import { scheduleTask, transitionTask, updateTask } from '../api'

// ─── helpers ─────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <h3 className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  )
}

function FileRow({ label, path }: { label: string; path: string }): React.JSX.Element {
  const filename = path.split(/[/\\]/).pop() ?? path
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-ink-faint w-16 flex-shrink-0">{label}</span>
      <span className="font-mono text-ink-2 bg-surface-2 px-1.5 py-0.5 rounded truncate" title={path}>
        {filename}
      </span>
    </div>
  )
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo:        'todo',
  in_progress: 'in progress',
  done:        'done',
  blocked:     'blocked',
  archived:    'archived',
  draft:       'draft',
  approved:    'approved',
}

const PRIORITIES: TaskPriority[] = ['critical', 'high', 'medium', 'low']

// ─── props ────────────────────────────────────────────────────────────────────

interface Props {
  panel:     PanelState | null
  task:      Task | undefined
  onClose:   () => void
  onPromote: () => void          // peek → detail (no-op if already detail)
}

// ─── component ───────────────────────────────────────────────────────────────

export function TaskPanel({ panel, task, onClose, onPromote }: Props): React.JSX.Element | null {
  const scrollRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const isOpen   = panel !== null
  const mode     = panel?.mode ?? 'peek'
  const taskId   = panel?.taskId ?? ''
  const isPeek   = mode === 'peek'
  const panelW   = isPeek ? 380 : 440

  // Inline error message for surfacing mutation rejections
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Edit state — local draft values committed on blur
  const [editTitle, setEditTitle]             = useState<string | null>(null)
  const [editWhy, setEditWhy]                 = useState<string | null>(null)
  const [editPriority, setEditPriority]       = useState<TaskPriority | null>(null)
  const [editEstimate, setEditEstimate]       = useState<string | null>(null)

  // Reset edit state when the task changes
  useEffect(() => {
    setEditTitle(null)
    setEditWhy(null)
    setEditPriority(null)
    setEditEstimate(null)
    setErrorMsg(null)
  }, [taskId])

  // Reset scroll when the taskId changes (not on mode promotion — keep position)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [taskId])

  // Failure path: if the panel is open but the task is gone, close gracefully.
  // Use an effect so we don't fire synchronously during render.
  useEffect(() => {
    if (isOpen && task === undefined) {
      onClose()
    }
  }, [isOpen, task, onClose])

  if (!isOpen) return null

  // ── helpers ─────────────────────────────────────────────────────────────

  function invalidateCaches(): Promise<unknown[]> {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['today'] }),
    ])
  }

  function surfaceError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err)
    setErrorMsg(msg)
    // Auto-clear after 5 seconds
    setTimeout(() => setErrorMsg(null), 5000)
  }

  // ── PATCH helpers ────────────────────────────────────────────────────────

  const commitField = useCallback(async (fields: { title?: string; why?: string; priority?: TaskPriority; estimate_hours?: number }): Promise<void> => {
    if (!task) return
    try {
      await updateTask(task.id, fields)
      await invalidateCaches()
      setErrorMsg(null)
    } catch (err) {
      surfaceError(err)
    }
  }, [task])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── action handlers ─────────────────────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10)
  const isScheduledToday = task?.scheduled_for === today
  const commitLabel = isScheduledToday ? 'Remove today' : 'Commit today'

  // "Done" — P4-01: now calls /transition (was /promote)
  async function handleDone(): Promise<void> {
    if (!task) return
    try {
      await transitionTask(task.id, 'done')
      await invalidateCaches()
      setErrorMsg(null)
      onClose()
    } catch (err) {
      surfaceError(err)
    }
  }

  // "Start" — P4-01: new affordance for todo/blocked tasks
  async function handleStart(): Promise<void> {
    if (!task) return
    try {
      await transitionTask(task.id, 'in_progress')
      await invalidateCaches()
      setErrorMsg(null)
    } catch (err) {
      surfaceError(err)
    }
  }

  async function handleScheduleToggle(): Promise<void> {
    if (!task) return
    try {
      await scheduleTask(task.id, isScheduledToday ? null : today)
      await invalidateCaches()
    } catch (err) {
      surfaceError(err)
    }
  }

  // Title blur commit
  async function handleTitleBlur(): Promise<void> {
    if (editTitle === null || !task) return
    const trimmed = editTitle.trim()
    if (trimmed === task.title || trimmed.length === 0) {
      setEditTitle(null)
      return
    }
    setEditTitle(null)
    await commitField({ title: trimmed })
  }

  // Why blur commit
  async function handleWhyBlur(): Promise<void> {
    if (editWhy === null || !task) return
    const trimmed = editWhy.trim()
    if (trimmed === (task.why ?? '')) {
      setEditWhy(null)
      return
    }
    setEditWhy(null)
    await commitField({ why: trimmed })
  }

  // Priority select commit
  async function handlePriorityChange(p: TaskPriority): Promise<void> {
    if (!task) return
    setEditPriority(null)
    if (p === task.priority) return
    await commitField({ priority: p })
  }

  // Estimate blur commit
  async function handleEstimateBlur(): Promise<void> {
    if (editEstimate === null || !task) return
    const raw = editEstimate.trim()
    setEditEstimate(null)
    if (raw === '') {
      // Clear estimate
      await commitField({ estimate_hours: 0 })
      return
    }
    const num = parseFloat(raw)
    if (isNaN(num) || num < 0) {
      setErrorMsg('estimate_hours must be a positive number')
      setTimeout(() => setErrorMsg(null), 5000)
      return
    }
    if (num === (task.estimate_hours ?? 0)) return
    await commitField({ estimate_hours: num })
  }

  // ── render ──────────────────────────────────────────────────────────────

  const statusDotClass = task ? (STATUS_DOT[task.status] ?? 'bg-ink-muted') : 'bg-ink-muted'
  const areaDotClass   = (task?.area ? AREA_DOT[task.area] : undefined) ?? 'bg-ink-muted'

  // Show "Start" for todo/blocked tasks (per P4-01 AC)
  const canStart = task && (task.status === 'todo' || task.status === 'blocked')
  const canDone  = task && task.status !== 'done' && task.status !== 'archived'

  return (
    /*
     * Outer wrapper: absolute right edge of .main, full height.
     * Width and translateX animate on the same --ease-spring (210ms).
     * Transform-only: no opacity transition here or anywhere on this panel.
     */
    <div
      style={{
        width: panelW,
        /* Transform-only animation — see file-level comment */
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: `transform 210ms cubic-bezier(0.16,1,0.3,1), width 210ms cubic-bezier(0.16,1,0.3,1)`,
      }}
      className="absolute top-0 right-0 h-full bg-surface-1 border-l border-surface-3 shadow-[-4px_0_16px_rgba(0,0,0,0.4)] flex flex-col z-30"
      aria-label={`Task ${isPeek ? 'peek' : 'detail'} panel`}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* Status dot */}
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass}`} />
          {/* Mono task ID */}
          <span className="text-xs font-mono text-ink-muted tabular-nums flex-shrink-0">
            {task?.id ?? taskId}
          </span>
          {/* Mode label */}
          <span className="text-[10px] font-medium text-ink-faint uppercase tracking-wider flex-shrink-0">
            {isPeek ? 'Peek' : 'Detail'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-ink-muted hover:text-ink transition-colors duration-100 flex-shrink-0 text-lg leading-none"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      {/* ── Inline error banner ─────────────────────────────────────── */}
      {errorMsg && (
        <div
          role="alert"
          className="mx-4 mt-2 px-3 py-2 rounded text-xs text-status-red bg-status-red/10 border border-status-red/20 flex items-start gap-2"
        >
          <span className="flex-1 leading-relaxed">{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-status-red/70 hover:text-status-red flex-shrink-0 leading-none"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Scrollable body ─────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {task && (
          <>
            {/* Title — editable on click */}
            {editTitle !== null ? (
              <input
                autoFocus
                type="text"
                value={editTitle}
                maxLength={200}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => { void handleTitleBlur() }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') { setEditTitle(null) }
                }}
                className="w-full text-sm font-semibold text-ink leading-snug bg-surface-2 border border-surface-3 rounded px-2 py-1 outline-none focus:border-accent"
                aria-label="Edit task title"
              />
            ) : (
              <h2
                className="text-sm font-semibold text-ink leading-snug cursor-text hover:bg-surface-2 rounded px-1 -mx-1 py-0.5 transition-colors duration-100"
                title="Click to edit"
                onClick={() => setEditTitle(task.title)}
              >
                {task.title}
              </h2>
            )}

            {/* Area chip + priority (editable) + status badge + estimate (editable) */}
            <div className="flex flex-wrap items-center gap-2">
              {task.area && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-surface-2 text-ink-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${areaDotClass}`} />
                  {task.area}
                </span>
              )}

              {/* Priority — click cycles through options */}
              {editPriority !== null ? (
                <select
                  autoFocus
                  value={editPriority}
                  onChange={(e) => { void handlePriorityChange(e.target.value as TaskPriority) }}
                  onBlur={() => setEditPriority(null)}
                  className="text-xs bg-surface-2 border border-surface-3 rounded px-1 py-0.5 outline-none focus:border-accent"
                  aria-label="Select priority"
                >
                  {PRIORITIES.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              ) : (
                <button
                  onClick={() => setEditPriority(task.priority)}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-surface-2 hover:bg-surface-3 transition-colors duration-100 cursor-pointer"
                  title="Click to change priority"
                  aria-label={`Priority: ${task.priority} — click to edit`}
                >
                  <span className={`${PRIORITY_COLOR[task.priority] ?? 'text-ink-muted'} font-medium`}>
                    {task.priority}
                  </span>
                </button>
              )}

              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-surface-2 text-ink-2">
                <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`} />
                {STATUS_LABEL[task.status] ?? task.status}
              </span>

              {/* Estimate — click to edit */}
              {editEstimate !== null ? (
                <input
                  autoFocus
                  type="number"
                  min="0"
                  step="0.5"
                  value={editEstimate}
                  onChange={(e) => setEditEstimate(e.target.value)}
                  onBlur={() => { void handleEstimateBlur() }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') { setEditEstimate(null) }
                  }}
                  className="w-16 text-xs font-mono text-ink-faint tabular-nums bg-surface-2 border border-surface-3 rounded px-1.5 py-0.5 outline-none focus:border-accent"
                  aria-label="Edit estimate hours"
                />
              ) : (
                <button
                  onClick={() => setEditEstimate(String(task.estimate_hours ?? ''))}
                  className="text-xs font-mono text-ink-faint tabular-nums hover:bg-surface-2 rounded px-1 py-0.5 transition-colors duration-100"
                  title="Click to edit estimate"
                  aria-label={task.estimate_hours != null ? `Estimate: ${task.estimate_hours}h — click to edit` : 'Add estimate — click to edit'}
                >
                  {task.estimate_hours != null ? `${task.estimate_hours}h` : '+ est'}
                </button>
              )}
            </div>

            {/* Blocked reason — red, only when blocked (block_reason field; falls back to why) */}
            {task.status === 'blocked' && (task.block_reason ?? task.why) && (
              <div className="text-xs text-status-red bg-status-red/10 rounded px-2 py-1.5 leading-relaxed">
                {task.block_reason ?? task.why}
              </div>
            )}

            {/* Why / description — editable; omit when blocked (block_reason shown above instead) */}
            {task.status !== 'blocked' && (
              <Section title="Why">
                {editWhy !== null ? (
                  <textarea
                    autoFocus
                    value={editWhy}
                    maxLength={1000}
                    rows={4}
                    onChange={(e) => setEditWhy(e.target.value)}
                    onBlur={() => { void handleWhyBlur() }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { setEditWhy(null) }
                    }}
                    className="w-full text-sm text-ink-2 leading-relaxed bg-surface-2 border border-surface-3 rounded px-2 py-1.5 outline-none focus:border-accent resize-none"
                    aria-label="Edit task description"
                  />
                ) : (
                  <p
                    className="text-sm text-ink-2 leading-relaxed cursor-text hover:bg-surface-2 rounded px-1 -mx-1 py-0.5 transition-colors duration-100 min-h-[1.5rem]"
                    title="Click to edit"
                    onClick={() => setEditWhy(task.why ?? '')}
                  >
                    {task.why || <span className="text-ink-faint italic">Add a description…</span>}
                  </p>
                )}
              </Section>
            )}

            {/* Linked docs */}
            {(task.spec_file || task.plan_file) && (
              <Section title="Linked docs">
                <div className="space-y-1">
                  {task.spec_file && <FileRow label="Spec" path={task.spec_file} />}
                  {task.plan_file && <FileRow label="Plan" path={task.plan_file} />}
                </div>
              </Section>
            )}

            {/* Git */}
            {task.git && (task.git.branch || task.git.pr || (task.git.commits && task.git.commits.length > 0)) && (
              <Section title="Git">
                <div className="space-y-1.5 text-xs">
                  {task.git.branch && (
                    <div className="flex items-center gap-2">
                      <span className="text-ink-faint w-12 flex-shrink-0">Branch</span>
                      <span className="font-mono text-ink-2 bg-surface-2 px-1.5 py-0.5 rounded truncate">
                        {task.git.branch}
                      </span>
                    </div>
                  )}
                  {task.git.pr && (
                    <div className="flex items-center gap-2">
                      <span className="text-ink-faint w-12 flex-shrink-0">PR</span>
                      {task.git.pr.url ? (
                        <a
                          href={task.git.pr.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:text-accent-hover underline"
                        >
                          #{task.git.pr.number}
                        </a>
                      ) : (
                        <span className="text-ink-2">#{task.git.pr.number}</span>
                      )}
                      <span className={
                        task.git.pr.state === 'merged' ? 'text-status-blue'
                        : task.git.pr.state === 'open' ? 'text-status-green'
                        : 'text-ink-muted'
                      }>
                        {task.git.pr.state}
                      </span>
                    </div>
                  )}
                  {task.git.commits && task.git.commits.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-ink-faint w-12 flex-shrink-0 pt-0.5">Commits</span>
                      <div className="space-y-0.5 min-w-0">
                        {task.git.commits.slice(0, 5).map((sha, i) => (
                          <div key={i} className="font-mono text-ink-faint truncate">{sha}</div>
                        ))}
                        {task.git.commits.length > 5 && (
                          <div className="text-ink-faint">+{task.git.commits.length - 5} more</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Tags — uses task.tags (epic §4) or falls back to task.labels */}
            {((task.tags ?? task.labels) ?? []).length > 0 && (
              <Section title="Tags">
                <div className="flex flex-wrap gap-1">
                  {(task.tags ?? task.labels ?? []).map(l => (
                    <span
                      key={l}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-surface-2 text-ink-2"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* Status history — detail mode only */}
            {!isPeek && task.transitions && task.transitions.length > 0 && (
              <Section title="Status history">
                <div className="space-y-2">
                  {[...task.transitions].reverse().slice(0, 8).map((t, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <div className="flex items-center gap-1 flex-shrink-0 mt-0.5 font-mono">
                        <span className={STATUS_DOT[t.from as TaskStatus] ? `text-ink-2` : 'text-ink-muted'}>
                          {t.from}
                        </span>
                        {/* U+2192 RIGHT ARROW (fixes the mojibake in the old TaskDetailPanel) */}
                        <span className="text-ink-faint" aria-hidden>→</span>
                        <span className={STATUS_DOT[t.to as TaskStatus] ? `text-ink-2` : 'text-ink-muted'}>
                          {t.to}
                        </span>
                      </div>
                      <div className="text-ink-faint min-w-0">
                        <span>{relativeTime(t.at)}</span>
                        {t.reason && (
                          <p className="text-ink-faint truncate" title={t.reason}>{t.reason}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-surface-3 px-4 py-3 space-y-2">
        {/* Action buttons row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Start — P4-01: shown for todo/blocked tasks */}
          {canStart && (
            <button
              onClick={() => void handleStart()}
              className="px-3 py-1.5 rounded text-xs font-medium bg-status-blue/20 text-status-blue hover:bg-status-blue/30 transition-colors duration-100"
              aria-label="Start task — transition to in progress"
            >
              Start
            </button>
          )}

          {/* Done — P4-01: now calls /transition (not /promote) */}
          {canDone && (
            <button
              onClick={() => void handleDone()}
              className="px-3 py-1.5 rounded text-xs font-medium bg-status-green/20 text-status-green hover:bg-status-green/30 transition-colors duration-100"
              aria-label="Mark task done"
            >
              Done
            </button>
          )}

          <button
            onClick={() => void handleScheduleToggle()}
            className="px-3 py-1.5 rounded text-xs font-medium bg-surface-2 text-ink-2 hover:bg-surface-3 transition-colors duration-100"
          >
            {commitLabel}
          </button>
          {/* Hermes stub — Phase 2 (P2-05) */}
          <button
            disabled
            className="px-3 py-1.5 rounded text-xs font-medium bg-surface-2 text-ink-faint opacity-50 cursor-not-allowed"
            title="Hermes — Phase 2"
          >
            Hermes
          </button>
          {/* ACR stub — Phase 2 (P2-06) */}
          <button
            disabled
            className="px-3 py-1.5 rounded text-xs font-medium bg-surface-2 text-ink-faint opacity-50 cursor-not-allowed"
            title="ACR — Phase 2"
          >
            ACR
          </button>
        </div>

        {/* Peek hint — only in peek mode */}
        {isPeek && (
          <p className="text-[10px] text-ink-faint select-none">
            <kbd className="font-mono">↵</kbd> full detail&nbsp;&nbsp;·&nbsp;&nbsp;<kbd className="font-mono">Esc</kbd> close
          </p>
        )}
      </div>
    </div>
  )
}
