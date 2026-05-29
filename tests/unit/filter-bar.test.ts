/**
 * Unit tests for FilterBar.tsx (P2-01 global filter bar) and related filter logic.
 *
 * Pattern: source-file analysis (fs.readFileSync) consistent with other ui-*.test.ts
 * files in this project — no jsdom/DOM runner is available. Assertions verify that
 * required structures, props, and behaviours are present in the source.
 *
 * Also includes an integration-style assertion for the localStorage persistence
 * round-trip defined in App.tsx (readStoredFilter + the filter useEffect).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const uiSrc = path.join(root, 'src', 'ui', 'src')

function readUiFile(relPath: string): string {
  return fs.readFileSync(path.join(uiSrc, relPath), 'utf-8')
}

// ── FilterBar.tsx — structure ─────────────────────────────────────────────

describe('FilterBar.tsx — structure and source analysis', () => {
  const src = readUiFile('components/FilterBar.tsx')

  // Project rows
  it('renders project rows (projects.map)', () => {
    expect(src).toContain('projects.map')
  })

  it('renders project prefix labels', () => {
    expect(src).toContain('fpr-prefix')
  })

  it('renders area chips for all 4 life areas', () => {
    expect(src).toContain("'client'")
    expect(src).toContain("'personal'")
    expect(src).toContain("'outsource'")
    expect(src).toContain("'internal'")
    // ALL_AREAS drives the chip list
    expect(src).toContain('ALL_AREAS')
  })

  it('exports FilterBarProject interface with prefix + name + area fields', () => {
    expect(src).toContain('FilterBarProject')
    expect(src).toContain('prefix:')
    expect(src).toContain('name:')
    expect(src).toContain('area:')
  })

  // Active-filter chips are removable (X icon on each active filter chip)
  it('active project filter chips have an X (removable) via filter.projects.map', () => {
    expect(src).toContain('filter.projects.map')
    // The X removal icon (lucide) on the chip
    expect(src).toContain('<X size=')
  })

  it('active area filter chips have an X (removable) via filter.areas.map', () => {
    expect(src).toContain('filter.areas.map')
  })

  // Clear button — only shown when filter is active
  it('Clear button is present and gated by `active`', () => {
    // The Clear button is conditionally rendered
    expect(src).toContain('filter-clear')
    expect(src).toContain('Clear')
    // It is inside a conditional block keyed on `active`
    expect(src).toContain('{active && (')
  })

  // filterActive drives the `active` variable
  it('uses filterActive from lib/filter', () => {
    expect(src).toContain('filterActive')
  })

  // Props shape
  it('accepts filter, projects, favorites, projectCounts, onToggleProject, onToggleArea, onClear', () => {
    expect(src).toContain('filter:')
    expect(src).toContain('projects:')
    expect(src).toContain('favorites:')
    expect(src).toContain('projectCounts:')
    expect(src).toContain('onToggleProject:')
    expect(src).toContain('onToggleArea:')
    expect(src).toContain('onClear:')
  })

  // Popover closes on outside-click (useEffect + mousedown listener)
  it('closes popover on outside-click (mousedown listener in useEffect)', () => {
    expect(src).toContain('mousedown')
    expect(src).toContain('anchorRef')
  })

  // Favourite quick-chips (P2-02 forward-compat)
  it('renders favourite quick-chips from the favorites prop', () => {
    expect(src).toContain('fav-chip')
    expect(src).toContain('favProjects')
  })
})

// ── App.tsx — localStorage persistence round-trip ────────────────────────

describe('App.tsx — filter localStorage persistence (round-trip)', () => {
  const src = readUiFile('App.tsx')

  it('persists the filter to localStorage on change', () => {
    expect(src).toContain("'lifeos-filter'")
    expect(src).toContain('JSON.stringify(filter)')
  })

  it('readStoredFilter reads and parses lifeos-filter on mount', () => {
    expect(src).toContain('readStoredFilter')
    expect(src).toContain("localStorage.getItem('lifeos-filter')")
  })

  it('readStoredFilter validates that projects and areas are arrays (corruption guard)', () => {
    // The guard ensures malformed JSON silently falls back to EMPTY_FILTER
    expect(src).toContain('Array.isArray')
    expect(src).toContain('EMPTY_FILTER')
  })

  it('readStoredFilter whitelists valid area values (client, personal, outsource, internal)', () => {
    expect(src).toContain("'client'")
    expect(src).toContain("'personal'")
    expect(src).toContain("'outsource'")
    expect(src).toContain("'internal'")
  })

  it('readStoredFilter returns EMPTY_FILTER on JSON parse error (catch block)', () => {
    expect(src).toContain('} catch {')
    // returns EMPTY_FILTER in the catch
    expect(src).toContain('return EMPTY_FILTER')
  })

  it('filter state is initialised from readStoredFilter (useState(readStoredFilter))', () => {
    expect(src).toContain('useState<Filter>(readStoredFilter)')
  })
})

// ── App.tsx — areaMap is built synchronously (no module-global state) ─────

describe('App.tsx — areaMap built via useMemo (no module-global setAreaMap)', () => {
  const src = readUiFile('App.tsx')

  it('builds areaMap synchronously in useMemo from allTasks', () => {
    expect(src).toContain('areaMap')
    expect(src).toContain('useMemo')
    // areaMap is derived from allTasks in a memo — not from a side-effectful import
    expect(src).toContain('for (const t of allTasks)')
  })

  it('does NOT import or call setAreaMap (module-global removed)', () => {
    expect(src).not.toContain('setAreaMap')
  })

  it('threads areaMap into TodayView', () => {
    expect(src).toContain('areaMap={areaMap}')
  })

  it('threads areaMap into BoardView', () => {
    // All 5 views receive areaMap
    const areaMapPropCount = (src.match(/areaMap=\{areaMap\}/g) ?? []).length
    expect(areaMapPropCount).toBeGreaterThanOrEqual(4)
  })
})

// ── filter.ts — no module-global mutable state ───────────────────────────

describe('lib/filter.ts — pure API (no module-global areaMap)', () => {
  const src = readUiFile('lib/filter.ts')

  it('does NOT export setAreaMap', () => {
    expect(src).not.toContain('setAreaMap')
  })

  it('does NOT declare a module-level let areaMap', () => {
    expect(src).not.toContain('let areaMap')
  })

  it('matchFilter accepts an areaMap parameter', () => {
    expect(src).toContain('areaMap: Record<string, Area>')
  })

  it('areaOfProject accepts an areaMap parameter', () => {
    expect(src).toContain('areaOfProject(prefix: string, areaMap: Record<string, Area>)')
  })
})

// ── App.tsx — command palette label ──────────────────────────────────────

describe('App.tsx — command palette Filter group labels (spec §4)', () => {
  const src = readUiFile('App.tsx')

  it('palette filter label is always "Filter by ${p.prefix}" (no Unfilter)', () => {
    // Must contain the correct label
    expect(src).toContain('`Filter by ${p.prefix}`')
    // Must NOT contain the incorrect Unfilter variant
    expect(src).not.toContain('Unfilter')
  })

  it('"Clear all filters" command is only added when filterActive is true', () => {
    // The clear command is inside a conditional block
    expect(src).toContain('if (filterActive(filter))')
    expect(src).toContain("'Clear all filters'")
  })
})
