import { describe, it, expect } from 'vitest'
import { isValidBoardTransition, BOARD_STATUSES, COLUMN_LABEL } from './transitions'

describe('isValidBoardTransition', () => {
  it('returns false when from === to (same column, no-op)', () => {
    for (const s of BOARD_STATUSES) {
      expect(isValidBoardTransition(s, s)).toBe(false)
    }
  })

  // State machine: todo → [in_progress, blocked] only
  it('todo → in_progress is valid', () => {
    expect(isValidBoardTransition('todo', 'in_progress')).toBe(true)
  })
  it('todo → blocked is valid', () => {
    expect(isValidBoardTransition('todo', 'blocked')).toBe(true)
  })
  it('todo → done is INVALID', () => {
    expect(isValidBoardTransition('todo', 'done')).toBe(false)
  })

  // in_progress → [done, blocked, todo, approved]
  it('in_progress → done is valid', () => {
    expect(isValidBoardTransition('in_progress', 'done')).toBe(true)
  })
  it('in_progress → blocked is valid', () => {
    expect(isValidBoardTransition('in_progress', 'blocked')).toBe(true)
  })
  it('in_progress → todo is valid', () => {
    expect(isValidBoardTransition('in_progress', 'todo')).toBe(true)
  })

  // blocked → [in_progress, todo]
  it('blocked → in_progress is valid', () => {
    expect(isValidBoardTransition('blocked', 'in_progress')).toBe(true)
  })
  it('blocked → todo is valid', () => {
    expect(isValidBoardTransition('blocked', 'todo')).toBe(true)
  })
  it('blocked → done is INVALID', () => {
    expect(isValidBoardTransition('blocked', 'done')).toBe(false)
  })

  // done → [in_progress, closed] — closed is not a board column but still valid on the server
  it('done → in_progress is valid', () => {
    expect(isValidBoardTransition('done', 'in_progress')).toBe(true)
  })
  it('done → todo is INVALID', () => {
    expect(isValidBoardTransition('done', 'todo')).toBe(false)
  })
  it('done → blocked is INVALID', () => {
    expect(isValidBoardTransition('done', 'blocked')).toBe(false)
  })

  // closed is reopenable (P5-05); archived stays terminal
  it('closed → todo and closed → in_progress are VALID (reopen, P5-05)', () => {
    expect(isValidBoardTransition('closed', 'todo')).toBe(true)
    expect(isValidBoardTransition('closed', 'in_progress')).toBe(true)
  })
  it('closed → done is INVALID (not a reopen target)', () => {
    expect(isValidBoardTransition('closed', 'done')).toBe(false)
  })
  it('archived → in_progress is INVALID (archived is terminal)', () => {
    expect(isValidBoardTransition('archived', 'in_progress')).toBe(false)
  })
})

describe('BOARD_STATUSES', () => {
  it('contains exactly the four working statuses', () => {
    expect([...BOARD_STATUSES].sort()).toEqual(['blocked', 'done', 'in_progress', 'todo'].sort())
  })
})

describe('COLUMN_LABEL', () => {
  it('has a label for every board status', () => {
    for (const s of BOARD_STATUSES) {
      expect(COLUMN_LABEL[s]).toBeTruthy()
    }
  })
})
