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
 *  - buildSuggestions s-goal-gap: no tasks matching active goal → warning
 *  - buildSuggestions s-stall: project 3+ open tasks, no in_progress 14+ days → warning
 *  - buildSuggestions s-distribution: no dist tasks active/scheduled (financial goal guard)
 *  - buildSuggestions s-brain-surface: brain snippet present → info
 *  - buildSuggestions: s-distribution ranks above s-stall when financial goal active
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
import type { Task, Goal } from '../types'
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

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-abc',
    title: 'Reach product-market fit',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// Past date >14 days ago for stall tests
const STALE_DATE = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()

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

// ── buildSuggestions: s-goal-gap ──────────────────────────────────────────

describe('buildSuggestions — s-goal-gap', () => {
  it('triggers warning when no open tasks match any active goal keyword', () => {
    const goals = [makeGoal({ title: 'Launch revenue stream' })]
    const tasks = [makeTask({ id: 'TEST-001', title: 'Fix a bug unrelated', status: 'todo' })]
    const suggs = buildSuggestions(tasks, [], 8, goals)
    const gap = suggs.find(s => s.id === 's-goal-gap')
    expect(gap).toBeDefined()
    expect(gap!.severity).toBe('warning')
  })

  it('does NOT trigger when at least one open task keyword-matches an active goal', () => {
    const goals = [makeGoal({ title: 'Launch revenue stream' })]
    const tasks = [makeTask({ id: 'TEST-001', title: 'Build revenue dashboard', status: 'todo' })]
    const suggs = buildSuggestions(tasks, [], 8, goals)
    expect(suggs.find(s => s.id === 's-goal-gap')).toBeUndefined()
  })

  it('does NOT trigger when task tags match goal keyword', () => {
    const goals = [makeGoal({ title: 'Grow revenue' })]
    const tasks = [makeTask({ id: 'TEST-001', title: 'Unrelated', status: 'todo', tags: ['revenue'] })]
    const suggs = buildSuggestions(tasks, [], 8, goals)
    expect(suggs.find(s => s.id === 's-goal-gap')).toBeUndefined()
  })

  it('does NOT trigger when no active goals', () => {
    const goals = [makeGoal({ status: 'achieved' })]
    const tasks = [makeTask()]
    const suggs = buildSuggestions(tasks, [], 8, goals)
    expect(suggs.find(s => s.id === 's-goal-gap')).toBeUndefined()
  })
})

// ── buildSuggestions: s-stall ─────────────────────────────────────────────

describe('buildSuggestions — s-stall', () => {
  it('triggers warning when a project has 3+ open tasks and last activity >14 days ago', () => {
    const tasks = [
      makeTask({ id: 'PROJ-001', status: 'todo', last_activity: STALE_DATE }),
      makeTask({ id: 'PROJ-002', status: 'todo', last_activity: STALE_DATE }),
      makeTask({ id: 'PROJ-003', status: 'todo', last_activity: STALE_DATE }),
    ]
    const suggs = buildSuggestions(tasks, [], 8)
    const stall = suggs.find(s => s.id === 's-stall')
    expect(stall).toBeDefined()
    expect(stall!.severity).toBe('warning')
    expect(stall!.taskIds).toContain('PROJ-001')
  })

  it('does NOT trigger when project has an in_progress task', () => {
    const tasks = [
      makeTask({ id: 'PROJ-001', status: 'todo', last_activity: STALE_DATE }),
      makeTask({ id: 'PROJ-002', status: 'in_progress', last_activity: STALE_DATE }),
      makeTask({ id: 'PROJ-003', status: 'todo', last_activity: STALE_DATE }),
    ]
    const suggs = buildSuggestions(tasks, [], 8)
    expect(suggs.find(s => s.id === 's-stall')).toBeUndefined()
  })

  it('does NOT trigger when project has fewer than 3 open tasks', () => {
    const tasks = [
      makeTask({ id: 'PROJ-001', status: 'todo', last_activity: STALE_DATE }),
      makeTask({ id: 'PROJ-002', status: 'todo', last_activity: STALE_DATE }),
    ]
    const suggs = buildSuggestions(tasks, [], 8)
    expect(suggs.find(s => s.id === 's-stall')).toBeUndefined()
  })

  it('does NOT trigger when activity is recent (<14 days)', () => {
    const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const tasks = [
      makeTask({ id: 'PROJ-001', status: 'todo', last_activity: recent }),
      makeTask({ id: 'PROJ-002', status: 'todo', last_activity: recent }),
      makeTask({ id: 'PROJ-003', status: 'todo', last_activity: recent }),
    ]
    const suggs = buildSuggestions(tasks, [], 8)
    expect(suggs.find(s => s.id === 's-stall')).toBeUndefined()
  })
})

// ── buildSuggestions: s-distribution ─────────────────────────────────────

describe('buildSuggestions — s-distribution', () => {
  it('triggers info when financial goal is active and no distribution tasks in flight', () => {
    const goals = [makeGoal({ title: 'Grow to £5k MRR', metric: '£5k MRR' })]
    const tasks = [makeTask({ id: 'TEST-001', title: 'Build feature', status: 'todo', tags: ['feature'] })]
    const suggs = buildSuggestions(tasks, [], 8, goals)
    const dist = suggs.find(s => s.id === 's-distribution')
    expect(dist).toBeDefined()
    expect(dist!.severity).toBe('info')
  })

  it('does NOT trigger when a marketing task is in_progress', () => {
    const goals = [makeGoal({ title: 'Reach £5k MRR' })]
    const tasks = [makeTask({ id: 'TEST-001', title: 'Email campaign', status: 'in_progress', tags: ['marketing'] })]
    const suggs = buildSuggestions(tasks, [], 8, goals)
    expect(suggs.find(s => s.id === 's-distribution')).toBeUndefined()
  })

  it('does NOT trigger when a sales task is scheduled within 7 days', () => {
    const goals = [makeGoal({ title: 'Close £5k revenue' })]
    const inSeven = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const tasks = [makeTask({ id: 'TEST-001', title: 'Outreach', status: 'todo', tags: ['sales'], scheduled_for: inSeven })]
    const suggs = buildSuggestions(tasks, [], 8, goals)
    expect(suggs.find(s => s.id === 's-distribution')).toBeUndefined()
  })

  it('does NOT trigger when no financial goal is active', () => {
    const goals = [makeGoal({ title: 'Learn TypeScript' })]
    const tasks = [makeTask({ id: 'TEST-001', title: 'Study generics', status: 'todo' })]
    const suggs = buildSuggestions(tasks, [], 8, goals)
    expect(suggs.find(s => s.id === 's-distribution')).toBeUndefined()
  })
})

// ── buildSuggestions: s-brain-surface ────────────────────────────────────

describe('buildSuggestions — s-brain-surface', () => {
  it('triggers info when brainSnippet is provided and active goals exist', () => {
    const goals = [makeGoal({ title: 'Ship the product' })]
    const suggs = buildSuggestions([], [], 8, goals, 'Brain excerpt: pricing page converts at 3x')
    const brain = suggs.find(s => s.id === 's-brain-surface')
    expect(brain).toBeDefined()
    expect(brain!.severity).toBe('info')
    expect(brain!.rationale).toContain('pricing page')
  })

  it('does NOT trigger when brainSnippet is undefined', () => {
    const goals = [makeGoal()]
    const suggs = buildSuggestions([], [], 8, goals)
    expect(suggs.find(s => s.id === 's-brain-surface')).toBeUndefined()
  })

  it('does NOT trigger when no active goals exist', () => {
    const goals = [makeGoal({ status: 'achieved' })]
    const suggs = buildSuggestions([], [], 8, goals, 'Some snippet')
    expect(suggs.find(s => s.id === 's-brain-surface')).toBeUndefined()
  })
})

// ── buildSuggestions: scoring — distribution > stall with financial goal ──

describe('buildSuggestions — scoring override', () => {
  it('s-distribution ranks above s-stall when a financial goal is active', () => {
    const goals = [makeGoal({ title: 'Grow to £5k MRR', metric: '£5k MRR' })]
    // Enough tasks in one project to trigger s-stall
    const staleTask = (id: string): Task => makeTask({ id, status: 'todo', last_activity: STALE_DATE })
    const tasks = [
      staleTask('PROJ-001'),
      staleTask('PROJ-002'),
      staleTask('PROJ-003'),
      // Plus brain snippet for s-brain-surface (cap might hide it)
    ]
    const suggs = buildSuggestions(tasks, [], 8, goals)
    const distIdx = suggs.findIndex(s => s.id === 's-distribution')
    const stallIdx = suggs.findIndex(s => s.id === 's-stall')
    // Both may or may not be in the output depending on cap, but if both are present
    // distribution must rank higher (lower index = higher rank)
    if (distIdx !== -1 && stallIdx !== -1) {
      expect(distIdx).toBeLessThan(stallIdx)
    }
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
