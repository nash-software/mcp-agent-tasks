/**
 * HeroTask — the in-progress hero card at the top of TodayView.
 *
 * AC #1: Never truncates the title (wraps). Title 19px/600.
 * AC #2: Live elapsed timer ticks every second.
 * AC #3: Dashed empty state when no task is in progress.
 *
 * Start instant: derived from the latest transition to 'in_progress'.
 * If no start instant is resolvable, the timer is omitted (not NaN).
 */
import React, { useState, useEffect } from 'react'
import { Clock } from 'lucide-react'
import type { Task } from '../types'
import { AreaChip, PrefixBadge } from './atoms'
import { fmtEst, fmtElapsed } from '../lib/format'

interface HeroTaskProps {
  task: Task | null
  onDone: (task: Task) => void
  onPause: (task: Task) => void
  onBlock: (task: Task) => void
  onOpenDetail: (task: Task) => void
}

/** Derive the in-progress start instant from the task's transition history. */
function resolveStartInstant(task: Task): number | null {
  if (!task.transitions || task.transitions.length === 0) return null
  // Find the most recent transition TO in_progress
  const ipTransitions = task.transitions.filter(t => t.to === 'in_progress')
  if (ipTransitions.length === 0) return null
  // 'at' is ISO-8601 string
  const latest = ipTransitions[ipTransitions.length - 1]
  const ts = new Date(latest.at).getTime()
  return isNaN(ts) ? null : ts
}

/** Priority badge colours */
const PRIORITY_TAG_COLOR: Record<string, string> = {
  critical: 'text-status-red',
  high:     'text-status-amber',
  medium:   'text-ink-2',
  low:      'text-ink-muted',
}

export function HeroTask({
  task,
  onDone,
  onPause,
  onBlock,
  onOpenDetail,
}: HeroTaskProps): React.JSX.Element {
  const startInstant = task ? resolveStartInstant(task) : null
  const [elapsed, setElapsed] = useState<number>(() =>
    startInstant ? Date.now() - startInstant : 0
  )

  // Tick every second. Keyed on task.id and startInstant.
  useEffect(() => {
    if (!task || !startInstant) return
    setElapsed(Date.now() - startInstant)
    const id = setInterval(() => {
      setElapsed(Date.now() - startInstant)
    }, 1000)
    return () => clearInterval(id)
  }, [task?.id, startInstant]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Empty state ──────────────────────────────────────────────────────
  if (!task) {
    return (
      <div
        className="flex items-center justify-center rounded-card border border-dashed border-surface-3 text-ink-muted text-sm"
        style={{ minHeight: 96, padding: '16px 20px' }}
      >
        Nothing in progress — pick one from today&apos;s list, or press{' '}
        <kbd className="mx-1 px-1.5 py-0.5 rounded text-xs font-mono bg-surface-2 border border-surface-3 text-ink-2">J</kbd>{' '}
        then{' '}
        <kbd className="mx-1 px-1.5 py-0.5 rounded text-xs font-mono bg-surface-2 border border-surface-3 text-ink-2">Enter</kbd>
        .
      </div>
    )
  }

  const estStr = fmtEst(task.estimate_hours)
  const priorityColor = PRIORITY_TAG_COLOR[task.priority] ?? 'text-ink-2'

  // ── Hero card ────────────────────────────────────────────────────────
  return (
    <div
      className="rounded-card bg-surface-1 border-l-2 border-status-blue"
      style={{ padding: '14px 16px' }}
    >
      {/* Top row: eyebrow + timer */}
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-status-blue">
          {/* Pulsing dot */}
          <span className="relative inline-flex" style={{ width: 7, height: 7 }}>
            <span
              className="absolute inset-0 rounded-full bg-status-blue animate-pulse"
              style={{ opacity: 0.5, transform: 'scale(1.8)' }}
            />
            <span className="rounded-full bg-status-blue" style={{ width: 7, height: 7 }} />
          </span>
          In progress
        </span>

        {/* Live timer — only shown when we have a start instant */}
        {startInstant && (
          <span className="flex items-center gap-1 text-xs text-ink-muted font-mono tabular-nums">
            <Clock size={12} style={{ verticalAlign: '-1px' }} />
            {fmtElapsed(elapsed)}
          </span>
        )}
      </div>

      {/* Title — 19px/600, NEVER truncated */}
      <div
        className="font-semibold text-ink cursor-pointer hover:text-ink/80 transition-colors mb-2"
        style={{ fontSize: 19, lineHeight: '1.35' }}
        onClick={() => onOpenDetail(task)}
      >
        {task.title}
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <PrefixBadge project={task.project} />
        {task.area && <AreaChip area={task.area} />}
        <span className={`text-xs font-medium ${priorityColor}`}>
          {task.priority}
        </span>
        {estStr && (
          <span className="text-xs text-ink-muted">
            est {estStr}
          </span>
        )}
        {task.git?.branch && (
          <span className="flex items-center gap-1 text-xs text-ink-muted font-mono">
            <span style={{ fontSize: 11 }}>⎇</span>
            {task.git.branch}
          </span>
        )}
      </div>

      {/* Why — left-bordered block */}
      {task.why && (
        <div
          className="border-l-2 border-surface-3 pl-3 mb-3 text-sm text-ink-2 leading-relaxed"
        >
          {task.why}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-input text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-colors"
          onClick={() => onDone(task)}
        >
          Mark done
        </button>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-input text-sm font-medium bg-surface-2 hover:bg-surface-3 text-ink-2 transition-colors"
          onClick={() => onPause(task)}
        >
          Pause
        </button>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-input text-sm font-medium bg-surface-2 hover:bg-surface-3 text-status-red transition-colors"
          onClick={() => onBlock(task)}
        >
          Block
        </button>
        <button
          className="flex items-center gap-1 px-3 py-1.5 rounded-input text-sm font-medium text-ink-muted hover:text-ink transition-colors ml-auto"
          onClick={() => onOpenDetail(task)}
        >
          Open detail
          <span className="text-xs ml-0.5">→</span>
        </button>
      </div>
    </div>
  )
}
