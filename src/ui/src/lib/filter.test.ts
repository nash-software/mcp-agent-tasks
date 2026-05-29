import { describe, it, expect, beforeEach } from 'vitest'
import {
  EMPTY_FILTER,
  matchFilter,
  filterActive,
  areaOfProject,
  projectOfId,
  setAreaMap,
  type Filter,
} from './filter'

describe('filter.ts — matchFilter', () => {
  beforeEach(() => {
    // Default area map for derivation tests
    setAreaMap({ COND: 'client', HRLD: 'client', ACR: 'internal', MCPAT: 'internal' })
  })

  it('EMPTY_FILTER matches everything (with or without an area arg)', () => {
    expect(matchFilter(EMPTY_FILTER, 'COND')).toBe(true)
    expect(matchFilter(EMPTY_FILTER, 'ANYTHING', 'personal')).toBe(true)
    expect(matchFilter(EMPTY_FILTER, 'XYZ')).toBe(true)
  })

  it('OR within projects — passes if project is in any selected prefix', () => {
    const f: Filter = { projects: ['COND', 'HRLD'], areas: [] }
    expect(matchFilter(f, 'COND')).toBe(true)
    expect(matchFilter(f, 'HRLD')).toBe(true)
    expect(matchFilter(f, 'ACR')).toBe(false)
  })

  it('OR within areas — passes if record area is in any selected area', () => {
    const f: Filter = { projects: [], areas: ['client'] }
    expect(matchFilter(f, 'X', 'client')).toBe(true)
    expect(matchFilter(f, 'X', 'internal')).toBe(false)
  })

  it('AND across dimensions — must pass both project and area', () => {
    const f: Filter = { projects: ['COND'], areas: ['client'] }
    expect(matchFilter(f, 'COND', 'client')).toBe(true)
    // passes project, fails area
    expect(matchFilter(f, 'COND', 'internal')).toBe(false)
    // fails project (HRLD not selected) even though area matches
    expect(matchFilter(f, 'HRLD', 'client')).toBe(false)
  })

  it('area derivation — resolves area via areaOfProject when no area arg', () => {
    const f: Filter = { projects: [], areas: ['client'] }
    // COND -> client via the map
    expect(matchFilter(f, 'COND')).toBe(true)
    // ACR -> internal via the map → fails a client filter
    expect(matchFilter(f, 'ACR')).toBe(false)
  })

  it('explicit area arg wins over the derived value', () => {
    const f: Filter = { projects: [], areas: ['personal'] }
    // map says COND is client, but caller passes personal explicitly
    expect(matchFilter(f, 'COND', 'personal')).toBe(true)
    expect(matchFilter(f, 'COND', 'client')).toBe(false)
  })

  it('unknown prefix derives null and fails an active area filter — never throws', () => {
    expect(areaOfProject('XYZ')).toBeNull()
    const f: Filter = { projects: [], areas: ['client'] }
    expect(() => matchFilter(f, 'XYZ')).not.toThrow()
    expect(matchFilter(f, 'XYZ')).toBe(false)
  })

  it('unknown prefix still passes when only a project filter is active', () => {
    const f: Filter = { projects: ['XYZ'], areas: [] }
    expect(matchFilter(f, 'XYZ')).toBe(true)
    expect(matchFilter(f, 'COND')).toBe(false)
  })

  it('empty area map — area filtering is inert (everything derives null)', () => {
    setAreaMap({})
    const f: Filter = { projects: [], areas: ['client'] }
    expect(matchFilter(f, 'COND')).toBe(false)
    // project-only still works against the prefix directly
    expect(matchFilter({ projects: ['COND'], areas: [] }, 'COND')).toBe(true)
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

describe('filter.ts — projectOfId', () => {
  it('splits PREFIX-N on the first dash', () => {
    expect(projectOfId('COND-88')).toBe('COND')
    expect(projectOfId('MCPAT-142')).toBe('MCPAT')
  })
  it('returns the whole string for a bare id with no dash', () => {
    expect(projectOfId('orphan')).toBe('orphan')
  })
})
