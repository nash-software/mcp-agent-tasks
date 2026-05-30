/**
 * BoardCard — multi-line kanban card for BoardView.
 *
 * Design: bg-surface-1 + 1px surface-3 border + rounded-card.
 * Padding from density var(--card-pad).
 * Header: PrefixBadge left + priority tag right (critical/high only).
 * Title: line-clamp-3 (never truncated to a few chars).
 * Footer: StatusDot · AreaDot · estimate · "today" badge · agent badge.
 * Click → onOpenPanel (existing detail panel pattern).
 */
import React from 'react'
import { Bot } from 'lucide-react'
import type { Task, PanelState } from '../types'
import { StatusDot, AreaDot, PrefixBadge } from './atoms'
import { fmtEst } from '../lib/format'
import { localToday } from '../lib/format'

// Priority tag — only critical / high, matches TaskCard convention
const PRIORITY_TAG_CLASS: Partial<Record<string, string>> = {
  critical: 'text-status-red',
  high:     'text-status-amber',
}

const PRIORITY_LABEL: Partial<Record<string, string>> = {
  critical: 'Critical',
  high:     'High',
}

interface BoardCardProps {
  task: Task
  onOpenPanel: (panel: PanelState) => void
}

export function BoardCard({ task, onOpenPanel }: BoardCardProps): React.JSX.Element {
  const estStr    = fmtEst(task.estimate_hours)
  const todayStr  = localToday()
  const isToday   = task.scheduled_for === todayStr
  const hasAgent  = task.agent_status != null
  const priTag    = PRIORITY_TAG_CLASS[task.priority]
  const priLabel  = PRIORITY_LABEL[task.priority]

  const handleClick = (): void => {
    onOpenPanel({ mode: 'detail', taskId: task.id })
  }

  return (
    <div
      className="bg-surface-1 border border-surface-3 rounded-card cursor-pointer
                 hover:bg-surface-2 transition-colors"
      style={{ padding: 'var(--card-pad, 12px)' }}
      onClick={handleClick}
      data-task-id={task.id}
    >
      {/* Card header: PrefixBadge left, priority tag right */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <PrefixBadge project={task.project} />
        {priTag && priLabel && (
          <span className={`text-xs font-medium shrink-0 ${priTag}`}>
            {priLabel}
          </span>
        )}
      </div>

      {/* Title — wraps up to 3 lines, never single-line truncated */}
      <p
        className="text-sm text-ink font-medium leading-snug mb-2"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
        title={task.title}
      >
        {task.title}
      </p>

      {/* Footer: status dot + area dot + estimate + badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatusDot status={task.status} />

        {task.area && <AreaDot area={task.area} />}

        {estStr && (
          <span className="text-xs text-ink-muted font-mono tabular-nums">
            {estStr}
          </span>
        )}

        {isToday && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-badge
                           bg-accent/15 text-accent leading-none">
            today
          </span>
        )}

        {hasAgent && (
          <Bot
            size={12}
            className="text-ink-muted shrink-0"
            aria-label="Agent task"
          />
        )}
      </div>
    </div>
  )
}
