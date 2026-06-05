/**
 * AdvisorView.test.ts — Source-inspection tests for AdvisorView self-fetching container.
 *
 * Strategy: environment: 'node' (no DOM/jsdom). Read source as string and assert
 * on structural contracts from the spec.
 *
 * ACs verified:
 *  AC1 — self-fetches tasks via useTasks()
 *  AC2 — self-fetches notes via useQuery(['notes'], fetchNotes)
 *  AC3 — computes suggestions via buildSuggestions in useMemo
 *  AC4 — renders AdvisorChat component
 *  AC5 — renders SuggestionCard components in sugg-section
 *  AC6 — prop is only onOpenPanel: (panel: PanelState) => void
 *  AC7 — old fetchAdvisorQuery and RecommendationCard removed
 *  AC8 — commit mutation uses transitionTask
 *  AC9 — hermes mutation uses signoffTask
 *  AC10 — live state is internal (NOT a prop)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const UI_SRC = resolve(__dirname, '..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(UI_SRC, relPath), 'utf-8')
}

describe('AdvisorView.tsx — self-fetching container structure', () => {
  const src = readSrc('views/AdvisorView.tsx')

  it('exports AdvisorView function', () => {
    expect(src).toMatch(/export\s+function\s+AdvisorView/)
  })

  it('AC1 — uses useTasks hook', () => {
    expect(src).toContain('useTasks')
  })

  it('AC2 — fetches notes via useQuery with fetchNotes', () => {
    expect(src).toContain('fetchNotes')
    expect(src).toContain('useQuery')
  })

  it('AC3 — computes suggestions via buildSuggestions in useMemo', () => {
    expect(src).toContain('buildSuggestions')
    expect(src).toContain('useMemo')
  })

  it('AC4 — renders AdvisorChat component', () => {
    expect(src).toContain('AdvisorChat')
  })

  it('AC5 — renders SuggestionCard in sugg-section', () => {
    expect(src).toContain('SuggestionCard')
    expect(src).toContain('sugg-section')
  })

  it('AC6 — only prop is onOpenPanel', () => {
    expect(src).toContain('onOpenPanel')
    // Should not accept tasks/notes as props (self-fetching)
    expect(src).not.toMatch(/Props\s*=\s*\{[^}]*tasks[^}]*\}/)
  })

  it('AC7 — old fetchAdvisorQuery is removed', () => {
    expect(src).not.toContain('fetchAdvisorQuery')
  })

  it('AC7 — old RecommendationCard is removed', () => {
    expect(src).not.toContain('RecommendationCard')
  })

  it('AC8 — commit mutation uses transitionTask', () => {
    expect(src).toContain('transitionTask')
    expect(src).toContain('useMutation')
  })

  it('AC9 — hermes mutation uses signoffTask', () => {
    expect(src).toContain('signoffTask')
  })

  it('AC10 — live is internal state (not a prop)', () => {
    expect(src).toContain('live')
    expect(src).toMatch(/useState.*false|useState<boolean>/)
    // live should NOT appear in a Props interface as a prop
    expect(src).not.toMatch(/onOpenPanel[^}]*live/)
  })
})

describe('AdvisorView.tsx — render structure', () => {
  const src = readSrc('views/AdvisorView.tsx')

  it('renders advisor-view container', () => {
    expect(src).toContain('advisor-view')
  })

  it('renders Refresh button in sugg-section-head', () => {
    expect(src).toContain('sugg-section-head')
    expect(src).toContain('Refresh')
  })

  it('renders hero-empty when no suggestions', () => {
    expect(src).toContain('hero-empty')
  })

  it('dismissal updates dismissed state', () => {
    expect(src).toContain('dismissed')
    expect(src).toContain('setDismissed')
  })

  it('onOpenTask derived from onOpenPanel', () => {
    expect(src).toContain('onOpenTask')
    expect(src).toContain('mode')
    expect(src).toContain('detail')
  })
})

describe('App.tsx — AdvisorView wiring', () => {
  const appSrc = readFileSync(resolve(UI_SRC, 'App.tsx'), 'utf-8')

  it('App.tsx passes onOpenPanel={setPanel} to AdvisorView', () => {
    expect(appSrc).toContain('<AdvisorView onOpenPanel={setPanel}')
  })
})
