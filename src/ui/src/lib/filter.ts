/**
 * Life OS — global filter (P2-01).
 *
 * Pure, framework-light filter model + matcher. No React import — these functions are
 * unit-testable in isolation. Ported verbatim from `design_handoff_life_os/reference/filters.jsx`
 * (lines 4–16), retyped with `Filter` / `Area` and an explicit `null` guard on the derived area.
 *
 * The prototype read a global `window.projById`; the real app passes a `prefix -> area` map
 * explicitly to `matchFilter` and `areaOfProject`, keeping these helpers free of ambient state.
 * App.tsx builds the map synchronously via useMemo (available on first render) and threads it
 * into every matchFilter call site across the 5 views.
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

// ── Matcher ────────────────────────────────────────────────────────────────

/**
 * AND across dimensions, OR within each. Empty dimension = no constraint.
 * Records without an `area` field omit the arg; the area is then derived via `areaOfProject`.
 * An area that cannot be derived (`null`) fails any active area filter (explicit guard).
 * @param filter  Active filter state.
 * @param project Project prefix of the item being tested.
 * @param area    Optional explicit area (wins over the derived value when provided).
 * @param areaMap Explicit prefix→area map for derivation. Pass `{}` when no derivation is needed.
 */
export function matchFilter(
  filter: Filter,
  project: string,
  area?: Area,
  areaMap: Record<string, Area> = {},
): boolean {
  if (filter.projects.length && !filter.projects.includes(project)) return false
  if (filter.areas.length) {
    const a = area ?? areaOfProject(project, areaMap)
    if (a == null || !filter.areas.includes(a)) return false
  }
  return true
}

/** True when at least one dimension is constrained. */
export function filterActive(filter: Filter): boolean {
  return filter.projects.length > 0 || filter.areas.length > 0
}
