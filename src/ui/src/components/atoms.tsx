/**
 * Atomic UI components for task rows.
 * All keyed on canonical types.ts enums + tokens.ts color maps.
 */
import React from 'react'
import type { TaskStatus, TaskArea } from '../types'
import { STATUS_DOT, AREA_DOT } from '../lib/tokens'

// ── Area color hex map (for inline styles when we need actual hex) ────────
const AREA_HEX: Record<TaskArea, string> = {
  client:    '#F59E0B',
  personal:  '#22C55E',
  outsource: '#8B5CF6',
  internal:  '#6B7280',
}

const AREA_LABEL: Record<TaskArea, string> = {
  client:    'Client',
  personal:  'Personal',
  outsource: 'Outsource',
  internal:  'Internal',
}

// ── StatusDot ────────────────────────────────────────────────────────────
interface StatusDotProps {
  status: TaskStatus
}

export function StatusDot({ status }: StatusDotProps): React.JSX.Element {
  const colorClass = STATUS_DOT[status] ?? 'bg-ink-faint'
  const isRunning = status === 'in_progress'
  return (
    <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: 9, height: 9 }}>
      {isRunning && (
        <span
          className="absolute inset-0 rounded-full animate-pulse"
          style={{ background: '#3B82F6', opacity: 0.3, transform: 'scale(1.8)' }}
        />
      )}
      <span className={`rounded-full ${colorClass}`} style={{ width: 8, height: 8 }} />
    </span>
  )
}

// ── AreaDot ──────────────────────────────────────────────────────────────
interface AreaDotProps {
  area: TaskArea
  title?: string
}

export function AreaDot({ area, title }: AreaDotProps): React.JSX.Element {
  const _colorClass = AREA_DOT[area]
  return (
    <span
      className="rounded-full shrink-0"
      title={title ?? AREA_LABEL[area]}
      style={{ width: 7, height: 7, background: AREA_HEX[area], display: 'inline-block' }}
    />
  )
}

// ── AreaChip ─────────────────────────────────────────────────────────────
interface AreaChipProps {
  area: TaskArea
}

export function AreaChip({ area }: AreaChipProps): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-badge bg-surface-2 text-ink-2 text-xs font-medium shrink-0">
      <span
        className="rounded-full"
        style={{ width: 6, height: 6, background: AREA_HEX[area], display: 'inline-block' }}
      />
      {AREA_LABEL[area]}
    </span>
  )
}

// ── PrefixBadge ──────────────────────────────────────────────────────────
interface PrefixBadgeProps {
  project?: string
}

export function PrefixBadge({ project }: PrefixBadgeProps): React.JSX.Element | null {
  if (!project) return null
  return (
    <span className="px-1.5 py-0.5 rounded-badge bg-surface-2 text-ink-2 text-xs font-mono shrink-0">
      {project}
    </span>
  )
}
