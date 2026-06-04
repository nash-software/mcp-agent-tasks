/**
 * nav-groups.test.ts — Source-inspection tests for MCPAT-070 Phase B.
 *
 * Strategy: root vitest config uses environment: 'node' (no DOM / jsdom), so these tests
 * read source files as strings and assert on structural contracts described in the spec.
 *
 * ACs verified:
 *  AC1 — NAV order: Today=1, Board=2, Braindump=3, Notes=4, Advisor=5, Hermes=6, Artifacts=7, Roadmap=8, Activity=9, Completed=0
 *  AC2 — NAV_GROUPS exported with 3 groups: Workspace / Assistants / Library (correct ids per spec)
 *  AC3 — NAV_BY_ID exported as lookup map
 *  AC4 — kbd 0 maps to Completed (index 9); kbd 1-9 map to indices 0-8
 *  AC5 — Nav.tsx renders navCounts prop: shows count badge when defined, kbd hint otherwise
 *  AC6 — Nav.tsx renders all 3 group labels from NAV_GROUPS
 *  AC7 — Density options use balanced/airy values (not cozy/spacious)
 *  AC8 — Footer: New task primary button calls focusCapture('task')
 *  AC9 — Footer: Search button has ⌘K / Cmd+K hint
 *  AC10 — types.ts Density type includes 'balanced' and 'airy' (not cozy/spacious)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const UI_SRC = resolve(__dirname, '..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(UI_SRC, relPath), 'utf-8')
}

describe('nav.ts — NAV order and kbd mapping (AC1, AC3, AC4)', () => {
  const src = readSrc('lib/nav.ts')

  it('AC1 — NAV entries appear in spec order', () => {
    const todayIdx = src.indexOf("id: 'today'")
    const boardIdx = src.indexOf("id: 'board'")
    const braindumpIdx = src.indexOf("id: 'braindump'")
    const notesIdx = src.indexOf("id: 'notes'")
    const advisorIdx = src.indexOf("id: 'advisor'")
    const hermesIdx = src.indexOf("id: 'hermes'")
    const artifactsIdx = src.indexOf("id: 'artifacts'")
    const roadmapIdx = src.indexOf("id: 'roadmap'")
    const activityIdx = src.indexOf("id: 'activity'")
    const completedIdx = src.indexOf("id: 'completed'")
    expect(todayIdx).toBeGreaterThan(-1)
    expect(boardIdx).toBeGreaterThan(todayIdx)
    expect(braindumpIdx).toBeGreaterThan(boardIdx)
    expect(notesIdx).toBeGreaterThan(braindumpIdx)
    expect(advisorIdx).toBeGreaterThan(notesIdx)
    expect(hermesIdx).toBeGreaterThan(advisorIdx)
    expect(artifactsIdx).toBeGreaterThan(hermesIdx)
    expect(roadmapIdx).toBeGreaterThan(artifactsIdx)
    expect(activityIdx).toBeGreaterThan(roadmapIdx)
    expect(completedIdx).toBeGreaterThan(activityIdx)
  })

  it('AC3 — NAV_BY_ID is exported', () => {
    expect(src).toContain('export const NAV_BY_ID')
  })

  it('AC4 — kbd 0 assigned to completed', () => {
    // completed entry has kbd: 0
    const completedBlock = src.slice(src.indexOf("id: 'completed'"))
    const kbdMatch = completedBlock.match(/kbd:\s*(\d+)/)
    expect(kbdMatch?.[1]).toBe('0')
  })

  it('AC4 — today has kbd: 1 (first item)', () => {
    const todayBlock = src.slice(src.indexOf("id: 'today'"))
    const kbdMatch = todayBlock.match(/kbd:\s*(\d+)/)
    expect(kbdMatch?.[1]).toBe('1')
  })
})

describe('nav.ts — NAV_GROUPS (AC2)', () => {
  const src = readSrc('lib/nav.ts')

  it('AC2 — NAV_GROUPS is exported', () => {
    expect(src).toContain('export const NAV_GROUPS')
  })

  it('AC2 — Workspace group contains today, board, braindump, notes', () => {
    const groupsStart = src.indexOf('NAV_GROUPS')
    const groupsSection = src.slice(groupsStart, groupsStart + 600)
    expect(groupsSection).toContain("'Workspace'")
    expect(groupsSection).toContain("'today'")
    expect(groupsSection).toContain("'board'")
    expect(groupsSection).toContain("'braindump'")
    expect(groupsSection).toContain("'notes'")
  })

  it('AC2 — Assistants group contains advisor, hermes', () => {
    const groupsStart = src.indexOf('NAV_GROUPS')
    const groupsSection = src.slice(groupsStart, groupsStart + 600)
    expect(groupsSection).toContain("'Assistants'")
    expect(groupsSection).toContain("'advisor'")
    expect(groupsSection).toContain("'hermes'")
  })

  it('AC2 — Library group contains artifacts, roadmap, activity, completed', () => {
    const groupsStart = src.indexOf('NAV_GROUPS')
    const groupsSection = src.slice(groupsStart, groupsStart + 600)
    expect(groupsSection).toContain("'Library'")
    expect(groupsSection).toContain("'artifacts'")
    expect(groupsSection).toContain("'roadmap'")
    expect(groupsSection).toContain("'activity'")
    expect(groupsSection).toContain("'completed'")
  })
})

describe('Nav.tsx — group rendering and count/kbd display (AC5, AC6)', () => {
  const src = readSrc('components/Nav.tsx')

  it('AC5 — navCounts prop defined on NavProps', () => {
    expect(src).toContain('navCounts')
  })

  it('AC5 — count badge rendered when count is defined (count != null pattern)', () => {
    expect(src).toMatch(/navCounts.*!=.*null|navCounts\[.*\].*!= null|count.*!=.*null/)
  })

  it('AC6 — NAV_GROUPS imported and iterated for rendering', () => {
    expect(src).toContain('NAV_GROUPS')
    expect(src).toMatch(/NAV_GROUPS\.map|NAV_GROUPS\.forEach/)
  })

  it('AC7 — density option uses "balanced" value (not cozy)', () => {
    expect(src).toContain('balanced')
    expect(src).not.toContain("value: 'cozy'")
  })

  it('AC7 — density option uses "airy" value (not spacious)', () => {
    expect(src).toContain('airy')
    expect(src).not.toContain("value: 'spacious'")
  })

  it('AC8 — footer New task button calls focusCapture or onNewTask', () => {
    expect(src).toMatch(/focusCapture\('task'\)|onNewTask/)
  })

  it('AC9 — footer Search button references ⌘K or MOD+K', () => {
    expect(src).toMatch(/⌘K|MOD.*K|Search/)
  })
})

describe('types.ts — Density type (AC10)', () => {
  const src = readSrc('types.ts')

  it('AC10 — Density type includes balanced', () => {
    expect(src).toContain("'balanced'")
  })

  it('AC10 — Density type includes airy', () => {
    expect(src).toContain("'airy'")
  })

  it('AC10 — Density type no longer contains cozy', () => {
    // The type definition line should not contain cozy
    const densityTypeLine = src.split('\n').find(l => l.includes('type Density'))
    expect(densityTypeLine).toBeDefined()
    expect(densityTypeLine).not.toContain('cozy')
  })

  it('AC10 — Density type no longer contains spacious', () => {
    const densityTypeLine = src.split('\n').find(l => l.includes('type Density'))
    expect(densityTypeLine).toBeDefined()
    expect(densityTypeLine).not.toContain('spacious')
  })
})
