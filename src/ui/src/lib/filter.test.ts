import { describe, it, expect } from 'vitest'
import {
  EMPTY_FILTER,
  STALE_DAYS,
  matchFilter,
  matchProjectArea,
  filterActive,
  activeFilterCount,
  areaOfProject,
  projectOfId,
  type Filter,
  type TaskLike,
} from './filter'

// Default area map used across most tests
const DEFAULT_AREA_MAP = { COND: 'client', HRLD: 'client', ACR: 'internal', MCPAT: 'internal' } as const

// ── P2-01 (migrated to new signature) ────────────────────────────────────────

describe('filter.ts — matchFilter (P2-01 baseline, migrated signature)', () => {
  it('EMPTY_FILTER matches everything (with or without an area arg)', () => {
    expect(matchFilter(EMPTY_FILTER, { project: 'COND' }, DEFAULT_AREA_MAP)).toBe(true)
    expect(matchFilter(EMPTY_FILTER, { project: 'ANYTHING', area: 'personal' }, DEFAULT_AREA_MAP)).toBe(true)
    expect(matchFilter(EMPTY_FILTER, { project: 'XYZ' }, {})).toBe(true)
  })

  it('OR within projects — passes if project is in any selected prefix', () => {
    const f: Filter = { ...EMPTY_FILTER, projects: ['COND', 'HRLD'] }
    expect(matchFilter(f, { project: 'COND' }, DEFAULT_AREA_MAP)).toBe(true)
    expect(matchFilter(f, { project: 'HRLD' }, DEFAULT_AREA_MAP)).toBe(true)
    expect(matchFilter(f, { project: 'ACR' }, DEFAULT_AREA_MAP)).toBe(false)
  })

  it('OR within areas — passes if record area is in any selected area', () => {
    const f: Filter = { ...EMPTY_FILTER, areas: ['client'] }
    expect(matchFilter(f, { project: 'X', area: 'client' }, {})).toBe(true)
    expect(matchFilter(f, { project: 'X', area: 'internal' }, {})).toBe(false)
  })

  it('AND across dimensions — must pass both project and area', () => {
    const f: Filter = { ...EMPTY_FILTER, projects: ['COND'], areas: ['client'] }
    expect(matchFilter(f, { project: 'COND', area: 'client' }, {})).toBe(true)
    // passes project, fails area
    expect(matchFilter(f, { project: 'COND', area: 'internal' }, {})).toBe(false)
    // fails project (HRLD not selected) even though area matches
    expect(matchFilter(f, { project: 'HRLD', area: 'client' }, {})).toBe(false)
  })

  it('area derivation — resolves area via areaMap when no area arg', () => {
    const f: Filter = { ...EMPTY_FILTER, areas: ['client'] }
    // COND -> client via the map
    expect(matchFilter(f, { project: 'COND' }, DEFAULT_AREA_MAP)).toBe(true)
    // ACR -> internal via the map → fails a client filter
    expect(matchFilter(f, { project: 'ACR' }, DEFAULT_AREA_MAP)).toBe(false)
  })

  it('explicit area arg wins over the derived value', () => {
    const f: Filter = { ...EMPTY_FILTER, areas: ['personal'] }
    // map says COND is client, but caller passes personal explicitly
    expect(matchFilter(f, { project: 'COND', area: 'personal' }, DEFAULT_AREA_MAP)).toBe(true)
    expect(matchFilter(f, { project: 'COND', area: 'client' }, DEFAULT_AREA_MAP)).toBe(false)
  })

  it('unknown prefix derives null and fails an active area filter — never throws', () => {
    expect(areaOfProject('XYZ', DEFAULT_AREA_MAP)).toBeNull()
    const f: Filter = { ...EMPTY_FILTER, areas: ['client'] }
    expect(() => matchFilter(f, { project: 'XYZ' }, DEFAULT_AREA_MAP)).not.toThrow()
    expect(matchFilter(f, { project: 'XYZ' }, DEFAULT_AREA_MAP)).toBe(false)
  })

  it('unknown prefix still passes when only a project filter is active', () => {
    const f: Filter = { ...EMPTY_FILTER, projects: ['XYZ'] }
    expect(matchFilter(f, { project: 'XYZ' }, {})).toBe(true)
    expect(matchFilter(f, { project: 'COND' }, {})).toBe(false)
  })

  it('empty area map — area filtering is inert (everything derives null)', () => {
    const f: Filter = { ...EMPTY_FILTER, areas: ['client'] }
    expect(matchFilter(f, { project: 'COND' }, {})).toBe(false)
    // project-only still works against the prefix directly
    expect(matchFilter({ ...EMPTY_FILTER, projects: ['COND'] }, { project: 'COND' }, {})).toBe(true)
  })

  it('default areaMap param is {} when omitted — area derivation falls through to null', () => {
    const f: Filter = { ...EMPTY_FILTER, areas: ['client'] }
    // No areaMap passed — defaults to {} — unknown prefix → null → fails area filter
    expect(matchFilter(f, { project: 'COND' })).toBe(false)
    // But EMPTY_FILTER still passes
    expect(matchFilter(EMPTY_FILTER, { project: 'COND' })).toBe(true)
  })
})

// ── Phase B: new filter dimensions ───────────────────────────────────────────

describe('filter.ts — Phase B: types', () => {
  it('OR within types — task.type must be in filter.types', () => {
    const f: Filter = { ...EMPTY_FILTER, types: ['bug', 'feature'] }
    expect(matchFilter(f, { project: 'X', type: 'bug' })).toBe(true)
    expect(matchFilter(f, { project: 'X', type: 'feature' })).toBe(true)
    expect(matchFilter(f, { project: 'X', type: 'chore' })).toBe(false)
  })

  it('empty types = no constraint', () => {
    const f: Filter = { ...EMPTY_FILTER, types: [] }
    expect(matchFilter(f, { project: 'X', type: 'chore' })).toBe(true)
    expect(matchFilter(f, { project: 'X' })).toBe(true)
  })

  it('null type fails non-empty types filter', () => {
    const f: Filter = { ...EMPTY_FILTER, types: ['bug'] }
    // task with no type field
    expect(matchFilter(f, { project: 'X' })).toBe(false)
  })

  it('AND across types + statuses', () => {
    const f: Filter = { ...EMPTY_FILTER, types: ['bug'], statuses: ['blocked'] }
    expect(matchFilter(f, { project: 'X', type: 'bug', status: 'blocked' })).toBe(true)
    expect(matchFilter(f, { project: 'X', type: 'bug', status: 'todo' })).toBe(false)
    expect(matchFilter(f, { project: 'X', type: 'chore', status: 'blocked' })).toBe(false)
  })
})

describe('filter.ts — Phase B: statuses', () => {
  it('OR within statuses', () => {
    const f: Filter = { ...EMPTY_FILTER, statuses: ['todo', 'in_progress'] }
    expect(matchFilter(f, { project: 'X', status: 'todo' })).toBe(true)
    expect(matchFilter(f, { project: 'X', status: 'in_progress' })).toBe(true)
    expect(matchFilter(f, { project: 'X', status: 'done' })).toBe(false)
  })

  it('null status fails non-empty statuses filter', () => {
    const f: Filter = { ...EMPTY_FILTER, statuses: ['blocked'] }
    expect(matchFilter(f, { project: 'X' })).toBe(false)
  })
})

describe('filter.ts — Phase B: priorities', () => {
  it('OR within priorities', () => {
    const f: Filter = { ...EMPTY_FILTER, priorities: ['critical', 'high'] }
    expect(matchFilter(f, { project: 'X', priority: 'critical' })).toBe(true)
    expect(matchFilter(f, { project: 'X', priority: 'high' })).toBe(true)
    expect(matchFilter(f, { project: 'X', priority: 'low' })).toBe(false)
  })
})

describe('filter.ts — Phase B: milestones', () => {
  it('OR within milestones — matched on task.milestone', () => {
    const f: Filter = { ...EMPTY_FILTER, milestones: ['v1.0', 'v2.0'] }
    expect(matchFilter(f, { project: 'X', milestone: 'v1.0' })).toBe(true)
    expect(matchFilter(f, { project: 'X', milestone: 'v2.0' })).toBe(true)
    expect(matchFilter(f, { project: 'X', milestone: 'v3.0' })).toBe(false)
    expect(matchFilter(f, { project: 'X', milestone: null })).toBe(false)
    expect(matchFilter(f, { project: 'X' })).toBe(false)
  })
})

// ── Phase B: attention predicate ─────────────────────────────────────────────

describe('filter.ts — Phase B: attention predicate', () => {
  // Fixed clock: 2026-06-02T12:00:00Z
  const NOW = new Date('2026-06-02T12:00:00Z').getTime()
  const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000

  it('attention:false imposes no constraint', () => {
    const f: Filter = { ...EMPTY_FILTER, attention: false }
    expect(matchFilter(f, { project: 'X', status: 'todo' }, {}, NOW)).toBe(true)
    expect(matchFilter(f, { project: 'X', status: 'blocked' }, {}, NOW)).toBe(true)
  })

  it('blocked task always matches attention:true', () => {
    const f: Filter = { ...EMPTY_FILTER, attention: true }
    expect(matchFilter(f, { project: 'X', status: 'blocked' }, {}, NOW)).toBe(true)
  })

  it('draft + triage_note matches attention:true', () => {
    const f: Filter = { ...EMPTY_FILTER, attention: true }
    const t: TaskLike = { project: 'X', status: 'draft', triage_note: 'flagged by triage' }
    expect(matchFilter(f, t, {}, NOW)).toBe(true)
  })

  it('draft + block_reason (no triage_note) matches attention:true', () => {
    const f: Filter = { ...EMPTY_FILTER, attention: true }
    const t: TaskLike = { project: 'X', status: 'draft', block_reason: 'waiting on info' }
    expect(matchFilter(f, t, {}, NOW)).toBe(true)
  })

  it('draft with neither triage_note nor block_reason does NOT match via flagged-draft branch', () => {
    const f: Filter = { ...EMPTY_FILTER, attention: true }
    // No staleness either — last_activity is fresh
    const freshActivity = new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago
    const t: TaskLike = { project: 'X', status: 'draft', last_activity: freshActivity }
    expect(matchFilter(f, t, {}, NOW)).toBe(false)
  })

  it('stale task (last_activity older than STALE_DAYS) matches attention:true', () => {
    const f: Filter = { ...EMPTY_FILTER, attention: true }
    // Just over STALE_DAYS old: NOW - 7 days - 1ms
    const staleActivity = new Date(NOW - STALE_MS - 1).toISOString()
    const t: TaskLike = { project: 'X', status: 'in_progress', last_activity: staleActivity }
    expect(matchFilter(f, t, {}, NOW)).toBe(true)
  })

  it('just under STALE_DAYS does NOT match staleness (boundary: exactly STALE_MS is NOT stale)', () => {
    const f: Filter = { ...EMPTY_FILTER, attention: true }
    // Exactly STALE_DAYS: NOW - exactly 7*24*60*60*1000 ms
    const atBoundary = new Date(NOW - STALE_MS).toISOString()
    const t: TaskLike = { project: 'X', status: 'in_progress', last_activity: atBoundary }
    // age = exactly STALE_MS which is NOT > STALE_MS, so not stale
    expect(matchFilter(f, t, {}, NOW)).toBe(false)
  })

  it('freshly-touched in_progress task does NOT match attention', () => {
    const f: Filter = { ...EMPTY_FILTER, attention: true }
    const freshActivity = new Date(NOW - 60 * 60 * 1000).toISOString() // 1 hour ago
    const t: TaskLike = { project: 'X', status: 'in_progress', last_activity: freshActivity }
    expect(matchFilter(f, t, {}, NOW)).toBe(false)
  })

  it('stale check uses last_activity first, then updated, then created as fallback', () => {
    const f: Filter = { ...EMPTY_FILTER, attention: true }
    const staleDate = new Date(NOW - STALE_MS - 1000).toISOString()
    const freshDate = new Date(NOW - 1000).toISOString()

    // last_activity stale → matches
    expect(matchFilter(f, { project: 'X', status: 'todo', last_activity: staleDate }, {}, NOW)).toBe(true)
    // last_activity missing, updated stale → matches
    expect(matchFilter(f, { project: 'X', status: 'todo', updated: staleDate }, {}, NOW)).toBe(true)
    // last_activity fresh, updated stale → last_activity wins → NOT stale
    expect(matchFilter(f, { project: 'X', status: 'todo', last_activity: freshDate, updated: staleDate }, {}, NOW)).toBe(false)
    // only created stale → matches
    expect(matchFilter(f, { project: 'X', status: 'todo', created: staleDate }, {}, NOW)).toBe(true)
    // all absent → not stale (isStale = false)
    expect(matchFilter(f, { project: 'X', status: 'todo' }, {}, NOW)).toBe(false)
  })
})

// ── Phase D: date presets ─────────────────────────────────────────────────────

describe('filter.ts — Phase D: scheduled preset', () => {
  // Fixed clock: 2026-06-02T15:00:00 (local day = 2026-06-02)
  // We use UTC midnight + offset to control local-day interpretation
  const NOW = new Date('2026-06-02T15:00:00Z').getTime()

  it("scheduled:'today' matches task scheduled for local today", () => {
    const f: Filter = { ...EMPTY_FILTER, scheduled: 'today' }
    // local today in UTC+0 context: 2026-06-02
    const localTodayStr = new Date(NOW).toLocaleDateString('en-CA') // YYYY-MM-DD
    expect(matchFilter(f, { project: 'X', scheduled_for: localTodayStr }, {}, NOW)).toBe(true)
    expect(matchFilter(f, { project: 'X', scheduled_for: '2026-06-03' }, {}, NOW)).toBe(false)
    expect(matchFilter(f, { project: 'X', scheduled_for: null }, {}, NOW)).toBe(false)
  })

  it("scheduled:'week' matches tasks within today+7 days inclusive", () => {
    const f: Filter = { ...EMPTY_FILTER, scheduled: 'week' }
    const localTodayStr = new Date(NOW).toLocaleDateString('en-CA')
    // today = inclusive start
    expect(matchFilter(f, { project: 'X', scheduled_for: localTodayStr }, {}, NOW)).toBe(true)
    // +7 days from now
    const plusSeven = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA')
    expect(matchFilter(f, { project: 'X', scheduled_for: plusSeven }, {}, NOW)).toBe(true)
    // day before today
    const yesterday = new Date(NOW - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA')
    expect(matchFilter(f, { project: 'X', scheduled_for: yesterday }, {}, NOW)).toBe(false)
    // day after +7
    const plusEight = new Date(NOW + 8 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA')
    expect(matchFilter(f, { project: 'X', scheduled_for: plusEight }, {}, NOW)).toBe(false)
  })

  it("scheduled:'overdue' matches tasks scheduled before today", () => {
    const f: Filter = { ...EMPTY_FILTER, scheduled: 'overdue' }
    const yesterday = new Date(NOW - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA')
    const localTodayStr = new Date(NOW).toLocaleDateString('en-CA')
    expect(matchFilter(f, { project: 'X', scheduled_for: yesterday }, {}, NOW)).toBe(true)
    // today itself is NOT overdue
    expect(matchFilter(f, { project: 'X', scheduled_for: localTodayStr }, {}, NOW)).toBe(false)
    expect(matchFilter(f, { project: 'X', scheduled_for: null }, {}, NOW)).toBe(false)
  })

  it("scheduled:'none' matches tasks with no scheduled_for", () => {
    const f: Filter = { ...EMPTY_FILTER, scheduled: 'none' }
    expect(matchFilter(f, { project: 'X', scheduled_for: null }, {}, NOW)).toBe(true)
    expect(matchFilter(f, { project: 'X' }, {}, NOW)).toBe(true) // undefined == null for this check
    expect(matchFilter(f, { project: 'X', scheduled_for: '2026-06-02' }, {}, NOW)).toBe(false)
  })

  it('null scheduled = no constraint', () => {
    const f: Filter = { ...EMPTY_FILTER, scheduled: null }
    expect(matchFilter(f, { project: 'X', scheduled_for: '2026-01-01' }, {}, NOW)).toBe(true)
    expect(matchFilter(f, { project: 'X', scheduled_for: null }, {}, NOW)).toBe(true)
  })
})

describe('filter.ts — Phase D: createdWithin preset', () => {
  const NOW = new Date('2026-06-02T12:00:00Z').getTime()

  it('24h: tasks created within the last 24 hours pass', () => {
    const f: Filter = { ...EMPTY_FILTER, createdWithin: '24h' }
    const recent = new Date(NOW - 23 * 60 * 60 * 1000).toISOString()
    const old = new Date(NOW - 25 * 60 * 60 * 1000).toISOString()
    expect(matchFilter(f, { project: 'X', created: recent }, {}, NOW)).toBe(true)
    expect(matchFilter(f, { project: 'X', created: old }, {}, NOW)).toBe(false)
  })

  it('7d: tasks created within the last 7 days pass', () => {
    const f: Filter = { ...EMPTY_FILTER, createdWithin: '7d' }
    const MS = 7 * 24 * 60 * 60 * 1000
    const recent = new Date(NOW - MS + 1000).toISOString()
    const old = new Date(NOW - MS - 1000).toISOString()
    expect(matchFilter(f, { project: 'X', created: recent }, {}, NOW)).toBe(true)
    expect(matchFilter(f, { project: 'X', created: old }, {}, NOW)).toBe(false)
  })

  it('30d: tasks created within the last 30 days pass', () => {
    const f: Filter = { ...EMPTY_FILTER, createdWithin: '30d' }
    const MS = 30 * 24 * 60 * 60 * 1000
    const recent = new Date(NOW - MS + 1000).toISOString()
    const old = new Date(NOW - MS - 1000).toISOString()
    expect(matchFilter(f, { project: 'X', created: recent }, {}, NOW)).toBe(true)
    expect(matchFilter(f, { project: 'X', created: old }, {}, NOW)).toBe(false)
  })

  it('missing created field fails when createdWithin is set', () => {
    const f: Filter = { ...EMPTY_FILTER, createdWithin: '7d' }
    expect(matchFilter(f, { project: 'X' }, {}, NOW)).toBe(false)
  })

  it('null createdWithin = no constraint', () => {
    const f: Filter = { ...EMPTY_FILTER, createdWithin: null }
    expect(matchFilter(f, { project: 'X', created: '2020-01-01T00:00:00Z' }, {}, NOW)).toBe(true)
  })
})

describe('filter.ts — Phase D: updatedWithin preset', () => {
  const NOW = new Date('2026-06-02T12:00:00Z').getTime()

  it('7d window for updatedWithin', () => {
    const f: Filter = { ...EMPTY_FILTER, updatedWithin: '7d' }
    const MS = 7 * 24 * 60 * 60 * 1000
    const recent = new Date(NOW - MS + 1000).toISOString()
    const old = new Date(NOW - MS - 1000).toISOString()
    expect(matchFilter(f, { project: 'X', updated: recent }, {}, NOW)).toBe(true)
    expect(matchFilter(f, { project: 'X', updated: old }, {}, NOW)).toBe(false)
  })

  it('missing updated field fails when updatedWithin is set', () => {
    const f: Filter = { ...EMPTY_FILTER, updatedWithin: '24h' }
    expect(matchFilter(f, { project: 'X' }, {}, NOW)).toBe(false)
  })
})

// ── Backward-compat hydration ─────────────────────────────────────────────────

describe('filter.ts — backward-compat hydration helpers', () => {
  it('EMPTY_FILTER has all new dimensions defaulted to empty/null/false', () => {
    expect(EMPTY_FILTER.types).toEqual([])
    expect(EMPTY_FILTER.statuses).toEqual([])
    expect(EMPTY_FILTER.priorities).toEqual([])
    expect(EMPTY_FILTER.milestones).toEqual([])
    expect(EMPTY_FILTER.attention).toBe(false)
    expect(EMPTY_FILTER.scheduled).toBeNull()
    expect(EMPTY_FILTER.createdWithin).toBeNull()
    expect(EMPTY_FILTER.updatedWithin).toBeNull()
  })

  it('spreading EMPTY_FILTER first produces a fully-typed Filter from old {projects,areas} shape', () => {
    // Simulate what readStoredFilter does: spread EMPTY_FILTER then overlay validated fields
    const oldShape = { projects: ['COND'], areas: ['client'] }
    const hydrated: Filter = {
      ...EMPTY_FILTER,
      projects: oldShape.projects,
      areas: oldShape.areas as typeof EMPTY_FILTER.areas,
    }
    expect(hydrated.types).toEqual([])
    expect(hydrated.statuses).toEqual([])
    expect(hydrated.priorities).toEqual([])
    expect(hydrated.milestones).toEqual([])
    expect(hydrated.attention).toBe(false)
    expect(hydrated.scheduled).toBeNull()
    expect(hydrated.createdWithin).toBeNull()
    expect(hydrated.updatedWithin).toBeNull()
    // And the persisted fields are preserved
    expect(hydrated.projects).toEqual(['COND'])
    expect(hydrated.areas).toEqual(['client'])
  })
})

// ── filterActive ──────────────────────────────────────────────────────────────

describe('filter.ts — filterActive', () => {
  it('false for EMPTY_FILTER', () => {
    expect(filterActive(EMPTY_FILTER)).toBe(false)
  })
  it('true when projects non-empty', () => {
    expect(filterActive({ ...EMPTY_FILTER, projects: ['COND'] })).toBe(true)
  })
  it('true when areas non-empty', () => {
    expect(filterActive({ ...EMPTY_FILTER, areas: ['client'] })).toBe(true)
  })
  it('true when types non-empty', () => {
    expect(filterActive({ ...EMPTY_FILTER, types: ['bug'] })).toBe(true)
  })
  it('true when statuses non-empty', () => {
    expect(filterActive({ ...EMPTY_FILTER, statuses: ['blocked'] })).toBe(true)
  })
  it('true when priorities non-empty', () => {
    expect(filterActive({ ...EMPTY_FILTER, priorities: ['critical'] })).toBe(true)
  })
  it('true when milestones non-empty', () => {
    expect(filterActive({ ...EMPTY_FILTER, milestones: ['v1.0'] })).toBe(true)
  })
  it('true when attention is true', () => {
    expect(filterActive({ ...EMPTY_FILTER, attention: true })).toBe(true)
  })
  it('true when scheduled is set', () => {
    expect(filterActive({ ...EMPTY_FILTER, scheduled: 'today' })).toBe(true)
  })
  it('true when createdWithin is set', () => {
    expect(filterActive({ ...EMPTY_FILTER, createdWithin: '7d' })).toBe(true)
  })
  it('true when updatedWithin is set', () => {
    expect(filterActive({ ...EMPTY_FILTER, updatedWithin: '30d' })).toBe(true)
  })
})

// ── activeFilterCount ─────────────────────────────────────────────────────────

describe('filter.ts — activeFilterCount', () => {
  it('0 for EMPTY_FILTER', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0)
  })
  it('counts array items individually, boolean/nullable dims as 1 each', () => {
    const f: Filter = {
      ...EMPTY_FILTER,
      projects: ['COND', 'HRLD'],
      statuses: ['blocked'],
      attention: true,
      scheduled: 'today',
    }
    expect(activeFilterCount(f)).toBe(2 + 1 + 1 + 1) // 5
  })
})

// ── areaOfProject ─────────────────────────────────────────────────────────────

describe('filter.ts — areaOfProject', () => {
  it('returns the area from the map', () => {
    expect(areaOfProject('COND', DEFAULT_AREA_MAP)).toBe('client')
    expect(areaOfProject('ACR', DEFAULT_AREA_MAP)).toBe('internal')
  })

  it('returns null for unknown prefix', () => {
    expect(areaOfProject('XYZ', DEFAULT_AREA_MAP)).toBeNull()
    expect(areaOfProject('XYZ', {})).toBeNull()
  })
})

// ── projectOfId ──────────────────────────────────────────────────────────────

describe('filter.ts — projectOfId', () => {
  it('splits PREFIX-N on the first dash', () => {
    expect(projectOfId('COND-88')).toBe('COND')
    expect(projectOfId('MCPAT-142')).toBe('MCPAT')
  })
  it('returns the whole string for a bare id with no dash', () => {
    expect(projectOfId('orphan')).toBe('orphan')
  })
})

// ── matchProjectArea (MCPAT-069 non-task-surface matcher) ─────────────────────

describe('filter.ts — matchProjectArea (non-task surfaces)', () => {
  it('applies the project dimension', () => {
    const f: Filter = { ...EMPTY_FILTER, projects: ['COND'] }
    expect(matchProjectArea(f, 'COND', undefined, DEFAULT_AREA_MAP)).toBe(true)
    expect(matchProjectArea(f, 'HRLD', undefined, DEFAULT_AREA_MAP)).toBe(false)
  })

  it('applies the area dimension (explicit + derived via areaMap)', () => {
    const f: Filter = { ...EMPTY_FILTER, areas: ['client'] }
    expect(matchProjectArea(f, 'COND', undefined, DEFAULT_AREA_MAP)).toBe(true)   // COND→client
    expect(matchProjectArea(f, 'ACR', undefined, DEFAULT_AREA_MAP)).toBe(false)   // ACR→internal
    expect(matchProjectArea(f, 'ZZ', 'client', DEFAULT_AREA_MAP)).toBe(true)      // explicit area wins
  })

  it('IGNORES task-level dimensions so non-task surfaces are never blanked (MCPAT-069 regression fix)', () => {
    // An active status/type/priority/milestone/attention/date filter must NOT exclude a milestone,
    // activity row, or artifact — those surfaces carry no such fields. This is the bug Codex caught:
    // the full matchFilter would return false here and empty the Roadmap/Activity/Artifacts views.
    const taskDimsActive: Filter = {
      ...EMPTY_FILTER,
      statuses: ['in_progress'],
      types: ['bug'],
      priorities: ['high'],
      milestones: ['m-1'],
      attention: true,
      scheduled: 'today',
    }
    expect(matchProjectArea(taskDimsActive, 'COND', undefined, DEFAULT_AREA_MAP)).toBe(true)
    // Contrast: the full matcher DOES exclude a project-only object under those dims.
    expect(matchFilter(taskDimsActive, { project: 'COND' }, DEFAULT_AREA_MAP)).toBe(false)
  })

  it('combines project + area but still ignores task dims', () => {
    const f: Filter = { ...EMPTY_FILTER, projects: ['COND'], areas: ['client'], statuses: ['done'] }
    expect(matchProjectArea(f, 'COND', undefined, DEFAULT_AREA_MAP)).toBe(true)
    expect(matchProjectArea(f, 'ACR', undefined, DEFAULT_AREA_MAP)).toBe(false) // wrong area
  })
})
