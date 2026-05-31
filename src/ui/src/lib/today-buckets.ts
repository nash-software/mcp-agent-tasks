import type { Task } from '../types'

/**
 * Whether a scheduled task belongs in the "Committed Today" bucket.
 *
 * The server returns every task with `scheduled_for === today` (incl. drafts) for the committed list,
 * and a separate all-drafts query feeds "Needs your call". A draft scheduled for today therefore
 * appears in both buckets, so selecting its (single, unique) id highlights two rows. Keeping the
 * buckets mutually exclusive fixes that: the hero (in_progress) and drafts are excluded from
 * "Committed Today" — the hero renders on its own, drafts render only under "Needs your call" (P5-09).
 */
export function isCommittedBucket(task: Task): boolean {
  return task.status !== 'in_progress' && task.status !== 'draft'
}
