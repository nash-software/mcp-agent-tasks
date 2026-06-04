/**
 * capture-mode-persistence.test.ts — Source-inspection tests for MCPAT-070 Phase A.
 *
 * Strategy: root vitest config uses environment: 'node' (no DOM / jsdom), so these tests
 * read source files as strings and assert on structural contracts described in the spec.
 * This follows the established source-inspection convention (capture-braindump-handoff.test.ts).
 *
 * ACs verified:
 *  AC1  — CaptureOverlay initialises mode state from localStorage('lifeos-capmode') with 'infer' fallback
 *  AC2  — CaptureOverlay persists mode to localStorage.setItem('lifeos-capmode', mode) via useEffect
 *  AC3  — useCaptureOverlay exports focusCapture (not just focus)
 *  AC4  — useCaptureOverlay.registerFocus callback accepts optional mode arg: (fn: (mode?: CaptureMode) => void)
 *  AC5  — .capture-input-wrap has data-mode={mode} binding
 *  AC6  — Placeholder for 'infer' mode matches prototype string exactly
 *  AC7  — Placeholder for 'task' mode matches prototype string exactly
 *  AC8  — Placeholder for 'note' mode matches prototype string exactly
 *  AC9  — Flash text "Captured as task" appears in component (infer→task case)
 *  AC10 — Flash text "Noted" appears in component (note case)
 *  AC11 — App.tsx passes focusCapture (not just focus) to useGlobalKeyboard
 *  AC12 — App.tsx Nav onNewTask calls focusCapture with 'task' mode
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const UI_SRC = resolve(__dirname, '..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(UI_SRC, relPath), 'utf-8')
}

// ─── Source files under test ─────────────────────────────────────────────────

const captureOverlay   = readSrc('components/CaptureOverlay.tsx')
const useCaptureHook   = readSrc('hooks/useCaptureOverlay.ts')
const appSrc           = readSrc('App.tsx')

// ─── CaptureOverlay.tsx — localStorage persistence (AC1, AC2) ───────────────

describe('CaptureOverlay.tsx — localStorage mode persistence', () => {
  it('AC1: initialises mode state from localStorage("lifeos-capmode") with infer fallback', () => {
    // Must call localStorage.getItem('lifeos-capmode')
    expect(captureOverlay).toMatch(/localStorage\.getItem\s*\(\s*['"]lifeos-capmode['"]\s*\)/)
    // Must have a try/catch fallback returning 'infer'
    expect(captureOverlay).toMatch(/return\s+'infer'/)
  })

  it('AC2: persists mode change to localStorage.setItem("lifeos-capmode", mode) via useEffect', () => {
    expect(captureOverlay).toMatch(/localStorage\.setItem\s*\(\s*['"]lifeos-capmode['"]/)
    // Must be inside a useEffect that depends on mode
    expect(captureOverlay).toMatch(/\[mode\]/)
  })
})

// ─── useCaptureOverlay.ts — focusCapture + CaptureMode type (AC3, AC4) ──────

describe('useCaptureOverlay.ts — focusCapture signature', () => {
  it('AC3: exports focusCapture (not just .focus)', () => {
    expect(useCaptureHook).toMatch(/focusCapture/)
  })

  it('AC3: does NOT export a plain .focus property as the primary focus method', () => {
    // After the refactor, the returned object should have focusCapture, not focus
    expect(useCaptureHook).not.toMatch(/focus\s*:\s*\(\s*\)\s*=>/)
    expect(useCaptureHook).not.toMatch(/\{\s*registerFocus,\s*focus\s*\}/)
  })

  it('AC4: registerFocus callback type accepts optional mode arg: (fn: (mode?: CaptureMode) => void)', () => {
    // registerFocus type must accept a callback that takes optional CaptureMode
    expect(useCaptureHook).toMatch(/mode\?:\s*CaptureMode/)
  })

  it('AC4: exports CaptureMode type', () => {
    expect(useCaptureHook).toMatch(/export\s+type\s+CaptureMode/)
  })
})

// ─── CaptureOverlay.tsx — data-mode attribute (AC5) ─────────────────────────

describe('CaptureOverlay.tsx — data-mode attribute', () => {
  it('AC5: capture-input-wrap div has data-mode={mode} binding', () => {
    expect(captureOverlay).toMatch(/data-mode\s*=\s*\{mode\}/)
  })
})

// ─── CaptureOverlay.tsx — placeholder strings (AC6, AC7, AC8) ───────────────

describe('CaptureOverlay.tsx — placeholder text per mode', () => {
  it("AC6: infer placeholder matches prototype exactly", () => {
    expect(captureOverlay).toMatch(
      /Capture anything — I'll sort it into a task or note · ⇧Enter to expand · #project/
    )
  })

  it('AC7: task placeholder matches prototype exactly', () => {
    expect(captureOverlay).toMatch(
      /New task — Enter to add · #project to route it/
    )
  })

  it('AC8: note placeholder matches prototype exactly', () => {
    expect(captureOverlay).toMatch(
      /Jot a note — Enter to save · #project/
    )
  })
})

// ─── CaptureOverlay.tsx — flash feedback (AC9, AC10) ────────────────────────

describe('CaptureOverlay.tsx — flash feedback text', () => {
  it('AC9: flash text "Captured as task" appears for infer→task case', () => {
    expect(captureOverlay).toMatch(/Captured as task/)
  })

  it('AC10: flash text "Noted" appears for note case', () => {
    expect(captureOverlay).toMatch(/Noted/)
  })
})

// ─── App.tsx wiring (AC11, AC12) ─────────────────────────────────────────────

describe('App.tsx — focusCapture wiring', () => {
  it('AC11: passes capture.focusCapture (not capture.focus) to useGlobalKeyboard', () => {
    // Must use focusCapture: capture.focusCapture
    expect(appSrc).toMatch(/focusCapture\s*:\s*capture\.focusCapture/)
    // Must NOT use capture.focus (old wiring)
    expect(appSrc).not.toMatch(/focusCapture\s*:\s*capture\.focus(?!Capture)/)
  })

  it("AC12: Nav onNewTask calls focusCapture with 'task' mode", () => {
    // onNewTask={() => capture.focusCapture('task')}
    expect(appSrc).toMatch(/onNewTask\s*=\s*\{\s*\(\s*\)\s*=>\s*capture\.focusCapture\s*\(\s*'task'\s*\)\s*\}/)
  })
})
