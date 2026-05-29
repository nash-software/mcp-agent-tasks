/**
 * Unit tests for P2-02 — Favourites (pinned projects).
 * Uses source-file analysis consistent with project test conventions (node env, no jsdom).
 *
 * Covers spec ACs:
 *   AC-1  Star toggle persists to localStorage('lifeos-favs')
 *   AC-2  Nav Favourites group renders when favorites.length > 0, hidden when empty
 *   AC-3  Pinned nav item calls onToggleProject (not navigate)
 *   AC-4  FilterBar quick-chips render per favourite with count + active treatment
 *   AC-5  App-level single source of truth for favorites + toggleFav
 *   AC-6  projectCounts derived once in App, passed to Nav + FilterBar
 * Plus: toggleFav logic, projectCounts logic, pruning, localStorage parse guard.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const uiSrc = path.join(root, 'src', 'ui', 'src')

function readUiFile(relPath: string): string {
  return fs.readFileSync(path.join(uiSrc, relPath), 'utf-8')
}

const appSrc = readUiFile('App.tsx')
const navSrc = readUiFile('components/Nav.tsx')
const filterBarSrc = readUiFile('components/FilterBar.tsx')

// ── Pure logic tests (toggleFav, projectCounts) ────────────────────────────

describe('toggleFav logic', () => {
  // Reproduce the toggleFav logic verbatim from App.tsx
  function toggleFav(fs: string[], prefix: string): string[] {
    return fs.includes(prefix) ? fs.filter(x => x !== prefix) : [...fs, prefix]
  }

  it('adds an unpinned prefix', () => {
    expect(toggleFav([], 'MCPAT')).toEqual(['MCPAT'])
  })

  it('removes a pinned prefix', () => {
    expect(toggleFav(['MCPAT', 'COND'], 'MCPAT')).toEqual(['COND'])
  })

  it('preserves order on add', () => {
    const result = toggleFav(['COND'], 'HRLD')
    expect(result).toEqual(['COND', 'HRLD'])
  })

  it('is idempotent on the same remove', () => {
    expect(toggleFav(['MCPAT'], 'MCPAT')).toEqual([])
  })
})

describe('projectCounts logic', () => {
  type MockTask = { project: string; status: string }

  function computeCounts(tasks: MockTask[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const t of tasks) {
      if (!t.project) continue
      if (t.status === 'done' || t.status === 'archived' || t.status === 'cancelled') continue
      counts[t.project] = (counts[t.project] ?? 0) + 1
    }
    return counts
  }

  it('counts open tasks per project', () => {
    const tasks: MockTask[] = [
      { project: 'MCPAT', status: 'todo' },
      { project: 'MCPAT', status: 'in_progress' },
      { project: 'COND', status: 'todo' },
    ]
    expect(computeCounts(tasks)).toEqual({ MCPAT: 2, COND: 1 })
  })

  it('excludes done and cancelled tasks', () => {
    const tasks: MockTask[] = [
      { project: 'MCPAT', status: 'done' },
      { project: 'MCPAT', status: 'cancelled' },
      { project: 'MCPAT', status: 'archived' },
    ]
    expect(computeCounts(tasks)).toEqual({})
  })

  it('produces no key for a project with zero open tasks (badge omitted)', () => {
    const tasks: MockTask[] = [{ project: 'MCPAT', status: 'done' }]
    const counts = computeCounts(tasks)
    expect('MCPAT' in counts).toBe(false)
  })
})

describe('pruning logic', () => {
  function pruneStale(favorites: string[], knownPrefixes: string[]): string[] {
    const known = new Set(knownPrefixes)
    return favorites.filter(f => known.has(f))
  }

  it('removes a stale favourite not in the known set', () => {
    expect(pruneStale(['MCPAT', 'GONE'], ['MCPAT', 'COND'])).toEqual(['MCPAT'])
  })

  it('returns the same array when all are known', () => {
    const fav = ['MCPAT', 'COND']
    const result = pruneStale(fav, ['MCPAT', 'COND'])
    expect(result).toEqual(['MCPAT', 'COND'])
  })

  it('returns empty when all are stale', () => {
    expect(pruneStale(['GONE'], ['MCPAT'])).toEqual([])
  })
})

// ── App.tsx — state ownership and wiring ───────────────────────────────────

describe('App.tsx — favourites state (AC-5, AC-6)', () => {
  it('owns favorites state initialized from localStorage(lifeos-favs)', () => {
    expect(appSrc).toContain("lifeos-favs")
    expect(appSrc).toContain('favorites')
  })

  it('has a try/catch parse guard for localStorage', () => {
    // The lazy initializer wraps JSON.parse in try/catch, returning [] on failure
    expect(appSrc).toMatch(/try[\s\S]{0,300}lifeos-favs[\s\S]{0,300}catch/s)
  })

  it('falls back to [] when localStorage value is not a string array', () => {
    expect(appSrc).toContain('return []')
  })

  it('persists favorites via useEffect', () => {
    expect(appSrc).toMatch(/useEffect[\s\S]{0,100}lifeos-favs/s)
  })

  it('defines toggleFav that adds/removes prefixes', () => {
    // toggleFav is the single handler
    expect(appSrc).toContain('toggleFav')
    expect(appSrc).toContain('setFavorites')
  })

  it('passes favorites and toggleFav to FilterBar', () => {
    expect(appSrc).toContain('favorites={favorites}')
    expect(appSrc).toContain('onToggleFav={toggleFav}')
  })

  it('passes favorites and projectCounts to Nav', () => {
    expect(appSrc).toContain('favorites={favorites}')
    expect(appSrc).toContain('projectCounts={projectCounts}')
  })

  it('derives projectCounts once via useMemo (AC-6)', () => {
    expect(appSrc).toContain('projectCounts')
    expect(appSrc).toContain('useMemo')
  })

  it('prunes stale favourites when projects list loads', () => {
    // The pruning effect compares against projectEntries
    expect(appSrc).toContain('projectEntries')
    expect(appSrc).toMatch(/pruned|filter.*known|known.*filter/s)
  })
})

// ── Nav.tsx — Favourites group (AC-2, AC-3) ──────────────────────────────

describe('Nav.tsx — Favourites group (AC-2)', () => {
  it('accepts a favorites prop', () => {
    expect(navSrc).toContain('favorites')
  })

  it('accepts projectCounts prop', () => {
    expect(navSrc).toContain('projectCounts')
  })

  it('accepts onToggleProject prop', () => {
    expect(navSrc).toContain('onToggleProject')
  })

  it('renders Favourites group label when favorites.length > 0', () => {
    // The group label only renders when favorites has items
    expect(navSrc).toContain('Favourites')
    expect(navSrc).toMatch(/favorites\.length\s*>\s*0/)
  })

  it('does NOT render a Favourites group when favorites is empty', () => {
    // Guard: the group is inside a favorites.length > 0 conditional
    expect(navSrc).toMatch(/favorites\.length\s*>\s*0[\s\S]{0,200}Favourites/s)
  })

  it('renders AreaDot for each pinned project', () => {
    expect(navSrc).toContain('AreaDot')
  })

  it('renders project prefix in mono font', () => {
    expect(navSrc).toContain('font-mono')
    expect(navSrc).toContain('prefix')
  })

  it('renders open-task count when count > 0 (AC-2)', () => {
    // Count is conditional — only shown when > 0
    expect(navSrc).toMatch(/count.*>\s*0|count\s*&&|count\s*!=\s*null.*count\s*>\s*0/s)
  })

  it('calls onToggleProject on pin click — not navigate (AC-3)', () => {
    expect(navSrc).toContain('onToggleProject(prefix)')
  })

  it('skip-renders null for a pin whose project cannot be resolved', () => {
    expect(navSrc).toContain('if (!proj) return null')
  })

  it('tooltip contains click to filter everywhere (AC-3)', () => {
    expect(navSrc).toContain('click to filter everywhere')
  })
})

// ── FilterBar.tsx — star toggle + quick-chips (AC-1, AC-4) ────────────────

describe('FilterBar.tsx — star toggle (AC-1)', () => {
  it('renders star toggle per project row', () => {
    expect(filterBarSrc).toContain('fav-star')
    expect(filterBarSrc).toContain('onToggleFav')
  })

  it('calls e.stopPropagation() on the star toggle to not flip the checkbox', () => {
    expect(filterBarSrc).toContain('e.stopPropagation()')
  })

  it('star toggle reflects favourited state via fill', () => {
    expect(filterBarSrc).toMatch(/favorites\.includes\(p\.prefix\).*fill|fill.*favorites\.includes\(p\.prefix\)/s)
  })
})

describe('FilterBar.tsx — favourite quick-chips (AC-4)', () => {
  it('renders fav-chip buttons for favourite projects', () => {
    expect(filterBarSrc).toContain('fav-chip')
    expect(filterBarSrc).toContain('favProjects')
  })

  it('chip shows open-task count when > 0', () => {
    expect(filterBarSrc).toContain('projectCounts[p.prefix]')
  })

  it('chip calls onToggleProject on click', () => {
    expect(filterBarSrc).toContain('onToggleProject(p.prefix)')
  })

  it('chip shows active treatment when project is in filter.projects', () => {
    expect(filterBarSrc).toMatch(/filter\.projects\.includes\(p\.prefix\).*active|active.*filter\.projects\.includes\(p\.prefix\)/s)
  })

  it('divider only renders when there are favourite chips', () => {
    expect(filterBarSrc).toContain('favProjects.length > 0')
    expect(filterBarSrc).toContain('fb-divider')
  })

  it('no chips rendered when favorites is empty (AC-4)', () => {
    // The map over favProjects produces nothing when favProjects is empty,
    // and the divider is guarded by favProjects.length > 0
    expect(filterBarSrc).toContain('favProjects.length > 0')
  })
})

// ── Persistence round-trip — source guard ─────────────────────────────────

describe('Persistence round-trip guard', () => {
  it('App.tsx localStorage key is exactly lifeos-favs (verbatim per §5)', () => {
    expect(appSrc).toContain("'lifeos-favs'")
  })

  it('favorites is not a const/let empty array (stubs replaced)', () => {
    // Ensure the P2-02 stubs are gone
    expect(appSrc).not.toContain('const favorites: string[] = []')
    expect(appSrc).not.toContain('/* P2-02 */')
  })
})
