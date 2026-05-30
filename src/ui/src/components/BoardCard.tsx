/**
 * BoardCard — multi-line kanban card for BoardView.
 *
 * Design: bg-surface-1 + 1px surface-3 border + rounded-card.
 * Padding from density var(--card-pad).
 * Header: PrefixBadge left + priority tag right (critical/high only).
 * Title: line-clamp-3 (never truncated to a few chars).
 * Footer: StatusDot · AreaDot · estimate · "today" badge · agent badge.
 * Click → onOpenPanel (existing detail panel pattern).
 *
 * Drag behaviour:
 * - `useDraggable` is used when BoardView passes `isDragging` / drag props.
 * - When `draggableProps` is provided the card acts as a drag handle.
 * - Activation constraint (distance 8px) separates drag from click so the
 *   existing click-to-open-panel path is preserved.
 */
import React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Bot, GripVertical } from 'lucide-react'
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
  /** When true the card renders as a DragOverlay ghost (no pointer events, slightly transparent) */
  isOverlay?: boolean
}

export function BoardCard({ task, onOpenPanel, isOverlay = false }: BoardCardProps): React.JSX.Element {
  const estStr    = fmtEst(task.estimate_hours)
  const todayStr  = localToday()
  const isToday   = task.scheduled_for === todayStr
  const hasAgent  = task.agent_status != null
  const priTag    = PRIORITY_TAG_CLASS[task.priority]
  const priLabel  = PRIORITY_LABEL[task.priority]

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: isOverlay,
  })

  const handleClick = (e: React.MouseEvent): void => {
    // Only open the panel if this was a genuine click (no drag movement).
    // dnd-kit's PointerSensor activation constraint (distance 8px) ensures
    // a drag has started only after 8px movement, so click events reach here
    // only when the user didn't drag.
    if (isDragging) return
    e.stopPropagation()
    onOpenPanel({ mode: 'detail', taskId: task.id })
  }

  return (
    <div
      ref={setNodeRef}
      className={[
        'bg-surface-1 border border-surface-3 rounded-card',
        'hover:bg-surface-2 transition-colors',
        'select-none',
        isOverlay
          ? 'opacity-80 cursor-grabbing shadow-lg'
          : isDragging
            ? 'opacity-40 cursor-grab'
            : 'cursor-pointer',
      ].join(' ')}
      style={{ padding: 'var(--card-pad, 12px)' }}
      onClick={handleClick}
      data-task-id={task.id}
      aria-label={`Task: ${task.title}. Status: ${task.status}. Press Space to pick up and drag.`}
      {...attributes}
    >
      {/* Card header: drag handle + PrefixBadge left, priority tag right */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          {/* Drag handle — only visible on hover / focus */}
          <span
            {...listeners}
            className="text-ink-muted/40 hover:text-ink-muted cursor-grab active:cursor-grabbing shrink-0
                       transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            aria-label="Drag to move"
            tabIndex={-1}
          >
            <GripVertical size={14} />
          </span>
          <PrefixBadge project={task.project} />
        </div>
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
