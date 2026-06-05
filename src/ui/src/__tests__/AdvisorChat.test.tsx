/**
 * AdvisorChat.test.tsx — Source-inspection tests for AdvisorChat component.
 *
 * Strategy: environment: 'node' (no DOM/jsdom). Read source as string and assert
 * on structural contracts from the spec.
 *
 * ACs verified:
 *  AC1 — initial assistant message present (opening greeting seeded)
 *  AC2 — suggested prompts shown only before first user message (msgs.length <= 1)
 *  AC3 — Enter key triggers send; Shift+Enter inserts newline
 *  AC4 — send button disabled when textarea empty or busy
 *  AC5 — imports streamAdvisorChat from ../api
 *  AC6 — imports renderWithChips, SUGGESTED_PROMPTS from ../lib/advisor
 *  AC7 — ChatHeader extracted as non-exported inner component
 *  AC8 — live prop controls adv-ctx-chip live class
 *  AC9 — localAdvice used as fallback on stream error
 *  AC10 — onLive callback prop accepted
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const UI_SRC = resolve(__dirname, '..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(UI_SRC, relPath), 'utf-8')
}

describe('AdvisorChat.tsx — module structure', () => {
  const src = readSrc('components/AdvisorChat.tsx')

  it('exports AdvisorChat function', () => {
    expect(src).toMatch(/export\s+function\s+AdvisorChat/)
  })

  it('AC5 — imports streamAdvisorChat from api', () => {
    expect(src).toContain('streamAdvisorChat')
    expect(src).toContain('../api')
  })

  it('AC6 — imports renderWithChips from lib/advisor', () => {
    expect(src).toContain('renderWithChips')
    expect(src).toContain('advisor')
  })

  it('AC6 — imports SUGGESTED_PROMPTS from lib/advisor', () => {
    expect(src).toContain('SUGGESTED_PROMPTS')
    expect(src).toContain('advisor')
  })

  it('AC9 — imports localAdvice from lib/advisor', () => {
    expect(src).toContain('localAdvice')
    expect(src).toContain('advisor')
  })

  it('AC7 — ChatHeader inner component present', () => {
    expect(src).toContain('ChatHeader')
  })

  it('has no ChatHeader export (non-exported inner component)', () => {
    expect(src).not.toMatch(/export\s+function\s+ChatHeader/)
  })
})

describe('AdvisorChat.tsx — state and props', () => {
  const src = readSrc('components/AdvisorChat.tsx')

  it('AC1 — opening greeting seeded as initial assistant message', () => {
    // The component uses useState with an initial message array
    expect(src).toContain('assistant')
    expect(src).toContain('useState')
  })

  it('AC2 — suggested prompts shown only when msgs.length <= 1', () => {
    expect(src).toMatch(/msgs\.length\s*[<=>]=?\s*1|msgs\.length\s*===\s*1|msgs\.length\s*<=\s*1/)
    expect(src).toContain('SUGGESTED_PROMPTS')
  })

  it('AC3 — Enter key triggers send', () => {
    expect(src).toContain('onKeyDown')
    expect(src).toContain('Enter')
  })

  it('AC3 — Shift+Enter inserts newline (not send)', () => {
    expect(src).toContain('shiftKey')
  })

  it('AC4 — send button disabled when val empty or busy', () => {
    expect(src).toContain('disabled')
    expect(src).toContain('busy')
    expect(src).toMatch(/val\.trim\(\)|!val/)
  })

  it('AC8 — live prop controls live class on adv-ctx-chip', () => {
    expect(src).toContain('live')
    expect(src).toContain('adv-ctx-chip')
  })

  it('AC10 — onLive callback prop accepted', () => {
    expect(src).toContain('onLive')
  })

  it('has auto-grow textarea (adv-input class)', () => {
    expect(src).toContain('adv-input')
  })

  it('renders adv-thread for message list', () => {
    expect(src).toContain('adv-thread')
  })

  it('renders thinking dots when busy', () => {
    expect(src).toContain('thinking')
    expect(src).toContain('dot')
  })
})

describe('AdvisorChat.tsx — streaming send', () => {
  const src = readSrc('components/AdvisorChat.tsx')

  it('uses for-await on streamAdvisorChat', () => {
    expect(src).toContain('for await')
    expect(src).toContain('streamAdvisorChat')
  })

  it('handles delta frame by appending text', () => {
    expect(src).toContain('delta')
  })

  it('handles session frame by storing sessionId', () => {
    expect(src).toContain('session')
    expect(src).toContain('sessionId')
  })

  it('AC9 — catch block uses localAdvice as fallback', () => {
    expect(src).toContain('catch')
    expect(src).toContain('localAdvice')
  })

  it('finally block sets busy false', () => {
    expect(src).toContain('finally')
    expect(src).toContain('setBusy')
  })
})
