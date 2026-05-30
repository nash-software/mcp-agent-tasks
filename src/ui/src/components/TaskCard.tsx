/**
 * TaskCard — consolidated 40px row component.
 *
 * Replaces both the old bordered-card TaskCard and the private inline TaskCard in TodayView.
 * Used by TodayView (committed + candidate rows) and adapted for BoardView.
 *
 * Props:
 *   task        — the task to render
 *   mode        — 'committed' (shows … menu) | 'candidate' (shows + button)
 *   selected    — J/K selection highlight (shell owns the selection state)
 *   onClick     — row click handler (open peek)
 *   onCommit    — candidate + button handler
 *   onMenu      — committed … menu handler
 *   onMarkDone  — from … menu
 *   onOpenDetail — from … menu / button
 *   animClass   — optional animation class (e.g. "animate-fade-in") for commit animation
 */
import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Task } from '../types'
import { StatusDot, AreaDot, AreaChip, PrefixBadge } from './atoms'
import { fmtEst } from '../lib/format'

// 2px left priority bar colours
const PRIORITY_BAR: Record<string, string> = {
  critical: 'bg-status-red',
  high:     'bg-status-amber',
  medium:   'bg-surface-3',
  low:      '',  // no bar for low
}

// Priority text tag — only for critical + high
const PRIORITY_TAG: Record<string, string> = {
  critical: 'text-status-red',
  high:     'text-status-amber',
}

export interface TaskCardProps {
  task: Task
  mode?: 'committed' | 'candidate'
  selected?: boolean
  onClick?: () => void
  onCommit?: (task: Task) => void
  onMenu?: (task: Task, e: React.MouseEvent) => void
  onMarkDone?: (task: Task) => void
  onOpenDetail?: (task: Task) => void
  animClass?: string
}

export function TaskCard({
  task,
  mode = 'committed',
  selected = false,
  onClick,
  onCommit,
  onMenu,
  onMarkDone,
  onOpenDetail,
  animClass,
}: TaskCardProps): React.JSX.Element {
  const [hoverArea, setHoverArea] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // Ref to the trigger button — used to position the portalled menu
  const menuBtnRef = useRef<HTMLButtonElement>(null)

  const priorityBar = PRIORITY_BAR[task.priority] ?? ''
  const priorityTag = PRIORITY_TAG[task.priority]
  const estStr = fmtEst(task.estimate_hours)
  const isDone = task.status === 'done'

  const bgClass = selected
    ? 'bg-surface-2 ring-1 ring-inset ring-accent/30'
    : 'hover:bg-surface-1'

  const handleMenuClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (onMenu) {
      onMenu(task, e)
    } else {
      setMenuOpen(m => !m)
    }
  }

  // Outside-click + Escape dismiss — clean up listeners on unmount/close
  useEffect(() => {
    if (!menuOpen) return

    const handleDocClick = (e: MouseEvent): void => {
      // Close when clicking outside the trigger button and outside the menu
      if (menuBtnRef.current && menuBtnRef.current.contains(e.target as Node)) return
      setMenuOpen(false)
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('pointerdown', handleDocClick)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handleDocClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  // Compute portalled menu position from the trigger button's bounding rect
  const menuRect = menuBtnRef.current?.getBoundingClientRect()
  const menuStyle: React.CSSProperties = menuRect
    ? {
        position: 'fixed',
        top: menuRect.bottom + 4,
        right: window.innerWidth - menuRect.right,
        zIndex: 9999,
      }
    : { position: 'fixed', top: 0, right: 0, zIndex: 9999 }

  return (
    <div className={`group relative flex items-center gap-2 rounded transition-colors cursor-pointer ${bgClass} ${animClass ?? ''} ${isDone ? 'opacity-60' : ''}`}
      style={{
        height: 'var(--row-h, 40px)',
        minHeight: 'var(--row-h, 40px)',
        paddingLeft: 'var(--row-px, 12px)',
        paddingRight: 'var(--row-px, 12px)',
        fontSize: 'var(--font-row, 14px)',
      }}
      onClick={onClick}
      data-task-id={task.id}
    >
      {/* 2px priority bar — left edge */}
      {priorityBar && (
        <div className={`absolute left-0 top-0 bottom-0 w-0.5 rounded-l ${priorityBar}`} />
      )}

      {/* Status dot */}
      <StatusDot status={task.status} />

      {/* Title — font-size from density var; max-width keeps meta cluster adjacent */}
      <span
        className="min-w-0 text-ink truncate"
        style={{ maxWidth: '52ch', flex: '0 1 52ch' }}
        title={task.title}
      >
        {task.title}
      </span>

      {/* Right meta cluster */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Priority tag — only critical/high */}
        {priorityTag && (
          <span className={`text-xs font-medium ${priorityTag}`}>
            {task.priority}
          </span>
        )}

        {/* Estimate */}
        {estStr && (
          <span className="text-xs text-ink-muted font-mono tabular-nums">
            {estStr}
          </span>
        )}

        {/* Area — dot normally, chip on hover */}
        {task.area && (
          <span
            className="inline-flex items-center"
            onMouseEnter={() => setHoverArea(true)}
            onMouseLeave={() => setHoverArea(false)}
          >
            {hoverArea
              ? <AreaChip area={task.area} />
              : <AreaDot area={task.area} title={task.area} />
            }
          </span>
        )}

        {/* Prefix badge */}
        {task.project && <PrefixBadge project={task.project} />}

        {/* Action: + (candidate) or … menu (committed) */}
        {mode === 'candidate' ? (
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors text-base leading-none"
            title="Commit to today (T)"
            onClick={(e) => { e.stopPropagation(); onCommit?.(task) }}
          >
            +
          </button>
        ) : (
          <>
            <button
              ref={menuBtnRef}
              className="w-6 h-6 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
              title="Actions"
              onClick={handleMenuClick}
              style={{ opacity: menuOpen ? 1 : undefined }}
            >
              <span className="text-xs leading-none">•••</span>
            </button>
            {/* Portalled menu — renders in document.body so it escapes overflow:hidden ancestors */}
            {menuOpen && !onMenu && typeof document !== 'undefined' && createPortal(
              <div
                style={menuStyle}
                className="w-44 bg-surface-1 border border-surface-3 rounded-card shadow-lg py-1"
                onMouseDown={e => e.stopPropagation()}
              >
                <MenuButton
                  label="Mark done"
                  onClick={() => { setMenuOpen(false); onMarkDone?.(task) }}
                />
                <MenuButton
                  label="Open detail"
                  onClick={() => { setMenuOpen(false); onOpenDetail?.(task) }}
                />
                {/* P2 stubs — present but disabled */}
                <MenuButton label="Sign off to Hermes" disabled />
                <MenuButton label="Dispatch to ACR" disabled />
              </div>,
              document.body
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MenuButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
        disabled
          ? 'text-ink-faint cursor-not-allowed'
          : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
      }`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )
}
