import { describe, it, expect } from 'vitest'
import {
  EMPTY_FILTER,
  matchFilter,
  filterActive,
  areaOfProject,
  projectOfId,
  type Filter,
} from './filter'

// Default area map used across most tests
const DEFAULT_AREA_MAP = { COND: 'client', HRLD: 'client', ACR: 'internal', MCPAT: 'internal' } as const

describe('filter.ts — matchFilter', () => {
  it('EMPTY_FILTER matches everything (with or without an area arg)', () => {
    expect(matchFilter(EMPTY_FILTER, 'COND', undefined, DEFAULT_AREA_MAP)).toBe(true)
    expect(matchFilter(EMPTY_FILTER, 'ANYTHING', 'personal', DEFAULT_AREA_MAP)).toBe(true)
    expect(matchFilter(EMPTY_FILTER, 'XYZ', undefined, {})).toBe(true)
  })

  it('OR within projects — passes if project is in any selected prefix', () => {
    const f: Filter = { projects: ['COND', 'HRLD'], areas: [] }
    expect(matchFilter(f, 'COND', undefined, DEFAULT_AREA_MAP)).toBe(true)
    expect(matchFilter(f, 'HRLD', undefined, DEFAULT_AREA_MAP)).toBe(true)
    expect(matchFilter(f, 'ACR', undefined, DEFAULT_AREA_MAP)).toBe(false)
  })

  it('OR within areas — passes if record area is in any selected area', () => {
    const f: Filter = { projects: [], areas: ['client'] }
    expect(matchFilter(f, 'X', 'client', {})).toBe(true)
    expect(matchFilter(f, 'X', 'internal', {})).toBe(false)
  })

  it('AND across dimensions — must pass both project and area', () => {
    const f: Filter = { projects: ['COND'], areas: ['client'] }
    expect(matchFilter(f, 'COND', 'client', {})).toBe(true)
    // passes project, fails area
    expect(matchFilter(f, 'COND', 'internal', {})).toBe(false)
    // fails project (HRLD not selected) even though area matches
    expect(matchFilter(f, 'HRLD', 'client', {})).toBe(false)
  })

  it('area derivation — resolves area via areaMap when no area arg', () => {
    const f: Filter = { projects: [], areas: ['client'] }
    // COND -> client via the map
    expect(matchFilter(f, 'COND', undefined, DEFAULT_AREA_MAP)).toBe(true)
    // ACR -> internal via the map → fails a client filter
    expect(matchFilter(f, 'ACR', undefined, DEFAULT_AREA_MAP)).toBe(false)
  })

  it('explicit area arg wins over the derived value', () => {
    const f: Filter = { projects: [], areas: ['personal'] }
    // map says COND is client, but caller passes personal explicitly
    expect(matchFilter(f, 'COND', 'personal', DEFAULT_AREA_MAP)).toBe(true)
    expect(matchFilter(f, 'COND', 'client', DEFAULT_AREA_MAP)).toBe(false)
  })

  it('unknown prefix derives null and fails an active area filter — never throws', () => {
    expect(areaOfProject('XYZ', DEFAULT_AREA_MAP)).toBeNull()
    const f: Filter = { projects: [], areas: ['client'] }
    expect(() => matchFilter(f, 'XYZ', undefined, DEFAULT_AREA_MAP)).not.toThrow()
    expect(matchFilter(f, 'XYZ', undefined, DEFAULT_AREA_MAP)).toBe(false)
  })

  it('unknown prefix still passes when only a project filter is active', () => {
    const f: Filter = { projects: ['XYZ'], areas: [] }
    expect(matchFilter(f, 'XYZ', undefined, {})).toBe(true)
    expect(matchFilter(f, 'COND', undefined, {})).toBe(false)
  })

  it('empty area map — area filtering is inert (everything derives null)', () => {
    const f: Filter = { projects: [], areas: ['client'] }
    expect(matchFilter(f, 'COND', undefined, {})).toBe(false)
    // project-only still works against the prefix directly
    expect(matchFilter({ projects: ['COND'], areas: [] }, 'COND', undefined, {})).toBe(true)
  })

  it('default areaMap param is {} when omitted — area derivation falls through to null', () => {
    const f: Filter = { projects: [], areas: ['client'] }
    // No areaMap passed — defaults to {} — unknown prefix → null → fails area filter
    expect(matchFilter(f, 'COND')).toBe(false)
    // But EMPTY_FILTER still passes
    expect(matchFilter(EMPTY_FILTER, 'COND')).toBe(true)
  })
})

describe('filter.ts — filterActive', () => {
  it('false for EMPTY_FILTER', () => {
    expect(filterActive(EMPTY_FILTER)).toBe(false)
  })
  it('true when projects non-empty', () => {
    expect(filterActive({ projects: ['COND'], areas: [] })).toBe(true)
  })
  it('true when areas non-empty', () => {
    expect(filterActive({ projects: [], areas: ['client'] })).toBe(true)
  })
})

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

describe('filter.ts — projectOfId', () => {
  it('splits PREFIX-N on the first dash', () => {
    expect(projectOfId('COND-88')).toBe('COND')
    expect(projectOfId('MCPAT-142')).toBe('MCPAT')
  })
  it('returns the whole string for a bare id with no dash', () => {
    expect(projectOfId('orphan')).toBe('orphan')
  })
})
