/**
 * sortTasks unit tests — MCPAT-069 Phase C.
 */
import { describe, it, expect } from 'vitest'
import type { Task } from '../types'
import { sortTasks, type SortKey, type SortDir } from './sort'

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Build a minimal Task fixture with required fields and optional overrides. */
function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    status: 'todo',
    type: 'feature',
    priority: 'medium',
    ...overrides,
  }
}

const BASE_TASKS: Task[] = [
  makeTask({ id: 'A', title: 'Alpha', priority: 'low',      created: '2026-01-01T00:00:00Z', updated: '2026-01-10T00:00:00Z', scheduled_for: '2026-06-10', complexity: 3, estimate_hours: 2 }),
  makeTask({ id: 'B', title: 'Beta',  priority: 'critical', created: '2026-01-03T00:00:00Z', updated: '2026-01-08T00:00:00Z', scheduled_for: '2026-06-08', complexity: 1, estimate_hours: 4 }),
  makeTask({ id: 'C', title: 'gamma', priority: 'high',     created: '2026-01-02T00:00:00Z', updated: '2026-01-09T00:00:00Z', scheduled_for: '2026-06-09', complexity: 2, estimate_hours: 1 }),
]

// ── Non-mutation ──────────────────────────────────────────────────────────────

describe('sortTasks — non-mutation', () => {
  it('returns a new array and does not mutate the input', () => {
    const input = [...BASE_TASKS]
    const result = sortTasks(input, 'priority', 'asc')
    expect(result).not.toBe(input)
    // Input order should be unchanged
    expect(input.map(t => t.id)).toEqual(['A', 'B', 'C'])
  })
})

// ── Priority ──────────────────────────────────────────────────────────────────

describe('sortTasks — priority', () => {
  it('asc = critical-first (low PRI_RANK first)', () => {
    const result = sortTasks(BASE_TASKS, 'priority', 'asc')
    // B=critical(0), C=high(1), A=low(3)
    expect(result.map(t => t.id)).toEqual(['B', 'C', 'A'])
  })

  it('desc = low-first (high PRI_RANK first)', () => {
    const result = sortTasks(BASE_TASKS, 'priority', 'desc')
    // A=low(3), C=high(1), B=critical(0)
    expect(result.map(t => t.id)).toEqual(['A', 'C', 'B'])
  })
})

// ── Created ───────────────────────────────────────────────────────────────────

describe('sortTasks — created', () => {
  it('asc = earliest first', () => {
    const result = sortTasks(BASE_TASKS, 'created', 'asc')
    // A=2026-01-01, C=2026-01-02, B=2026-01-03
    expect(result.map(t => t.id)).toEqual(['A', 'C', 'B'])
  })

  it('desc = latest first', () => {
    const result = sortTasks(BASE_TASKS, 'created', 'desc')
    expect(result.map(t => t.id)).toEqual(['B', 'C', 'A'])
  })
})

// ── Updated ───────────────────────────────────────────────────────────────────

describe('sortTasks — updated', () => {
  it('asc = earliest first', () => {
    const result = sortTasks(BASE_TASKS, 'updated', 'asc')
    // B=Jan-08, C=Jan-09, A=Jan-10
    expect(result.map(t => t.id)).toEqual(['B', 'C', 'A'])
  })

  it('desc = latest first', () => {
    const result = sortTasks(BASE_TASKS, 'updated', 'desc')
    expect(result.map(t => t.id)).toEqual(['A', 'C', 'B'])
  })
})

// ── Scheduled ─────────────────────────────────────────────────────────────────

describe('sortTasks — scheduled', () => {
  it('asc = earliest scheduled first', () => {
    const result = sortTasks(BASE_TASKS, 'scheduled', 'asc')
    // B=06-08, C=06-09, A=06-10
    expect(result.map(t => t.id)).toEqual(['B', 'C', 'A'])
  })

  it('desc = latest scheduled first', () => {
    const result = sortTasks(BASE_TASKS, 'scheduled', 'desc')
    expect(result.map(t => t.id)).toEqual(['A', 'C', 'B'])
  })

  it('null/undefined scheduled_for sorts LAST in asc', () => {
    const tasks = [
      makeTask({ id: 'X', title: 'X', scheduled_for: null }),
      makeTask({ id: 'Y', title: 'Y', scheduled_for: '2026-06-01' }),
      makeTask({ id: 'Z', title: 'Z', scheduled_for: undefined }),
    ]
    const result = sortTasks(tasks, 'scheduled', 'asc')
    expect(result[0].id).toBe('Y')
    // X and Z are both null-like, tie-broken by id
    expect(result.slice(1).map(t => t.id).sort()).toEqual(['X', 'Z'].sort())
  })

  it('null/undefined scheduled_for sorts LAST in desc', () => {
    const tasks = [
      makeTask({ id: 'X', title: 'X', scheduled_for: null }),
      makeTask({ id: 'Y', title: 'Y', scheduled_for: '2026-06-01' }),
    ]
    const result = sortTasks(tasks, 'scheduled', 'desc')
    // Y comes first (desc, non-null is ordered first), X (null) is last
    expect(result[0].id).toBe('Y')
    expect(result[1].id).toBe('X')
  })
})

// ── Title ─────────────────────────────────────────────────────────────────────

describe('sortTasks — title', () => {
  it('asc = alphabetical, case-insensitive', () => {
    const result = sortTasks(BASE_TASKS, 'title', 'asc')
    // Alpha, Beta, gamma (case-insensitive: a < b < g)
    expect(result.map(t => t.id)).toEqual(['A', 'B', 'C'])
  })

  it('desc = reverse alphabetical, case-insensitive', () => {
    const result = sortTasks(BASE_TASKS, 'title', 'desc')
    expect(result.map(t => t.id)).toEqual(['C', 'B', 'A'])
  })
})

// ── Complexity ────────────────────────────────────────────────────────────────

describe('sortTasks — complexity', () => {
  it('asc = lowest complexity first', () => {
    const result = sortTasks(BASE_TASKS, 'complexity', 'asc')
    // B=1, C=2, A=3
    expect(result.map(t => t.id)).toEqual(['B', 'C', 'A'])
  })

  it('desc = highest complexity first', () => {
    const result = sortTasks(BASE_TASKS, 'complexity', 'desc')
    expect(result.map(t => t.id)).toEqual(['A', 'C', 'B'])
  })

  it('null complexity sorts LAST in both directions', () => {
    const tasks = [
      makeTask({ id: 'X', title: 'X', complexity: undefined }),
      makeTask({ id: 'Y', title: 'Y', complexity: 5 }),
      makeTask({ id: 'Z', title: 'Z', complexity: 1 }),
    ]
    const asc = sortTasks(tasks, 'complexity', 'asc')
    expect(asc[asc.length - 1].id).toBe('X')
    const desc = sortTasks(tasks, 'complexity', 'desc')
    expect(desc[desc.length - 1].id).toBe('X')
  })
})

// ── Estimate ─────────────────────────────────────────────────────────────────

describe('sortTasks — estimate', () => {
  it('asc = smallest estimate first', () => {
    const result = sortTasks(BASE_TASKS, 'estimate', 'asc')
    // C=1h, A=2h, B=4h
    expect(result.map(t => t.id)).toEqual(['C', 'A', 'B'])
  })

  it('desc = largest estimate first', () => {
    const result = sortTasks(BASE_TASKS, 'estimate', 'desc')
    expect(result.map(t => t.id)).toEqual(['B', 'A', 'C'])
  })

  it('null estimate_hours sorts LAST in both directions', () => {
    const tasks = [
      makeTask({ id: 'X', title: 'X', estimate_hours: null }),
      makeTask({ id: 'Y', title: 'Y', estimate_hours: 3 }),
    ]
    const asc = sortTasks(tasks, 'estimate', 'asc')
    expect(asc[1].id).toBe('X')
    const desc = sortTasks(tasks, 'estimate', 'desc')
    expect(desc[1].id).toBe('X')
  })
})

// ── Tie-breakers ──────────────────────────────────────────────────────────────

describe('sortTasks — tie-breakers', () => {
  it('equal primary values fall back to id ascending (stable)', () => {
    const tasks = [
      makeTask({ id: 'C', title: 'Same', priority: 'high' }),
      makeTask({ id: 'A', title: 'Same', priority: 'high' }),
      makeTask({ id: 'B', title: 'Same', priority: 'high' }),
    ]
    const result = sortTasks(tasks, 'title', 'asc')
    expect(result.map(t => t.id)).toEqual(['A', 'B', 'C'])
  })

  it('equal priority falls back to id asc', () => {
    const tasks = [
      makeTask({ id: 'Z', title: 'Z', priority: 'high' }),
      makeTask({ id: 'A', title: 'A', priority: 'high' }),
    ]
    const result = sortTasks(tasks, 'priority', 'asc')
    expect(result.map(t => t.id)).toEqual(['A', 'Z'])
  })
})

// ── All-null values ───────────────────────────────────────────────────────────

describe('sortTasks — all nulls', () => {
  it('all nulls sort stably by id', () => {
    const tasks = [
      makeTask({ id: 'B', title: 'B', scheduled_for: null }),
      makeTask({ id: 'A', title: 'A', scheduled_for: null }),
    ]
    const asc = sortTasks(tasks, 'scheduled', 'asc')
    expect(asc.map(t => t.id)).toEqual(['A', 'B'])
    const desc = sortTasks(tasks, 'scheduled', 'desc')
    expect(desc.map(t => t.id)).toEqual(['A', 'B'])
  })
})

// ── Key exhaustiveness (compile check) ────────────────────────────────────────

describe('sortTasks — all keys compile and run', () => {
  const KEYS: SortKey[] = ['priority', 'created', 'updated', 'scheduled', 'title', 'complexity', 'estimate']
  const DIRS: SortDir[] = ['asc', 'desc']

  for (const key of KEYS) {
    for (const dir of DIRS) {
      it(`runs without throwing for key=${key} dir=${dir}`, () => {
        expect(() => sortTasks(BASE_TASKS, key, dir)).not.toThrow()
      })
    }
  }
})
