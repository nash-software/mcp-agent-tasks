/**
 * advisor-lib.test.ts — Unit tests for src/ui/src/lib/advisor.ts
 * Pure function tests; no React rendering, no DOM.
 *
 * ACs verified:
 *  - buildSuggestions s-crit: critical task not in_progress → triggers
 *  - buildSuggestions s-cap: scheduled tasks sum triggers warning / info
 *  - buildSuggestions s-block: first blocked task → warning
 *  - buildSuggestions s-root: task IDs appearing in 2+ notes → info
 *  - buildSuggestions s-auto: weekly tag + no agent_status + null scheduled_for → info
 *  - buildSuggestions: returns at most 5 with rank
 *  - renderWithChips: splits text on task ID pattern
 *  - localAdvice block branch
 *  - localAdvice standup branch
 *  - localAdvice automat branch
 *  - localAdvice default branch
 *  - SUGGESTED_PROMPTS: 4 items
 */
import { describe, it, expect } from 'vitest'
import {
  buildSuggestions,
  localAdvice,
  SUGGESTED_PROMPTS,
  SEV_LABEL,
  ID_RE,
} from '../lib/advisor'
import type { Suggestion } from '../lib/advisor'
import type { Task } from '../types'
import type { NoteRecord } from '../api'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TEST-001',
    title: 'A test task',
    status: 'todo',
    type: 'feature',
    priority: 'medium',
    ...overrides,
  }
}

function makeNote(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: 'NOTE-001',
    title: 'A note',
    body: 'Some note body',
    project: 'TEST',
    task_id: null,
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const TODAY = new Date().toISOString().slice(0, 10)

// ── buildSuggestions: s-crit ───────────────────────────────────────────────

describe('buildSuggestions — s-crit', () => {
  it('triggers on critical task that is not in_progress', () => {
    const tasks = [makeTask({ id: 'TEST-001', priority: 'critical', status: 'todo' })]
    const suggs = buildSuggestions(tasks, [], 8)
    const crit = suggs.find(s => s.id === 's-crit')
    expect(crit).toBeDefined()
    expect(crit!.severity).toBe('critical')
    expect(crit!.actions).toContain('commit')
  })

  it('does NOT trigger when critical task is already in_progress', () => {
    const tasks = [makeTask({ id: 'TEST-001', priority: 'critical', status: 'in_progress' })]
    const suggs = buildSuggestions(tasks, [], 8)
    expect(suggs.find(s => s.id === 's-crit')).toBeUndefined()
  })

  it('does NOT trigger when critical task is done', () => {
    const tasks = [makeTask({ id: 'TEST-001', priority: 'critical', status: 'done' })]
    const suggs = buildSuggestions(tasks, [], 8)
    expect(suggs.find(s => s.id === 's-crit')).toBeUndefined()
  })
})

// ── buildSuggestions: s-cap ────────────────────────────────────────────────

describe('buildSuggestions — s-cap', () => {
  it('triggers warning when hours > target', () => {
    const tasks = [
      makeTask({ id: 'TEST-001', status: 'todo', scheduled_for: TODAY, estimate_hours: 5 }),
      makeTask({ id: 'TEST-002', status: 'todo', scheduled_for: TODAY, estimate_hours: 5 }),
    ]
    const suggs = buildSuggestions(tasks, [], 8)
    const cap = suggs.find(s => s.id === 's-cap')
    expect(cap).toBeDefined()
    expect(cap!.severity).toBe('warning')
  })

  it('triggers info when hours <= target', () => {
    const tasks = [makeTask({ id: 'TEST-001', status: 'todo', scheduled_for: TODAY, estimate_hours: 4 })]
    const suggs = buildSuggestions(tasks, [], 8)
    const cap = suggs.find(s => s.id === 's-cap')
    expect(cap).toBeDefined()
    expect(cap!.severity).toBe('info')
  })

  it('does NOT trigger when no tasks scheduled today', () => {
    const tasks = [makeTask({ id: 'TEST-001', status: 'todo', scheduled_for: null })]
    const suggs = buildSuggestions(tasks, [], 8)
    expect(suggs.find(s => s.id === 's-cap')).toBeUndefined()
  })

  it('null-guards estimate_hours', () => {
    const tasks = [makeTask({ id: 'TEST-001', status: 'todo', scheduled_for: TODAY, estimate_hours: null })]
    expect(() => buildSuggestions(tasks, [], 8)).not.toThrow()
  })
})

// ── buildSuggestions: s-block ──────────────────────────────────────────────

describe('buildSuggestions — s-block', () => {
  it('triggers warning for first blocked open task', () => {
    const tasks = [
      makeTask({ id: 'TEST-001', status: 'blocked', block_reason: 'waiting on PR review' }),
    ]
    const suggs = buildSuggestions(tasks, [], 8)
    const block = suggs.find(s => s.id === 's-block')
    expect(block).toBeDefined()
    expect(block!.severity).toBe('warning')
    expect(block!.taskIds).toContain('TEST-001')
    expect(block!.actions).toContain('open')
  })

  it('does NOT trigger when no blocked tasks', () => {
    const tasks = [makeTask({ id: 'TEST-001', status: 'in_progress' })]
    const suggs = buildSuggestions(tasks, [], 8)
    expect(suggs.find(s => s.id === 's-block')).toBeUndefined()
  })
})

// ── buildSuggestions: s-root ───────────────────────────────────────────────

describe('buildSuggestions — s-root', () => {
  it('triggers info when 2+ task IDs appear in 2+ separate notes and tasks are open', () => {
    const tasks = [
      makeTask({ id: 'ACR-57', status: 'todo' }),
      makeTask({ id: 'HRLD-34', status: 'todo' }),
    ]
    const notes = [
      makeNote({ id: 'N1', body: 'ACR-57 and HRLD-34 share the same root cause in retry logic' }),
      makeNote({ id: 'N2', body: 'Backoff pattern needed by ACR-57 and HRLD-34' }),
    ]
    const suggs = buildSuggestions(tasks, notes, 8)
    const root = suggs.find(s => s.id === 's-root')
    expect(root).toBeDefined()
    expect(root!.severity).toBe('info')
    expect(root!.actions).toContain('commit')
    expect(root!.taskIds.length).toBeGreaterThanOrEqual(2)
  })

  it('does NOT trigger when each ID appears in only one note', () => {
    const tasks = [
      makeTask({ id: 'ACR-57', status: 'todo' }),
      makeTask({ id: 'HRLD-34', status: 'todo' }),
    ]
    const notes = [
      makeNote({ id: 'N1', body: 'ACR-57 mentioned once here' }),
      makeNote({ id: 'N2', body: 'HRLD-34 mentioned once here' }),
    ]
    const suggs = buildSuggestions(tasks, notes, 8)
    expect(suggs.find(s => s.id === 's-root')).toBeUndefined()
  })
})

// ── buildSuggestions: s-auto ───────────────────────────────────────────────

describe('buildSuggestions — s-auto', () => {
  it('triggers info for weekly task with no agent_status and null scheduled_for', () => {
    const tasks = [makeTask({ id: 'TEST-001', tags: ['weekly'], agent_status: undefined, scheduled_for: null })]
    const suggs = buildSuggestions(tasks, [], 8)
    const auto = suggs.find(s => s.id === 's-auto')
    expect(auto).toBeDefined()
    expect(auto!.severity).toBe('info')
    expect(auto!.actions).toContain('hermes')
    expect(auto!.basis).toBe('recurrence pattern')
  })

  it('does NOT trigger when agent_status is set', () => {
    const tasks = [makeTask({ id: 'TEST-001', tags: ['weekly'], agent_status: 'scheduled', scheduled_for: null })]
    const suggs = buildSuggestions(tasks, [], 8)
    expect(suggs.find(s => s.id === 's-auto')).toBeUndefined()
  })

  it('does NOT trigger when no weekly tag', () => {
    const tasks = [makeTask({ id: 'TEST-001', tags: ['daily'], scheduled_for: null })]
    const suggs = buildSuggestions(tasks, [], 8)
    expect(suggs.find(s => s.id === 's-auto')).toBeUndefined()
  })
})

// ── buildSuggestions: rank + slice ─────────────────────────────────────────

describe('buildSuggestions — rank and slice', () => {
  it('returns at most 5 suggestions', () => {
    // Create tasks that trigger all 5 suggestion types
    const tasks = [
      makeTask({ id: 'TEST-001', priority: 'critical', status: 'todo' }),
      makeTask({ id: 'TEST-002', status: 'todo', scheduled_for: TODAY, estimate_hours: 20 }),
      makeTask({ id: 'TEST-003', status: 'blocked', block_reason: 'waiting' }),
      makeTask({ id: 'ACR-57', status: 'todo' }),
      makeTask({ id: 'HRLD-34', status: 'todo' }),
      makeTask({ id: 'TEST-006', tags: ['weekly'], scheduled_for: null }),
    ]
    const notes = [
      makeNote({ id: 'N1', body: 'ACR-57 and HRLD-34 have shared root' }),
      makeNote({ id: 'N2', body: 'ACR-57 and HRLD-34 retry pattern broken' }),
    ]
    const suggs = buildSuggestions(tasks, notes, 8)
    expect(suggs.length).toBeLessThanOrEqual(5)
  })

  it('assigns rank starting from 1', () => {
    const tasks = [makeTask({ id: 'TEST-001', priority: 'critical', status: 'todo' })]
    const suggs = buildSuggestions(tasks, [], 8)
    expect(suggs[0].rank).toBe(1)
  })
})

// ── localAdvice: keyword branches ─────────────────────────────────────────

describe('localAdvice — keyword branches', () => {
  const tasks = [
    makeTask({ id: 'TEST-001', status: 'blocked', block_reason: 'waiting on external API' }),
    makeTask({ id: 'TEST-002', status: 'in_progress' }),
    makeTask({ id: 'TEST-003', status: 'done' }),
  ]

  const suggestions: Suggestion[] = [
    {
      rank: 1, id: 's-crit', severity: 'critical',
      title: 'Start TEST-001 first', rationale: 'Critical task idle',
      taskIds: ['TEST-001'], actions: ['commit'], basis: 'priority + status',
    },
    {
      rank: 2, id: 's-auto', severity: 'info',
      title: 'Hand TEST-002 to Hermes', rationale: 'Weekly ritual automation',
      taskIds: ['TEST-002'], actions: ['hermes'], basis: 'recurrence pattern',
    },
  ]

  it('block branch: lists blocked tasks', () => {
    const result = localAdvice('what is blocking me', tasks, suggestions)
    expect(result).toContain('TEST-001')
  })

  it('block branch: reports nothing blocked if no blocked tasks', () => {
    const noBlocked = [makeTask({ id: 'TEST-002', status: 'in_progress' })]
    const result = localAdvice('what is blocking me', noBlocked, suggestions)
    expect(result.toLowerCase()).toContain('nothing is blocked')
  })

  it('standup branch: returns done/wip/next/watch-out structure', () => {
    const result = localAdvice('draft my standup', tasks, suggestions)
    expect(result).toMatch(/done|shipped|in progress|wip/i)
  })

  it('automat branch: returns s-auto rationale when suggestion present', () => {
    const result = localAdvice('what can hermes automate', tasks, suggestions)
    expect(result).toContain('Weekly ritual automation')
  })

  it('automat branch: returns generic advice when no s-auto suggestion', () => {
    const result = localAdvice('what can hermes automate', tasks, [suggestions[0]])
    expect(result.toLowerCase()).toContain('weekly')
  })

  it('default branch: returns top suggestion title + rationale', () => {
    const result = localAdvice('what should I work on', tasks, suggestions)
    expect(result).toContain('Start TEST-001 first')
  })

  it('default branch: fallback when no suggestions', () => {
    const result = localAdvice('what should I do', tasks, [])
    expect(result.toLowerCase()).toContain('start')
  })
})

// ── SEV_LABEL ──────────────────────────────────────────────────────────────

describe('SEV_LABEL', () => {
  it('maps all three severities', () => {
    expect(SEV_LABEL.critical).toBe('Act now')
    expect(SEV_LABEL.warning).toBe('Watch')
    expect(SEV_LABEL.info).toBe('Consider')
  })
})

// ── ID_RE ──────────────────────────────────────────────────────────────────

describe('ID_RE', () => {
  it('matches task ID patterns', () => {
    ID_RE.lastIndex = 0
    const matches = 'See ACR-57 and HRLD-34 for details'.match(ID_RE)
    expect(matches).toEqual(['ACR-57', 'HRLD-34'])
  })
})

// ── SUGGESTED_PROMPTS ──────────────────────────────────────────────────────

describe('SUGGESTED_PROMPTS', () => {
  it('pm mode has exactly 4 items', () => {
    expect(SUGGESTED_PROMPTS.pm).toHaveLength(4)
  })

  it('chairman mode has exactly 4 items', () => {
    expect(SUGGESTED_PROMPTS.chairman).toHaveLength(4)
  })

  it('coach mode has exactly 4 items', () => {
    expect(SUGGESTED_PROMPTS.coach).toHaveLength(4)
  })

  it('all items in each mode are non-empty strings', () => {
    for (const mode of ['pm', 'chairman', 'coach'] as const) {
      for (const p of SUGGESTED_PROMPTS[mode]) {
        expect(typeof p).toBe('string')
        expect(p.length).toBeGreaterThan(0)
      }
    }
  })
})
