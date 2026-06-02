/**
 * Life OS — global filter (P2-01, extended by MCPAT-069).
 *
 * Pure, framework-light filter model + matcher. No React import — these functions are
 * unit-testable in isolation. Ported verbatim from `design_handoff_life_os/reference/filters.jsx`
 * (lines 4–16), retyped with `Filter` / `Area` and an explicit `null` guard on the derived area.
 *
 * The prototype read a global `window.projById`; the real app passes a `prefix -> area` map
 * explicitly to `matchFilter` and `areaOfProject`, keeping these helpers free of ambient state.
 * App.tsx builds the map synchronously via useMemo (available on first render) and threads it
 * into every matchFilter call site across the 5 views.
 *
 * MCPAT-069: extended with types, statuses, priorities, milestones, attention predicate,
 * and date-preset dimensions. The matcher signature changed from (filter, project, area?, areaMap)
 * to (filter, task: TaskLike, areaMap, now) so all new dimensions can be evaluated.
 */
import type { TaskArea, TaskType, TaskStatus, TaskPriority } from '../types'

/** Spec alias — life-areas. Matches epic §4 `Area`. */
export type Area = TaskArea

/**
 * MCPAT-069: Task staleness threshold for the "needs attention" predicate.
 * A task whose last_activity (or updated, or created) is older than STALE_DAYS relative to the
 * injected `now` is considered stale and matches the attention predicate.
 *
 * Value: 7 days (product decision — distinct from artifact color thresholds in ArtifactsView.tsx
 * and the backend claim-TTL staleness in sqlite-index.ts).
 */
export const STALE_DAYS = 7

export interface Filter {
  /** Project prefixes, e.g. ['COND', 'HRLD']. OR within the dimension. */
  projects: string[]
  /** Life-areas, e.g. ['client']. OR within the dimension. */
  areas: Area[]
  // ── MCPAT-069 Phase B ──────────────────────────────────────────────────────
  /** Task types. OR within. Empty = no constraint. */
  types: TaskType[]
  /** Task statuses. OR within. Empty = no constraint. */
  statuses: TaskStatus[]
  /** Task priorities. OR within. Empty = no constraint. */
  priorities: TaskPriority[]
  /** Milestone IDs. OR within. Empty = no constraint. */
  milestones: string[]
  /**
   * Needs-attention predicate: true = only show tasks that are blocked, flagged-draft,
   * or stale (last_activity older than STALE_DAYS relative to injected `now`).
   * false = no constraint.
   */
  attention: boolean
  // ── MCPAT-069 Phase D ──────────────────────────────────────────────────────
  /** Scheduled-for preset. null = no constraint. */
  scheduled: 'today' | 'week' | 'overdue' | 'none' | null
  /** Created-within preset. null = no constraint. */
  createdWithin: '24h' | '7d' | '30d' | null
  /** Updated-within preset. null = no constraint. */
  updatedWithin: '24h' | '7d' | '30d' | null
}

export const EMPTY_FILTER: Filter = {
  projects: [],
  areas: [],
  types: [],
  statuses: [],
  priorities: [],
  milestones: [],
  attention: false,
  scheduled: null,
  createdWithin: null,
  updatedWithin: null,
}

/**
 * Narrow subset of Task fields that matchFilter reads.
 * Non-task surfaces (artifacts, activity rows) can pass a partial object with only `project` set;
 * fields absent from the partial simply don't match task-only dimensions (blocked/draft/dates).
 * This is intentional: under an active type/status/priority/date dimension, a non-task record
 * is excluded — consistent with the P2-01 `area == null` guard.
 */
export interface TaskLike {
  project?: string
  area?: Area
  type?: TaskType
  status?: TaskStatus
  priority?: TaskPriority
  milestone?: string | null
  triage_note?: string
  block_reason?: string
  last_activity?: string
  updated?: string
  created?: string
  scheduled_for?: string | null
}

/**
 * Resolve a project prefix to its life-area, or `null` when unknown (no task seen yet for that
 * prefix). Mirrors the prototype's `p ? p.area : null` contract — never throws.
 * @param prefix  Project prefix to look up.
 * @param areaMap Explicit prefix→area map (built synchronously in App via useMemo).
 */
export function areaOfProject(prefix: string, areaMap: Record<string, Area>): Area | null {
  return areaMap[prefix] ?? null
}

/**
 * Derive a project prefix from a task / commit id. Activity rows expose an id but no `project`.
 * Verbatim from prototype line 5: `"COND-88"` → `"COND"`; a bare id with no dash → the whole id.
 */
export function projectOfId(id: string): string {
  return String(id).split('-')[0]
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Get the local YYYY-MM-DD string for the day containing `now` (epoch ms). */
function localDateStr(now: number): string {
  const d = new Date(now)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

/** Get the local YYYY-MM-DD string for the day that is `offsetDays` days after `now`. */
function localDateOffset(now: number, offsetDays: number): string {
  // Add offsetDays in ms to now, then extract local date
  return localDateStr(now + offsetDays * 24 * 60 * 60 * 1000)
}

// ── Matcher ────────────────────────────────────────────────────────────────

/**
 * AND across dimensions, OR within each. Empty dimension = no constraint.
 *
 * MCPAT-069: signature changed from (filter, project, area?, areaMap) to
 * (filter, task: TaskLike, areaMap, now) to support new dimensions. Task surfaces
 * (Today, Board) pass a full task. NON-task surfaces (roadmap milestones, activity
 * rows, artifacts) carry no type/status/priority/date fields and MUST use
 * `matchProjectArea` instead — running the full matcher on them would blank the
 * whole surface whenever a task-level dimension is active.
 *
 * @param filter  Active filter state.
 * @param task    Task-like object with at least `project`. May be a partial for non-task surfaces.
 * @param areaMap Explicit prefix→area map for area derivation. Pass `{}` when no derivation needed.
 * @param now     Injected clock (epoch ms) for date-preset and attention staleness evaluation.
 *                Defaults to `Date.now()` — override in tests for deterministic assertions.
 */
/**
 * Project + area only — for NON-TASK surfaces (roadmap milestones, activity rows, artifacts) that
 * carry no type/status/priority/date fields. Using the full `matchFilter` on them would exclude the
 * entire surface whenever a task-level dimension is active (MCPAT-069 regression). Mirrors the P2-01
 * project/area logic exactly.
 */
export function matchProjectArea(
  filter: Filter,
  project: string,
  area: Area | undefined,
  areaMap: Record<string, Area> = {},
): boolean {
  if (filter.projects.length && !filter.projects.includes(project)) return false
  if (filter.areas.length) {
    const a = area ?? areaOfProject(project, areaMap)
    if (a == null || !filter.areas.includes(a)) return false
  }
  return true
}

export function matchFilter(
  filter: Filter,
  task: TaskLike,
  areaMap: Record<string, Area> = {},
  now: number = Date.now(),
): boolean {
  const project = task.project ?? ''

  // ── P2-01: project + area ─────────────────────────────────────────────────
  if (filter.projects.length && !filter.projects.includes(project)) return false
  if (filter.areas.length) {
    const a = task.area ?? areaOfProject(project, areaMap)
    if (a == null || !filter.areas.includes(a)) return false
  }

  // ── Phase B: types / statuses / priorities / milestones ──────────────────
  if (filter.types.length) {
    if (task.type == null || !filter.types.includes(task.type)) return false
  }
  if (filter.statuses.length) {
    if (task.status == null || !filter.statuses.includes(task.status)) return false
  }
  if (filter.priorities.length) {
    if (task.priority == null || !filter.priorities.includes(task.priority)) return false
  }
  if (filter.milestones.length) {
    if (task.milestone == null || !filter.milestones.includes(task.milestone)) return false
  }

  // ── Phase B: attention predicate ─────────────────────────────────────────
  if (filter.attention) {
    const isBlocked = task.status === 'blocked'
    const isFlaggedDraft = task.status === 'draft' && (
      (task.triage_note != null && task.triage_note !== '') ||
      (task.block_reason != null && task.block_reason !== '')
    )
    // Stale: last_activity (fallback updated, fallback created) older than STALE_DAYS
    const activityStr = task.last_activity ?? task.updated ?? task.created
    const isStale = activityStr != null
      ? (now - new Date(activityStr).getTime()) > STALE_DAYS * 24 * 60 * 60 * 1000
      : false
    if (!isBlocked && !isFlaggedDraft && !isStale) return false
  }

  // ── Phase D: date presets ─────────────────────────────────────────────────
  if (filter.scheduled != null) {
    const sf = task.scheduled_for  // YYYY-MM-DD or null/undefined
    const today = localDateStr(now)
    const weekEnd = localDateOffset(now, 7) // today + 7 days
    switch (filter.scheduled) {
      case 'today':
        if (sf !== today) return false
        break
      case 'week':
        // today <= sf <= today+7 (inclusive both ends)
        if (sf == null || sf < today || sf > weekEnd) return false
        break
      case 'overdue':
        if (sf == null || sf >= today) return false
        break
      case 'none':
        if (sf != null) return false
        break
    }
  }

  if (filter.createdWithin != null) {
    const created = task.created
    if (created == null) return false
    const age = now - new Date(created).getTime()
    const limit = windowToMs(filter.createdWithin)
    if (age > limit) return false
  }

  if (filter.updatedWithin != null) {
    const updated = task.updated
    if (updated == null) return false
    const age = now - new Date(updated).getTime()
    const limit = windowToMs(filter.updatedWithin)
    if (age > limit) return false
  }

  return true
}

function windowToMs(w: '24h' | '7d' | '30d'): number {
  switch (w) {
    case '24h': return 24 * 60 * 60 * 1000
    case '7d':  return 7  * 24 * 60 * 60 * 1000
    case '30d': return 30 * 24 * 60 * 60 * 1000
  }
}

/** True when at least one dimension is constrained. */
export function filterActive(filter: Filter): boolean {
  return (
    filter.projects.length > 0 ||
    filter.areas.length > 0 ||
    filter.types.length > 0 ||
    filter.statuses.length > 0 ||
    filter.priorities.length > 0 ||
    filter.milestones.length > 0 ||
    filter.attention ||
    filter.scheduled != null ||
    filter.createdWithin != null ||
    filter.updatedWithin != null
  )
}

/**
 * Count active filter dimensions for the badge on the Filter button.
 * Each array counts as 1 per item; attention/scheduled/createdWithin/updatedWithin count as 1 each.
 */
export function activeFilterCount(filter: Filter): number {
  return (
    filter.projects.length +
    filter.areas.length +
    filter.types.length +
    filter.statuses.length +
    filter.priorities.length +
    filter.milestones.length +
    (filter.attention ? 1 : 0) +
    (filter.scheduled != null ? 1 : 0) +
    (filter.createdWithin != null ? 1 : 0) +
    (filter.updatedWithin != null ? 1 : 0)
  )
}
