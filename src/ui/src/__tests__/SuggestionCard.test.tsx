/**
 * SuggestionCard.test.tsx — Source-inspection tests for SuggestionCard component.
 *
 * Strategy: environment: 'node' (no DOM/jsdom). Read source as string and assert
 * on structural contracts from the spec.
 *
 * ACs verified:
 *  AC1 — renders data-sev attribute on root div
 *  AC2 — dismiss button calls onDismiss with s.id
 *  AC3 — SEV_LABEL badge text present (Act now / Watch / Consider)
 *  AC4 — action buttons render per s.actions array (commit/hermes/open)
 *  AC5 — sugg-rank element present
 *  AC6 — sugg-basis rendered when s.basis present
 *  AC7 — imports SEV_LABEL, Suggestion, SuggestionId from lib/advisor
 *  AC8 — imports X from lucide-react
 *  AC9 — no local state; no useState
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const UI_SRC = resolve(__dirname, '..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(UI_SRC, relPath), 'utf-8')
}

describe('SuggestionCard.tsx — module structure', () => {
  const src = readSrc('components/SuggestionCard.tsx')

  it('exports SuggestionCard function', () => {
    expect(src).toMatch(/export\s+function\s+SuggestionCard/)
  })

  it('imports SEV_LABEL from lib/advisor', () => {
    expect(src).toContain('SEV_LABEL')
    expect(src).toContain('advisor')
  })

  it('imports Suggestion and SuggestionId types from lib/advisor', () => {
    expect(src).toMatch(/Suggestion|SuggestionId/)
    expect(src).toContain('advisor')
  })

  it('imports X icon from lucide-react', () => {
    expect(src).toContain('X')
    expect(src).toContain('lucide-react')
  })

  it('has no local state (no useState)', () => {
    expect(src).not.toContain('useState')
  })
})

describe('SuggestionCard.tsx — rendering contract', () => {
  const src = readSrc('components/SuggestionCard.tsx')

  it('AC1 — root div has data-sev attribute tied to s.severity', () => {
    expect(src).toContain('data-sev')
    expect(src).toContain('s.severity')
  })

  it('AC2 — dismiss button calls onDismiss with s.id', () => {
    expect(src).toContain('onDismiss')
    expect(src).toContain('s.id')
  })

  it('AC3 — sev-badge uses SEV_LABEL[s.severity]', () => {
    expect(src).toContain('sev-badge')
    expect(src).toContain('SEV_LABEL')
    expect(src).toContain('s.severity')
  })

  it('AC3 — sugg-rank element present', () => {
    expect(src).toContain('sugg-rank')
  })

  it('AC4 — commit action button present when s.actions includes commit', () => {
    expect(src).toContain("includes('commit')")
    expect(src).toContain('Commit')
    expect(src).toContain('onCommit')
  })

  it('AC4 — hermes action button present when s.actions includes hermes', () => {
    expect(src).toContain("includes('hermes')")
    expect(src).toContain('Hand to Hermes')
    expect(src).toContain('onHermes')
  })

  it('AC4 — open action button present when s.actions includes open', () => {
    expect(src).toContain("includes('open')")
    expect(src).toContain('onOpen')
  })

  it('AC5 — sugg-title uses s.title', () => {
    expect(src).toContain('sugg-title')
    expect(src).toContain('s.title')
  })

  it('AC5 — sugg-rationale uses s.rationale', () => {
    expect(src).toContain('sugg-rationale')
    expect(src).toContain('s.rationale')
  })

  it('AC6 — sugg-basis rendered when s.basis present', () => {
    expect(src).toContain('sugg-basis')
    expect(src).toContain('s.basis')
  })

  it('AC7 — sugg-chips renders s.taskIds as id-chip buttons', () => {
    expect(src).toContain('sugg-chips')
    expect(src).toContain('id-chip')
    expect(src).toContain('s.taskIds')
  })

  it('AC8 — X icon used for dismiss button', () => {
    expect(src).toContain('<X')
    expect(src).toContain('size={14}')
  })
})
