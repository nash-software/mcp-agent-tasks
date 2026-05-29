/**
 * capture-braindump-handoff.test.ts — Source-inspection tests for the P2-03 capture → Brain Dump
 * handoff wiring.
 *
 * Strategy: since the root vitest config uses environment: 'node' (no DOM / jsdom), these tests
 * read source files as strings and assert on the structural contracts described in the spec rather
 * than rendering React components. This is the established "source-inspection convention" used
 * elsewhere in this project (see filter.test.ts, triage.test.ts).
 *
 * ACs verified:
 *  1 & 2 — Shift+Enter and expand icon both fire onExpand (CaptureOverlay already wired in P1-06)
 *  3     — Capture bar clears text after handoff (CaptureOverlay calls setText('') in handleExpand)
 *  4     — Seed consumed exactly once: BrainDumpView calls onSeedConsumed() in the nonce effect
 *  5     — Fresh handoff re-triggers: effect keys on seedNonce, not on initialText value
 *  FM    — Empty/whitespace text → no-op in App handleCaptureExpand
 *          The nonce disambiguates identical text (Date.now() nonce per handoff)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const UI_SRC = resolve(__dirname, '..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(UI_SRC, relPath), 'utf-8')
}

// ─── Source files under test ────────────────────────────────────────────────

const appSrc          = readSrc('App.tsx')
const captureOverlay  = readSrc('components/CaptureOverlay.tsx')
const brainDumpView   = readSrc('views/BrainDumpView.tsx')

// ─── App.tsx wiring ─────────────────────────────────────────────────────────

describe('App.tsx — P2-03 handoff wiring', () => {
  it('defines BrainDumpSeed interface with text and nonce fields', () => {
    expect(appSrc).toMatch(/interface BrainDumpSeed/)
    expect(appSrc).toMatch(/text:\s*string/)
    expect(appSrc).toMatch(/nonce:\s*number/)
  })

  it('declares brainDumpSeed state initialised to null', () => {
    // useState<BrainDumpSeed | null>(null)
    expect(appSrc).toMatch(/useState<BrainDumpSeed\s*\|\s*null>\s*\(\s*null\s*\)/)
  })

  it('handleCaptureExpand trims text and returns early on empty/whitespace (Failure Mode)', () => {
    // Must trim and guard with early return
    expect(appSrc).toMatch(/const trimmed\s*=\s*text\.trim\(\)/)
    expect(appSrc).toMatch(/if\s*\(\s*trimmed\s*===\s*''\s*\)\s*return/)
  })

  it('handleCaptureExpand sets brainDumpSeed with text and a unique monotonic nonce', () => {
    expect(appSrc).toMatch(/setBrainDumpSeed\s*\(\s*\{\s*text/)
    // Monotonic counter (collision-free), not Date.now() which can repeat within a millisecond.
    expect(appSrc).toMatch(/nonce:\s*seedNonceRef\.current/)
    expect(appSrc).not.toMatch(/nonce:\s*Date\.now\(\)/)
  })

  it('handleCaptureExpand switches view to braindump', () => {
    // Must call handleViewChange('braindump') or setView('braindump')
    expect(appSrc).toMatch(/handleViewChange\s*\(\s*'braindump'\s*\)/)
  })

  it('passes initialText from brainDumpSeed to BrainDumpView', () => {
    expect(appSrc).toMatch(/initialText\s*=\s*\{brainDumpSeed\?\.text\}/)
  })

  it('passes seedNonce from brainDumpSeed to BrainDumpView', () => {
    expect(appSrc).toMatch(/seedNonce\s*=\s*\{brainDumpSeed\?\.nonce\}/)
  })

  it('passes onSeedConsumed that nulls brainDumpSeed (consume-once, AC 4)', () => {
    // onSeedConsumed={() => { setBrainDumpSeed(null) }}
    expect(appSrc).toMatch(/onSeedConsumed/)
    expect(appSrc).toMatch(/setBrainDumpSeed\s*\(\s*null\s*\)/)
  })
})

// ─── CaptureOverlay.tsx — produce side ─────────────────────────────────────

describe('CaptureOverlay.tsx — P1-06 affordances (produce side)', () => {
  it('accepts an onExpand prop typed as (text: string) => void', () => {
    expect(captureOverlay).toMatch(/onExpand\s*:\s*\(text:\s*string\)\s*=>\s*void/)
  })

  it('Shift+Enter calls handleExpand (AC 1)', () => {
    expect(captureOverlay).toMatch(/e\.key\s*===\s*'Enter'\s*&&\s*e\.shiftKey/)
    expect(captureOverlay).toMatch(/handleExpand\(\)/)
  })

  it('expand icon button calls handleExpand (AC 2)', () => {
    // The button's onClick is handleExpand
    expect(captureOverlay).toMatch(/onClick\s*=\s*\{handleExpand\}/)
  })

  it('handleExpand calls onExpand(text) then clears input (AC 3)', () => {
    // handleExpand should call onExpand with text, then setText('')
    expect(captureOverlay).toMatch(/onExpand\s*\(\s*text\s*\)/)
    expect(captureOverlay).toMatch(/setText\s*\(\s*''\s*\)/)
  })
})

// ─── BrainDumpView.tsx — consume side ───────────────────────────────────────

describe('BrainDumpView.tsx — P2-03 consumer side', () => {
  it('accepts initialText, seedNonce, and onSeedConsumed props', () => {
    expect(brainDumpView).toMatch(/initialText\?:\s*string/)
    expect(brainDumpView).toMatch(/seedNonce\?:\s*number/)
    expect(brainDumpView).toMatch(/onSeedConsumed\?:\s*\(\s*\)\s*=>\s*void/)
  })

  it('prefill effect keys on seedNonce (not initialText value) — guards AC 5 and identical-text re-trigger', () => {
    // The useEffect dependency array must contain [seedNonce] (with or without an eslint comment)
    // Matches: }, [seedNonce]) — the closing of a useEffect whose only dep is seedNonce
    expect(brainDumpView).toMatch(/\},\s*\[seedNonce\]/)
  })

  it('prefill effect guards against null/empty inputs before applying', () => {
    expect(brainDumpView).toMatch(/if\s*\(\s*seedNonce\s*==\s*null/)
    expect(brainDumpView).toMatch(/initialText\s*==\s*null\s*\|\|\s*initialText\s*===\s*''/)
  })

  it('prefill effect sets dump to initialText', () => {
    expect(brainDumpView).toMatch(/setDump\s*\(\s*initialText\s*\)/)
  })

  it('prefill effect calls onSeedConsumed() to enforce consume-once (AC 4)', () => {
    expect(brainDumpView).toMatch(/onSeedConsumed\?\.\(\)/)
  })

  it('prefill effect focuses the textarea and moves caret to end', () => {
    expect(brainDumpView).toMatch(/el\.focus\(\)/)
    expect(brainDumpView).toMatch(/el\.setSelectionRange\s*\(\s*el\.value\.length/)
  })
})
