/**
 * Client-side transition validity map — mirrors src/types/transitions.ts.
 * Used by BoardView to provide immediate visual feedback before hitting the server.
 * The server is the ultimate source of truth; a 409 from the transition endpoint
 * triggers rollback regardless of what this map says.
 */
import type { TaskStatus } from '../types'

export const BOARD_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const satisfies readonly TaskStatus[]

/** Human label for every status (board columns + the rest, for a11y/announcements). */
export const COLUMN_LABEL: Record<TaskStatus, string> = {
  todo:        'Queued',
  in_progress: 'In progress',
  blocked:     'Blocked',
  done:        'Done',
  closed:      'Completed',
  draft:       'Draft',
  approved:    'Approved',
  archived:    'Archived',
}

/** Valid transitions — mirrors server src/types/transitions.ts */
const VALID_TRANSITIONS: Readonly<Partial<Record<TaskStatus, readonly TaskStatus[]>>> = {
  todo:        ['in_progress', 'blocked'],
  in_progress: ['done', 'blocked', 'todo', 'approved'],
  blocked:     ['in_progress', 'todo'],
  done:        ['in_progress', 'closed'],
  archived:    [],
  draft:       ['approved', 'blocked'],
  approved:    ['in_progress', 'draft', 'blocked'],
  closed:      ['todo', 'in_progress'], // reopenable (P5-05) — mirror of server transitions.ts
}

/**
 * Returns true when the server's state machine would accept this transition.
 * Dropping from status A to the same status A is a no-op (not an error).
 */
export function isValidBoardTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false // same column — no-op
  const allowed = VALID_TRANSITIONS[from] ?? []
  return (allowed as readonly string[]).includes(to)
}

/** All statuses this status may legally transition to (empty when terminal). */
export function validTargets(from: TaskStatus): readonly TaskStatus[] {
  return VALID_TRANSITIONS[from] ?? []
}
