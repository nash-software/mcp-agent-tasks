/**
 * Pure engine for the TaskPanel status-action footer (MCPAT-061, Bundle B).
 *
 * One source of truth for "what status moves does this task offer, and what do we call them":
 *   - primaryTarget    — the single obvious forward step (the bold primary button)
 *   - secondaryTargets — the rest of the valid moves (the "Move to…" menu)
 *   - transitionLabel  — intent label for an edge (from-aware: Resume vs Start, Reopen vs Send to todo)
 *   - requiresReason   — does picking this edge need a reason prompt (block)
 *
 * Edges come from the shared client map (transitions.ts), which mirrors the server. The server is the
 * ultimate authority — a 409 rolls the optimistic change back regardless of what this engine says.
 */
import type { TaskStatus } from '../types'
import { validTargets } from './transitions'

/** The natural forward step for each status. Only honoured if actually a valid edge. */
const PRIMARY_BY_STATUS: Partial<Record<TaskStatus, TaskStatus>> = {
  todo: 'in_progress',
  in_progress: 'done',
  blocked: 'in_progress',
  draft: 'approved',
  approved: 'in_progress',
  closed: 'todo',
  done: 'closed',
}

/** The one obvious forward step for `status`, or null when there's no valid forward edge. */
export function primaryTarget(status: TaskStatus): TaskStatus | null {
  const candidate = PRIMARY_BY_STATUS[status]
  if (candidate && validTargets(status).includes(candidate)) return candidate
  // Fallback: first valid edge (keeps a primary button for statuses not in the map above).
  return validTargets(status)[0] ?? null
}

/** Valid targets minus the primary — these populate the "Move to…" menu. */
export function secondaryTargets(status: TaskStatus): TaskStatus[] {
  const primary = primaryTarget(status)
  return validTargets(status).filter((t) => t !== primary)
}

/** Intent label for an edge. from-aware where the same target means different things. */
export function transitionLabel(from: TaskStatus, to: TaskStatus): string {
  switch (to) {
    case 'in_progress':
      if (from === 'closed' || from === 'blocked') return 'Resume'
      if (from === 'done') return 'Reopen'
      return 'Start'
    case 'done':
      return 'Mark done'
    case 'closed':
      return 'Complete'
    case 'blocked':
      return 'Block'
    case 'todo':
      return from === 'closed' ? 'Reopen' : 'Send to todo'
    case 'approved':
      return 'Promote'
    case 'draft':
      return 'Back to draft'
    case 'archived':
      return 'Archive'
    default:
      return to
  }
}

/** Edges that must collect a reason before firing (Block). */
export function requiresReason(to: TaskStatus): boolean {
  return to === 'blocked'
}

/** Tailwind tone for a target's button (matches the existing status-* palette). */
export function targetTone(to: TaskStatus): 'green' | 'amber' | 'blue' | 'neutral' {
  if (to === 'done' || to === 'closed') return 'green'
  if (to === 'blocked') return 'amber'
  if (to === 'in_progress' || to === 'todo' || to === 'approved') return 'blue'
  return 'neutral'
}
