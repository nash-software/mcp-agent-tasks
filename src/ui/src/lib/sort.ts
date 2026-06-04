/**
 * Life OS — task sort utility (MCPAT-069 Phase C).
 *
 * Pure, non-mutating, stable sort for Task arrays. No React import — unit-testable in isolation.
 *
 * Keys:
 *   priority   — uses PRI_RANK (critical=0, high=1, medium=2, low=3). asc = critical-first.
 *   created    — ISO string, lexicographic == chronological for ISO-8601.
 *   updated    — ISO string.
 *   scheduled  — ISO date string (scheduled_for field). Null/missing sorts LAST in both directions.
 *   title      — case-insensitive localeCompare.
 *   complexity — numeric. Null/missing sorts LAST.
 *   estimate   — estimate_hours, numeric. Null/missing sorts LAST.
 *
 * Tie-breakers: equal primary values fall back to task.id ascending (stable, deterministic).
 * Null-last: for scheduled/complexity/estimate, nulls always sort after non-null values, regardless
 * of direction.
 *
 * The `SortKey` switch is exhaustive — adding a new SortKey value will fail type-check until handled.
 *
 * MCPAT-070 Phase C additions:
 *   TodaySortKey — separate type for Today-view sort (4 keys with fixed directions).
 *   AREA_ORDER   — canonical area sort order (exported so TodayView imports from here, not locally).
 *   taskCmp      — comparator factory for Today sort (fixed directions, priority tiebreaker).
 *   TODAY_SORT_KEY_LABEL — human-readable labels for TodaySortKey.
 *   TODAY_SORT_KEYS      — ordered list of TodaySortKey values.
 */
import type { Task, TaskArea } from '../types'
import { PRI_RANK } from './format'

export type SortKey =
  | 'priority'
  | 'created'
  | 'updated'
  | 'scheduled'
  | 'title'
  | 'complexity'
  | 'estimate'

export type SortDir = 'asc' | 'desc'

/**
 * Sort `tasks` by `key` in `dir` direction, stable and non-mutating.
 * @param tasks Input array (not mutated).
 * @param key   Sort key.
 * @param dir   'asc' = ascending (low→high, a→z, early→late, critical→low for priority).
 *              'desc' = descending (high→low, z→a, late→early, low→critical for priority).
 */
export function sortTasks(tasks: Task[], key: SortKey, dir: SortDir): Task[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...tasks].sort((a, b) => {
    const primary = primaryCompare(a, b, key, sign)
    if (primary !== 0) return primary
    // Tie-break: id ascending (always, regardless of dir)
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function primaryCompare(a: Task, b: Task, key: SortKey, sign: number): number {
  switch (key) {
    case 'priority': {
      const ra = PRI_RANK[a.priority]
      const rb = PRI_RANK[b.priority]
      // asc sign=1: lower rank (higher priority) first — critical(0) < high(1) → -1*1 = -1 (correct)
      return (ra - rb) * sign
    }

    case 'created': {
      const ca = a.created ?? ''
      const cb = b.created ?? ''
      const cmp = ca < cb ? -1 : ca > cb ? 1 : 0
      return cmp * sign
    }

    case 'updated': {
      const ua = a.updated ?? ''
      const ub = b.updated ?? ''
      const cmp = ua < ub ? -1 : ua > ub ? 1 : 0
      return cmp * sign
    }

    case 'scheduled': {
      // Null/undefined → sorts LAST regardless of direction
      const sa = a.scheduled_for ?? null
      const sb = b.scheduled_for ?? null
      if (sa === null && sb === null) return 0
      if (sa === null) return 1  // a is null → a goes after b (last) regardless of sign
      if (sb === null) return -1 // b is null → b goes after a (last)
      const cmp = sa < sb ? -1 : sa > sb ? 1 : 0
      return cmp * sign
    }

    case 'title': {
      const cmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      return cmp * sign
    }

    case 'complexity': {
      const ca = a.complexity ?? null
      const cb = b.complexity ?? null
      if (ca === null && cb === null) return 0
      if (ca === null) return 1
      if (cb === null) return -1
      return (ca - cb) * sign
    }

    case 'estimate': {
      const ea = a.estimate_hours ?? null
      const eb = b.estimate_hours ?? null
      if (ea === null && eb === null) return 0
      if (ea === null) return 1
      if (eb === null) return -1
      return (ea - eb) * sign
    }

    default: {
      // Exhaustiveness guard — if SortKey gains a new member and this branch is reachable,
      // TypeScript will error here: `key` would have type `never`.
      const _exhaustive: never = key
      void _exhaustive
      return 0
    }
  }
}

/** Human-readable label for a sort key. */
export const SORT_KEY_LABEL: Record<SortKey, string> = {
  priority:   'Priority',
  created:    'Created',
  updated:    'Updated',
  scheduled:  'Scheduled',
  title:      'Title',
  complexity: 'Complexity',
  estimate:   'Estimate',
}

// ── MCPAT-070 Phase C — Today-specific sort ──────────────────────────────────

/**
 * Canonical area sort order for Today view. Exported so TodayView.tsx and sort.ts share one
 * source of truth (removes the local constant that previously lived only in TodayView).
 */
export const AREA_ORDER: readonly TaskArea[] = ['client', 'personal', 'internal', 'outsource']

/**
 * Sort keys available in the Today-view toolbar. Uses fixed directions (no dir toggle):
 *   priority  — ascending by PRI_RANK (critical first)
 *   area      — ascending by AREA_ORDER index
 *   estimate  — DESCENDING by estimate_hours (biggest effort first)
 *   project   — A→Z by ID prefix (chars before first `-`)
 *
 * NOTE: This is a SEPARATE type from SortKey — do NOT add these to SortKey, as that would break
 * the exhaustiveness guard in sortTasks().
 */
export type TodaySortKey = 'priority' | 'area' | 'estimate' | 'project'

/** Human-readable labels for TodaySortKey values (Today toolbar). */
export const TODAY_SORT_KEY_LABEL: Record<TodaySortKey, string> = {
  priority: 'Priority',
  area:     'Area',
  estimate: 'Estimate',
  project:  'Project',
}

/** Ordered list of Today sort keys (used to populate the SortControl menu). */
export const TODAY_SORT_KEYS: readonly TodaySortKey[] = ['priority', 'area', 'estimate', 'project']

/**
 * Returns a pure comparator for Today-view sorting. All directions are FIXED (no toggle):
 *   priority  — asc by PRI_RANK; tiebreak by id asc
 *   area      — asc by AREA_ORDER index (null/undefined area → index 999 = last); tiebreak by priority then id
 *   estimate  — DESC by estimate_hours (null → last); tiebreak by priority then id
 *   project   — A→Z by ID prefix (chars before first `-`); tiebreak by priority then id
 *
 * @param sortBy  The TodaySortKey to sort by.
 * @returns       A comparator `(a, b) => number` suitable for Array.prototype.sort().
 */
export function taskCmp(sortBy: TodaySortKey): (a: Task, b: Task) => number {
  return (a: Task, b: Task): number => {
    switch (sortBy) {
      case 'priority': {
        const diff = PRI_RANK[a.priority] - PRI_RANK[b.priority]
        if (diff !== 0) return diff
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      }

      case 'area': {
        const ia = a.area != null ? AREA_ORDER.indexOf(a.area) : 999
        const ib = b.area != null ? AREA_ORDER.indexOf(b.area) : 999
        const diff = (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
        if (diff !== 0) return diff
        // Tiebreak: priority then id
        const priDiff = PRI_RANK[a.priority] - PRI_RANK[b.priority]
        if (priDiff !== 0) return priDiff
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      }

      case 'estimate': {
        const ea = a.estimate_hours ?? null
        const eb = b.estimate_hours ?? null
        // Null → last (regardless of direction)
        if (ea === null && eb === null) {
          const priDiff = PRI_RANK[a.priority] - PRI_RANK[b.priority]
          if (priDiff !== 0) return priDiff
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        }
        if (ea === null) return 1
        if (eb === null) return -1
        // Descending: larger estimate first
        const diff = eb - ea
        if (diff !== 0) return diff
        // Tiebreak: priority then id
        const priDiff = PRI_RANK[a.priority] - PRI_RANK[b.priority]
        if (priDiff !== 0) return priDiff
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      }

      case 'project': {
        const prefixA = a.id.split('-')[0] ?? a.id
        const prefixB = b.id.split('-')[0] ?? b.id
        const diff = prefixA < prefixB ? -1 : prefixA > prefixB ? 1 : 0
        if (diff !== 0) return diff
        // Tiebreak: priority then id
        const priDiff = PRI_RANK[a.priority] - PRI_RANK[b.priority]
        if (priDiff !== 0) return priDiff
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      }
    }
  }
}

