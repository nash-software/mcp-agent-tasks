/**
 * ModeSelector.test.tsx — Source inspection tests for ModeSelector component.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const UI_SRC = resolve(__dirname, '..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(UI_SRC, relPath), 'utf-8')
}

describe('ModeSelector.tsx — module structure', () => {
  const src = readSrc('components/ModeSelector.tsx')

  it('exports ModeSelector function', () => {
    expect(src).toMatch(/export\s+function\s+ModeSelector/)
  })

  it('imports PERSONAS and PersonaId from lib/advisor', () => {
    expect(src).toContain('PERSONAS')
    expect(src).toContain('../lib/advisor')
  })

  it('renders role=tablist on container', () => {
    expect(src).toContain('role="tablist"')
  })

  it('renders role=tab on each button', () => {
    expect(src).toContain('role="tab"')
  })

  it('renders aria-selected based on active mode', () => {
    expect(src).toContain('aria-selected')
    expect(src).toContain('mode === id')
  })

  it('applies active class to selected tab', () => {
    expect(src).toContain('active')
    expect(src).toContain('mode-tab')
  })

  it('renders mode-tab-label and mode-tab-desc spans', () => {
    expect(src).toContain('mode-tab-label')
    expect(src).toContain('mode-tab-desc')
  })

  it('accepts mode and onModeChange props', () => {
    expect(src).toContain('onModeChange')
    expect(src).toContain('mode:')
  })

  it('covers all three persona IDs', () => {
    expect(src).toContain("'pm'")
    expect(src).toContain("'chairman'")
    expect(src).toContain("'coach'")
  })
})
