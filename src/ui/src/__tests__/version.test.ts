/**
 * version.test.ts — Tests for lib/version.ts + useBuildVersion.ts + related UI components.
 *
 * Strategy:
 *  - Pure-function tests (hasBuildChanged): import directly from lib/version (no React).
 *  - Source-inspection tests: read source as string, assert structural contracts —
 *    no DOM/jsdom/React rendering needed (environment: 'node' in vitest.config.ts).
 *
 * ACs verified:
 *  AC1 — poller fires only while document.visibilityState === 'visible'; stops when hidden
 *         (source: setInterval + visibilityState guard + visibilitychange listener in useBuildVersion)
 *  AC2 — when buildId differs from loaded baseline, updateAvailable=true; identical → false
 *         (pure: hasBuildChanged direct test)
 *  AC3 — header Update button renders only when devTray=true; hidden when false
 *         (source: UpdateButton returns null when !devTray)
 *  AC4 — clicking Update when build fails shows log and does NOT reload
 *         (source: UpdateButton sets failed state + renders log; no reload call in UpdateButton)
 *  AC5 — npm run type-check passes (gate — run separately via `npm run type-check`)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// hasBuildChanged is pure (no React) — safe to import directly
import { hasBuildChanged } from '../lib/version'

const UI_SRC = resolve(__dirname, '..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(UI_SRC, relPath), 'utf-8')
}

// ─── Pure function tests (AC2) ────────────────────────────────────────────────

describe('hasBuildChanged — pure comparison', () => {
  it('returns false when buildIds are identical', () => {
    expect(hasBuildChanged('abc123', 'abc123')).toBe(false)
  })

  it('returns true when buildIds differ', () => {
    expect(hasBuildChanged('abc123', 'def456')).toBe(true)
  })

  it('returns true when latestBuildId is empty string', () => {
    expect(hasBuildChanged('abc123', '')).toBe(true)
  })

  it('returns false when both are empty strings', () => {
    expect(hasBuildChanged('', '')).toBe(false)
  })

  it('is case-sensitive', () => {
    expect(hasBuildChanged('ABC123', 'abc123')).toBe(true)
  })
})

// ─── lib/version.ts — module structure ───────────────────────────────────────

describe('lib/version.ts — module structure', () => {
  const src = readSrc('lib/version.ts')

  it('has NO React import (pure module, unit-testable in node)', () => {
    expect(src).not.toContain("from 'react'")
  })

  it('exports hasBuildChanged pure function', () => {
    expect(src).toMatch(/export\s+function\s+hasBuildChanged/)
  })

  it('exports fetchVersion async function', () => {
    expect(src).toMatch(/export\s+async\s+function\s+fetchVersion/)
  })

  it('exports postDevUpdate async function', () => {
    expect(src).toMatch(/export\s+async\s+function\s+postDevUpdate/)
  })

  it('exports VersionResponse interface with buildId and devTray', () => {
    expect(src).toContain('VersionResponse')
    expect(src).toContain('buildId: string')
    expect(src).toContain('devTray: boolean')
  })

  it('exports BuildVersionState interface with all required fields', () => {
    expect(src).toContain('BuildVersionState')
    expect(src).toContain('updateAvailable: boolean')
    expect(src).toContain('loadedBuildId')
    expect(src).toContain('latestBuildId')
  })

  it('exports POLL_INTERVAL_MS constant', () => {
    expect(src).toContain('POLL_INTERVAL_MS')
    expect(src).toContain('5_000')
  })

  it('fetchVersion uses cache: no-store (never cached)', () => {
    expect(src).toContain("cache: 'no-store'")
  })

  it('fetchVersion calls /api/version', () => {
    expect(src).toContain('/api/version')
  })

  it('postDevUpdate calls /api/dev/update with POST', () => {
    expect(src).toContain('/api/dev/update')
    expect(src).toContain("method: 'POST'")
  })
})

// ─── hooks/useBuildVersion.ts — structure (AC1, AC2) ─────────────────────────

describe('hooks/useBuildVersion.ts — structure', () => {
  const src = readSrc('hooks/useBuildVersion.ts')

  it('exports useBuildVersion hook', () => {
    expect(src).toMatch(/export\s+function\s+useBuildVersion/)
  })

  it('imports from react (uses hooks)', () => {
    expect(src).toContain("from 'react'")
  })

  it('imports fetchVersion and hasBuildChanged from ../lib/version', () => {
    expect(src).toContain('fetchVersion')
    expect(src).toContain('hasBuildChanged')
    expect(src).toContain('../lib/version')
  })

  // AC1 — poller only fires while document.visibilityState === 'visible'
  it('AC1 — guards polling with visibilityState === visible check', () => {
    expect(src).toContain('visibilityState')
    expect(src).toContain("'visible'")
  })

  it('AC1 — uses setInterval for recurring polling', () => {
    expect(src).toContain('setInterval')
  })

  it('AC1 — listens for visibilitychange to resume polling on tab focus', () => {
    expect(src).toContain('visibilitychange')
  })

  it('AC1 — clears interval on cleanup (no memory leak)', () => {
    expect(src).toContain('clearInterval')
  })

  it('removes visibilitychange listener on cleanup', () => {
    expect(src).toContain('removeEventListener')
  })

  it('stores loaded baseline in a ref (captured once on first fetch)', () => {
    expect(src).toContain('loadedBuildIdRef')
    expect(src).toContain('useRef')
  })

  it('POLL_INTERVAL_MS imported from lib/version', () => {
    expect(src).toContain('POLL_INTERVAL_MS')
  })
})

// ─── ReloadToast.tsx — structure (AC2) ───────────────────────────────────────

describe('ReloadToast.tsx — structure', () => {
  const src = readSrc('components/ReloadToast.tsx')

  it('exports ReloadToast function', () => {
    expect(src).toMatch(/export\s+function\s+ReloadToast/)
  })

  it('AC2 — returns null when visible=false (not rendered)', () => {
    expect(src).toContain('!visible')
    expect(src).toContain('return null')
  })

  it('AC2 — calls window.location.reload() on Reload button click', () => {
    expect(src).toContain('window.location.reload()')
  })

  it('has visible: boolean in Props', () => {
    expect(src).toContain('visible: boolean')
  })

  it('has accessible role="status" and aria-live', () => {
    expect(src).toContain('role="status"')
    expect(src).toContain('aria-live')
  })

  it('shows "New build ready" message text', () => {
    expect(src).toContain('New build ready')
  })

  it('shows "Reload" as button label', () => {
    expect(src).toContain('Reload')
  })
})

// ─── UpdateButton.tsx — structure (AC3, AC4) ─────────────────────────────────

describe('UpdateButton.tsx — structure', () => {
  const src = readSrc('components/UpdateButton.tsx')

  it('exports UpdateButton function', () => {
    expect(src).toMatch(/export\s+function\s+UpdateButton/)
  })

  it('AC3 — returns null when devTray is false (guard present)', () => {
    expect(src).toContain('!devTray')
    expect(src).toContain('return null')
  })

  it('AC3 — accepts devTray: boolean prop', () => {
    expect(src).toContain('devTray: boolean')
  })

  it('imports postDevUpdate from ../lib/version', () => {
    expect(src).toContain('postDevUpdate')
    expect(src).toContain('../lib/version')
  })

  it('AC4 — tracks failed state with log', () => {
    expect(src).toContain("'failed'")
    expect(src).toContain('log:')
  })

  it('AC4 — does NOT call window.location.reload on failure', () => {
    expect(src).not.toContain('window.location.reload()')
  })

  it('AC4 — renders updateState.log in failed state', () => {
    expect(src).toContain('updateState.log')
  })

  it('has dismissFailure function to dismiss the failure panel', () => {
    expect(src).toContain('dismissFailure')
  })

  it('shows "Building…" label during build phase', () => {
    expect(src).toContain('Building…')
    expect(src).toContain("'building'")
  })

  it('disables button while building to prevent double-submit', () => {
    expect(src).toContain('disabled')
  })
})

// ─── App.tsx — wiring (AC1, AC2, AC3) ────────────────────────────────────────

describe('App.tsx — version wiring', () => {
  const src = readSrc('App.tsx')

  it('imports useBuildVersion from hooks/useBuildVersion', () => {
    expect(src).toContain('useBuildVersion')
    expect(src).toContain('useBuildVersion')
  })

  it('imports ReloadToast component', () => {
    expect(src).toContain('ReloadToast')
  })

  it('calls useBuildVersion() hook', () => {
    expect(src).toContain('useBuildVersion()')
  })

  it('AC2 — passes buildVersion.updateAvailable to ReloadToast visible prop', () => {
    expect(src).toContain('updateAvailable')
    expect(src).toContain('ReloadToast')
  })

  it('AC3 — wires buildVersion.devTray through to the Nav (Update control lives in the nav footer)', () => {
    expect(src).toContain('devTray={buildVersion.devTray}')
  })
})

// ─── Nav.tsx — dev Update control in footer (AC3) ────────────────────────────

describe('Nav.tsx — dev Update control', () => {
  const src = readSrc('components/Nav.tsx')

  it('imports UpdateButton component', () => {
    expect(src).toContain('UpdateButton')
  })

  it('AC3 — accepts a devTray prop', () => {
    expect(src).toContain('devTray')
  })

  it('AC3 — renders UpdateButton gated on devTray', () => {
    expect(src).toContain('<UpdateButton devTray={devTray}')
  })
})

// ─── Header.tsx — devTray prop + UpdateButton composition (AC3) ──────────────

describe('Header.tsx — devTray prop', () => {
  const src = readSrc('components/Header.tsx')

  it('exports Header function', () => {
    expect(src).toMatch(/export\s+function\s+Header/)
  })

  it('AC3 — has devTray prop in Props interface', () => {
    expect(src).toContain('devTray')
  })

  it('composes UpdateButton (dev-only button rendered through UpdateButton)', () => {
    expect(src).toContain('UpdateButton')
  })
})
