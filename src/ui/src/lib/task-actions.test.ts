import { describe, it, expect } from 'vitest'
import {
  primaryTarget,
  secondaryTargets,
  transitionLabel,
  requiresReason,
  targetTone,
} from './task-actions'
import { validTargets } from './transitions'
import type { TaskStatus } from '../types'

const ALL: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done', 'closed', 'draft', 'approved', 'archived']

describe('primaryTarget', () => {
  it('picks the natural forward step per status', () => {
    expect(primaryTarget('todo')).toBe('in_progress')
    expect(primaryTarget('in_progress')).toBe('done')
    expect(primaryTarget('blocked')).toBe('in_progress')
    expect(primaryTarget('draft')).toBe('approved')
    expect(primaryTarget('approved')).toBe('in_progress')
    expect(primaryTarget('closed')).toBe('todo')
    expect(primaryTarget('done')).toBe('closed')
  })

  it('returns null for terminal statuses with no valid forward edge', () => {
    expect(primaryTarget('archived')).toBeNull()
  })

  it('only ever returns a target that is actually a valid edge', () => {
    for (const s of ALL) {
      const p = primaryTarget(s)
      if (p !== null) expect(validTargets(s)).toContain(p)
    }
  })
})

describe('secondaryTargets', () => {
  it('is the valid targets minus the primary, for every status', () => {
    for (const s of ALL) {
      const primary = primaryTarget(s)
      const secondary = secondaryTargets(s)
      expect(secondary).toEqual(validTargets(s).filter((t) => t !== primary))
      expect(secondary).not.toContain(primary as TaskStatus)
    }
  })

  it('never contains an invalid target', () => {
    for (const s of ALL) {
      for (const t of secondaryTargets(s)) expect(validTargets(s)).toContain(t)
    }
  })

  it('in_progress secondary = [blocked, todo, approved] (done is primary)', () => {
    expect(secondaryTargets('in_progress')).toEqual(['blocked', 'todo', 'approved'])
  })

  it('archived has no secondary targets', () => {
    expect(secondaryTargets('archived')).toEqual([])
  })
})

describe('transitionLabel — from-aware intent', () => {
  it('→ in_progress is Start from todo, Resume from blocked/closed, Reopen from done', () => {
    expect(transitionLabel('todo', 'in_progress')).toBe('Start')
    expect(transitionLabel('approved', 'in_progress')).toBe('Start')
    expect(transitionLabel('blocked', 'in_progress')).toBe('Resume')
    expect(transitionLabel('closed', 'in_progress')).toBe('Resume')
    expect(transitionLabel('done', 'in_progress')).toBe('Reopen')
  })

  it('→ todo is Reopen from closed, Send to todo otherwise', () => {
    expect(transitionLabel('closed', 'todo')).toBe('Reopen')
    expect(transitionLabel('in_progress', 'todo')).toBe('Send to todo')
    expect(transitionLabel('blocked', 'todo')).toBe('Send to todo')
  })

  it('fixed labels for the remaining targets', () => {
    expect(transitionLabel('in_progress', 'done')).toBe('Mark done')
    expect(transitionLabel('done', 'closed')).toBe('Complete')
    expect(transitionLabel('todo', 'blocked')).toBe('Block')
    expect(transitionLabel('draft', 'approved')).toBe('Promote')
    expect(transitionLabel('approved', 'draft')).toBe('Back to draft')
  })
})

describe('requiresReason', () => {
  it('is true only for blocked', () => {
    expect(requiresReason('blocked')).toBe(true)
    for (const t of ALL.filter((s) => s !== 'blocked')) expect(requiresReason(t)).toBe(false)
  })
})

describe('targetTone', () => {
  it('maps targets to the status-* palette tone', () => {
    expect(targetTone('done')).toBe('green')
    expect(targetTone('closed')).toBe('green')
    expect(targetTone('blocked')).toBe('amber')
    expect(targetTone('in_progress')).toBe('blue')
    expect(targetTone('todo')).toBe('blue')
    expect(targetTone('approved')).toBe('blue')
    expect(targetTone('draft')).toBe('neutral')
    expect(targetTone('archived')).toBe('neutral')
  })
})
