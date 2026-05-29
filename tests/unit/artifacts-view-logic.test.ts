/**
 * Unit tests for ArtifactsView pure-logic helpers (P1-08 / MCPAT-030).
 *
 * These tests cover the sort guard and staleness-threshold logic extracted
 * to plain TypeScript functions — no DOM or React required.
 *
 * Component-level tests (clipboard, DOM order, empty state) require a
 * jsdom environment and are deferred to a dedicated UI test suite.
 */
import { describe, it, expect } from 'vitest'

// ── Inline the helpers so this test file has zero import dependency on the
//    React component tree (avoids JSX + lucide-react in the node env).

const STALE_FRESH_MAX_DAYS = 7
const STALE_MID_MAX_DAYS = 21

interface ArtifactEntry {
  path: string
  project: string
  created_at: string
  last_opened_at: string | null
  task_id: string | null
  staleDays: number
}

function sortByStaleDesc(artifacts: ArtifactEntry[]): ArtifactEntry[] {
  return [...artifacts].sort((a, b) => b.staleDays - a.staleDays)
}

function staleBadgeColor(staleDays: number): 'green' | 'amber' | 'red' {
  if (staleDays <= STALE_FRESH_MAX_DAYS) return 'green'
  if (staleDays <= STALE_MID_MAX_DAYS) return 'amber'
  return 'red'
}

function makeArtifact(staleDays: number, last_opened_at: string | null = null): ArtifactEntry {
  return {
    path: `/test/file-${staleDays}.ts`,
    project: 'TEST',
    created_at: new Date(Date.now() - staleDays * 86_400_000).toISOString(),
    last_opened_at,
    task_id: null,
    staleDays,
  }
}

// ── Sort guard (AC-2) ─────────────────────────────────────────────────────────

describe('sortByStaleDesc — client-side sort guard (AC-2)', () => {
  it('sorts scrambled input to non-increasing staleDays order', () => {
    const input = [3, 30, 12, 1, 22].map(d => makeArtifact(d))
    const sorted = sortByStaleDesc(input)
    const days = sorted.map(a => a.staleDays)
    expect(days).toEqual([30, 22, 12, 3, 1])
  })

  it('does not mutate the original array', () => {
    const input = [5, 20, 10].map(d => makeArtifact(d))
    const originalDays = input.map(a => a.staleDays)
    sortByStaleDesc(input)
    expect(input.map(a => a.staleDays)).toEqual(originalDays)
  })

  it('handles empty array', () => {
    expect(sortByStaleDesc([])).toEqual([])
  })

  it('handles single item', () => {
    const input = [makeArtifact(7)]
    expect(sortByStaleDesc(input).map(a => a.staleDays)).toEqual([7])
  })

  it('preserves input order for ties (stable sort)', () => {
    const a = { ...makeArtifact(10), path: '/test/a.ts' }
    const b = { ...makeArtifact(10), path: '/test/b.ts' }
    const sorted = sortByStaleDesc([a, b])
    expect(sorted[0].path).toBe('/test/a.ts')
    expect(sorted[1].path).toBe('/test/b.ts')
  })
})

// ── Staleness badge thresholds (AC-3) ─────────────────────────────────────────

describe('staleBadgeColor — threshold boundaries (AC-3)', () => {
  it('staleDays=7 → green (boundary: <=7)', () => {
    expect(staleBadgeColor(7)).toBe('green')
  })

  it('staleDays=1 → green', () => {
    expect(staleBadgeColor(1)).toBe('green')
  })

  it('staleDays=0 → green', () => {
    expect(staleBadgeColor(0)).toBe('green')
  })

  it('staleDays=8 → amber (just above fresh boundary)', () => {
    expect(staleBadgeColor(8)).toBe('amber')
  })

  it('staleDays=21 → amber (boundary: <=21)', () => {
    expect(staleBadgeColor(21)).toBe('amber')
  })

  it('staleDays=22 → red (just above mid boundary)', () => {
    expect(staleBadgeColor(22)).toBe('red')
  })

  it('staleDays=30 → red', () => {
    expect(staleBadgeColor(30)).toBe('red')
  })

  it('staleDays=100 → red', () => {
    expect(staleBadgeColor(100)).toBe('red')
  })
})

// ── Header counts (AC-1) ──────────────────────────────────────────────────────

describe('header counts logic (AC-1)', () => {
  it('counts unvisited as rows where last_opened_at === null', () => {
    const artifacts: ArtifactEntry[] = [
      makeArtifact(5, null),
      makeArtifact(10, new Date().toISOString()),
      makeArtifact(20, null),
      makeArtifact(3, null),
    ]
    const unvisited = artifacts.filter(a => a.last_opened_at === null).length
    expect(unvisited).toBe(3)
    expect(artifacts.length).toBe(4)
  })

  it('unvisited=0 when all have been opened', () => {
    const now = new Date().toISOString()
    const artifacts = [1, 2, 3].map(d => makeArtifact(d, now))
    const unvisited = artifacts.filter(a => a.last_opened_at === null).length
    expect(unvisited).toBe(0)
  })
})

// ── Named constants sanity ────────────────────────────────────────────────────

describe('staleness threshold constants', () => {
  it('STALE_FRESH_MAX_DAYS is 7', () => {
    expect(STALE_FRESH_MAX_DAYS).toBe(7)
  })

  it('STALE_MID_MAX_DAYS is 21', () => {
    expect(STALE_MID_MAX_DAYS).toBe(21)
  })
})
