/**
 * P3-01 — UI polish pass (MCPAT-040). Source-inspection tests (repo convention — no DOM runner).
 *
 *   AC-1  BoardView renders the multi-line BoardCard (not the 40px TaskCard row)
 *   AC-3  TaskCard row height reads var(--row-h) (density-driven, no hardcoded 40)
 *   AC-4  Per-view width: App sets data-width on .main-inner; Board is full-width
 *   AC-6/7 Density: persisted to lifeos-density, data-density on the shell, three stops
 *   AC-8  density vars defined in index.css
 *   AC-11 ViewHeader rendered in every view
 *   AC-12 FilterBar uses the pill/Filter-button classes
 *   Density control shows full distinct labels (not an ambiguous first letter)
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const uiSrc = path.join(process.cwd(), 'src', 'ui', 'src')
const read = (rel: string): string => fs.readFileSync(path.join(uiSrc, rel), 'utf-8')

describe('P3-01 — Board cards', () => {
  it('BoardCard component exists and is multi-line (line-clamp, not truncate)', () => {
    const src = read('components/BoardCard.tsx')
    expect(src).toMatch(/line-clamp-3/)
  })
  it('BoardView renders BoardCard', () => {
    expect(read('views/BoardView.tsx')).toContain('BoardCard')
  })
})

describe('P3-01 — density-driven row height', () => {
  it('TaskCard height reads var(--row-h), no hardcoded height: 40', () => {
    const src = read('components/TaskCard.tsx')
    expect(src).toMatch(/var\(--row-h/)
    expect(src).not.toMatch(/height:\s*40\b/)
  })
  it('index.css defines the density vars on data-density stops', () => {
    const css = read('index.css')
    expect(css).toMatch(/\[data-density="compact"\]/)
    expect(css).toMatch(/\[data-density="cozy"\]/)
    expect(css).toMatch(/\[data-density="spacious"\]/)
    expect(css).toMatch(/--row-h/)
    expect(css).toMatch(/--section-gap/)
  })
})

describe('P3-01 — per-view content width', () => {
  it('App sets data-width on .main-inner and treats board as full', () => {
    const app = read('App.tsx')
    expect(app).toMatch(/FULL_WIDTH_VIEWS/)
    expect(app).toMatch(/'board'/)
    expect(app).toMatch(/data-width=/)
  })
  it('TodayView no longer double-constrains with max-w-3xl', () => {
    expect(read('views/TodayView.tsx')).not.toMatch(/max-w-3xl/)
  })
})

describe('P3-01 — density switcher', () => {
  it('App persists density to lifeos-density and sets data-density on the shell', () => {
    const app = read('App.tsx')
    expect(app).toMatch(/lifeos-density/)
    expect(app).toMatch(/data-density/)
    expect(app).toMatch(/'compact'|'cozy'|'spacious'/)
  })
  it('Nav density control shows full labels (not an ambiguous first letter)', () => {
    const nav = read('components/Nav.tsx')
    expect(nav).toMatch(/\{opt\.label\}/)
    expect(nav).not.toMatch(/opt\.label\[0\]/)
  })
})

describe('P3-01 — ViewHeader on every view', () => {
  const views = ['TodayView', 'BoardView', 'HermesView', 'BrainDumpView', 'ArtifactsView', 'RoadmapView', 'ActivityView']
  for (const v of views) {
    it(`${v} renders <ViewHeader`, () => {
      expect(read(`views/${v}.tsx`)).toMatch(/<ViewHeader/)
    })
  }
})

describe('P3-01 — FilterBar visual classes', () => {
  it('FilterBar uses the pill + filter-button classes', () => {
    const fb = read('components/FilterBar.tsx')
    expect(fb).toMatch(/fav-chip/)
    expect(fb).toMatch(/filter-btn/)
  })
})
