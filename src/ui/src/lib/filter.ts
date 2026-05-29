/**
 * Life OS — global filter (P2-01).
 *
 * Pure, framework-light filter model + matcher. No React import — these functions are
 * unit-testable in isolation. Ported verbatim from `design_handoff_life_os/reference/filters.jsx`
 * (lines 4–16), retyped with `Filter` / `Area` and an explicit `null` guard on the derived area.
 *
 * The prototype read a global `window.projById`; the real app injects a `prefix -> area` map at
 * App level (reduced from the loaded `['tasks']` cache, where `area` is denormalised onto every
 * task) via `setAreaMap`, keeping these helpers free of React/query state.
 */
import type { TaskArea } from '../types'

/** Spec alias — life-areas. Matches epic §4 `Area`. */
export type Area = TaskArea

export interface Filter {
  /** Project prefixes, e.g. ['COND', 'HRLD']. OR within the dimension. */
  projects: string[]
  /** Life-areas, e.g. ['client']. OR within the dimension. */
  areas: Area[]
}

export const EMPTY_FILTER: Filter = { projects: [], areas: [] }

// ── Area map (injected at App level) ───────────────────────────────────────

let areaMap: Record<string, Area> = {}

/**
 * Set the prefix→area lookup used by `areaOfProject` for records that don't carry their own area.
 * App reduces the `['tasks']` cache (`task.project → task.area`) and calls this on change.
 */
export function setAreaMap(map: Record<string, Area>): void {
  areaMap = map
}

/**
 * Resolve a project prefix to its life-area, or `null` when unknown (no task seen yet for that
 * prefix). Mirrors the prototype's `p ? p.area : null` contract — never throws.
 */
export function areaOfProject(prefix: string): Area | null {
  return areaMap[prefix] ?? null
}

/**
 * Derive a project prefix from a task / commit id. Activity rows expose an id but no `project`.
 * Verbatim from prototype line 5: `"COND-88"` → `"COND"`; a bare id with no dash → the whole id.
 */
export function projectOfId(id: string): string {
  return String(id).split('-')[0]
}

// ── Matcher ────────────────────────────────────────────────────────────────

/**
 * AND across dimensions, OR within each. Empty dimension = no constraint.
 * Records without an `area` field omit the arg; the area is then derived via `areaOfProject`.
 * An area that cannot be derived (`null`) fails any active area filter (explicit guard).
 */
export function matchFilter(filter: Filter, project: string, area?: Area): boolean {
  if (filter.projects.length && !filter.projects.includes(project)) return false
  if (filter.areas.length) {
    const a = area ?? areaOfProject(project)
    if (a == null || !filter.areas.includes(a)) return false
  }
  return true
}

/** True when at least one dimension is constrained. */
export function filterActive(filter: Filter): boolean {
  return filter.projects.length > 0 || filter.areas.length > 0
}
