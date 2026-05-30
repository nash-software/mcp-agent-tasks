import type { TaskStatus, TaskPriority, TaskArea } from '../types'

/**
 * Canonical enum → Tailwind class maps for status indicators, priority labels, and area dots.
 * Record<Enum, string> enforces exhaustiveness at compile time — adding a new union member
 * to the type without updating this file will produce a TypeScript error.
 */

export const STATUS_DOT: Record<TaskStatus, string> = {
  todo:        'bg-ink-muted',      // #71717A — prototype 'queued' maps to 'todo'
  in_progress: 'bg-status-blue',   // #3B82F6 — animate-pulse ring added by consumer component
  done:        'bg-status-green',  // #22C55E
  blocked:     'bg-status-red',    // #EF4444
  archived:    'bg-ink-faint',     // #52525B — maps prototype 'cancelled' visually
  draft:       'bg-ink-faint',     // #52525B — unpublished/staging state
  approved:    'bg-status-green',  // #22C55E — ready/approved
  closed:      'bg-ink-faint',     // #52525B — terminal sprint-closure state (P4-02)
}

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  critical: 'text-status-red',
  high:     'text-status-amber',
  medium:   'text-status-blue',
  low:      'text-ink-muted',
}

export const AREA_DOT: Record<TaskArea, string> = {
  client:    'bg-area-client',     // #F59E0B
  personal:  'bg-area-personal',  // #22C55E
  outsource: 'bg-area-outsource', // #8B5CF6
  internal:  'bg-area-internal',  // #6B7280
}
