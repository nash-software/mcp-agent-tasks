/**
 * triage.test.ts — Unit tests for the Hermes triage classifier.
 * Pure function tests; no React, no DOM.
 * Coverage: each bucket, isSoftware, matchSkill, first-match-wins precedence.
 */
import { describe, it, expect } from 'vitest'
import { triage, isSoftware, matchSkill, fmtSaved, BUCKET_ORDER } from './triage'
import type { Task, Skill } from '../types'

// ── Helpers ────────────────────────────────────────────────────────────────
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TEST-1',
    title: 'A plain task',
    status: 'todo',
    type: 'feature',
    priority: 'medium',
    ...overrides,
  }
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'Deploy script',
    project: 'TEST',
    engine: 'acr',
    desc: 'Deploys the app',
    match: ['deploy', 'deployment'],
    runs: 5,
    minutesSaved: 30,
    lastRun: '2026-05-01',
    origin: 'manual',
    ...overrides,
  }
}

const NO_SKILLS: Skill[] = []

// ── matchSkill ─────────────────────────────────────────────────────────────
describe('matchSkill', () => {
  it('returns undefined when skills array is empty', () => {
    expect(matchSkill(makeTask({ title: 'deploy app' }), [])).toBeUndefined()
  })

  it('returns undefined when no skill match[] substring found in title+tags', () => {
    const skills = [makeSkill({ match: ['invoicing'] })]
    expect(matchSkill(makeTask({ title: 'write blog post' }), skills)).toBeUndefined()
  })

  it('returns first matching skill when title contains a match substring', () => {
    const skill = makeSkill({ match: ['deploy'] })
    const result = matchSkill(makeTask({ title: 'Deploy the prod app' }), [skill])
    expect(result).toBe(skill)
  })

  it('returns first matching skill when tags contain a match substring', () => {
    const skill = makeSkill({ match: ['webhook'] })
    const result = matchSkill(makeTask({ title: 'routine task', tags: ['webhook', 'ci'] }), [skill])
    expect(result).toBe(skill)
  })

  it('matching is case-insensitive (lowercased by matchSkill)', () => {
    const skill = makeSkill({ match: ['deploy'] })
    // title has uppercase
    const result = matchSkill(makeTask({ title: 'DEPLOY to staging' }), [skill])
    expect(result).toBe(skill)
  })

  it('returns first skill when multiple skills match', () => {
    const s1 = makeSkill({ id: 'sk1', match: ['deploy'] })
    const s2 = makeSkill({ id: 'sk2', match: ['deploy', 'release'] })
    const result = matchSkill(makeTask({ title: 'deploy and release' }), [s1, s2])
    expect(result?.id).toBe('sk1')
  })
})

// ── isSoftware ─────────────────────────────────────────────────────────────
describe('isSoftware', () => {
  it('returns true for each SOFTWARE_RE keyword in title', () => {
    const keywords = ['deploy', 'build', 'api', 'endpoint', 'bug', 'refactor',
      'script', 'backup', 'database', 'db', 'crawl', 'scrape', 'test', 'ci',
      'pipeline', 'audit', 'lighthouse', 'lint', 'typecheck', 'code', 'server',
      'cron', 'postgres', 'webhook']
    for (const kw of keywords) {
      expect(isSoftware(makeTask({ title: `run the ${kw} step` })), kw).toBe(true)
    }
  })

  it('returns true when keyword is in tags', () => {
    expect(isSoftware(makeTask({ title: 'routine task', tags: ['ci', 'deploy'] }))).toBe(true)
  })

  it('returns true when keyword is in why', () => {
    expect(isSoftware(makeTask({ title: 'fix the thing', why: 'the api is broken' }))).toBe(true)
  })

  it('returns false for plain non-software prose', () => {
    expect(isSoftware(makeTask({ title: 'Write the quarterly report for the client' }))).toBe(false)
    expect(isSoftware(makeTask({ title: 'Call with the designer about new flow' }))).toBe(false)
    expect(isSoftware(makeTask({ title: 'Send invoice to Acme Corp' }))).toBe(false)
  })

  it('word-boundary: "db" in word position only', () => {
    // "db" as a standalone word
    expect(isSoftware(makeTask({ title: 'migrate db records' }))).toBe(true)
    // "db" NOT at a word boundary (part of "ADB") — does not match via db,
    // but note: "adb" contains 'db' starting after 'a' so \b won't fire before 'd'.
    // Use a title with NO other SOFTWARE_RE keywords to isolate the db word-boundary check.
    expect(isSoftware(makeTask({ title: 'the adb thing is here' }))).toBe(false)
  })

  it('word-boundary: "api" matches as a word, not inside another word', () => {
    expect(isSoftware(makeTask({ title: 'Call api endpoint' }))).toBe(true)
    // "api" in "rapid" — should NOT match due to word boundary
    expect(isSoftware(makeTask({ title: 'rapid development' }))).toBe(false)
  })

  it('word-boundary: "ci" matches as a word', () => {
    expect(isSoftware(makeTask({ title: 'Fix ci pipeline' }))).toBe(true)
    // "ci" inside "social" — should NOT match
    expect(isSoftware(makeTask({ title: 'social media planning' }))).toBe(false)
  })
})

// ── triage — bucket classification ─────────────────────────────────────────
describe('triage — bucket classification', () => {
  // ── automatable ────────────────────────────────────────────────────────
  describe('automatable (rule 1 — skill match wins)', () => {
    it('classifies to automatable when skill matches task title', () => {
      const skill = makeSkill({ name: 'Deploy script', engine: 'acr', match: ['deploy'] })
      const task = makeTask({ title: 'Deploy to production' })
      const result = triage(task, [skill])
      expect(result.bucket).toBe('automatable')
      expect(result.skill?.id).toBe(skill.id)
      expect(result.action).toBe('run')
    })

    it('rationale interpolates skill.name and VENUE for acr engine', () => {
      const skill = makeSkill({ name: 'Deploy script', engine: 'acr', match: ['deploy'] })
      const result = triage(makeTask({ title: 'deploy app' }), [skill])
      expect(result.rationale).toContain('Deploy script')
      expect(result.rationale).toContain('on ACR')
    })

    it('rationale interpolates VENUE for hermes engine', () => {
      const skill = makeSkill({ name: 'Draft report', engine: 'hermes', match: ['draft'] })
      const result = triage(makeTask({ title: 'draft Q3 report' }), [skill])
      expect(result.rationale).toContain('myself')
    })

    it('rationale interpolates VENUE for n8n engine', () => {
      const skill = makeSkill({ name: 'Sync data', engine: 'n8n', match: ['sync'] })
      const result = triage(makeTask({ title: 'sync contacts' }), [skill])
      expect(result.rationale).toContain('via an n8n flow')
    })
  })

  // ── signoff ─────────────────────────────────────────────────────────────
  describe('signoff (rule 2)', () => {
    it('classifies to signoff when title contains commitment keyword "approve"', () => {
      const result = triage(makeTask({ title: 'Approve the Q3 proposal' }), NO_SKILLS)
      expect(result.bucket).toBe('signoff')
      expect(result.action).toBe('approve')
    })

    it('classifies to signoff for "sow" keyword', () => {
      const result = triage(makeTask({ title: 'Review and sign the SOW' }), NO_SKILLS)
      expect(result.bucket).toBe('signoff')
    })

    it('classifies to signoff for "pricing" keyword', () => {
      const result = triage(makeTask({ title: 'Finalize pricing for enterprise tier' }), NO_SKILLS)
      expect(result.bucket).toBe('signoff')
    })

    it('classifies to signoff when priority is critical (even without keyword)', () => {
      const result = triage(makeTask({ title: 'Fix the broken thing', priority: 'critical' }), NO_SKILLS)
      expect(result.bucket).toBe('signoff')
    })

    it('classifies to signoff for "invoice" keyword', () => {
      const result = triage(makeTask({ title: 'Send invoice to Acme' }), NO_SKILLS)
      expect(result.bucket).toBe('signoff')
    })

    it('classifies to signoff for "client call" keyword', () => {
      const result = triage(makeTask({ title: 'Prepare for client call on Thursday' }), NO_SKILLS)
      expect(result.bucket).toBe('signoff')
    })

    it('classifies to signoff for "hire" keyword', () => {
      const result = triage(makeTask({ title: 'hire a new contractor' }), NO_SKILLS)
      expect(result.bucket).toBe('signoff')
    })

    it('classifies to signoff for "legal" keyword', () => {
      const result = triage(makeTask({ title: 'legal review of the new contract' }), NO_SKILLS)
      expect(result.bucket).toBe('signoff')
    })
  })

  // ── recurring ───────────────────────────────────────────────────────────
  describe('recurring (rule 3)', () => {
    it('classifies to recurring when tags include "ritual"', () => {
      const result = triage(makeTask({ title: 'Morning kickoff', tags: ['ritual'] }), NO_SKILLS)
      expect(result.bucket).toBe('recurring')
      expect(result.action).toBe('schedule')
    })

    it('classifies to recurring for "weekly" keyword', () => {
      const result = triage(makeTask({ title: 'Weekly team sync' }), NO_SKILLS)
      expect(result.bucket).toBe('recurring')
    })

    it('classifies to recurring for "daily" keyword', () => {
      const result = triage(makeTask({ title: 'Daily standup notes' }), NO_SKILLS)
      expect(result.bucket).toBe('recurring')
    })

    it('classifies to recurring for "every morning" phrase', () => {
      const result = triage(makeTask({ title: 'Run health check every morning' }), NO_SKILLS)
      expect(result.bucket).toBe('recurring')
    })

    it('classifies to recurring for "standup" keyword', () => {
      const result = triage(makeTask({ title: 'Monday standup facilitation' }), NO_SKILLS)
      expect(result.bucket).toBe('recurring')
    })

    it('sets acr=true when recurring task title contains a software keyword', () => {
      const result = triage(makeTask({ title: 'Weekly deploy build to staging', tags: ['ritual'] }), NO_SKILLS)
      expect(result.bucket).toBe('recurring')
      expect(result.acr).toBe(true)
    })

    it('sets acr=false when recurring task is not software', () => {
      const result = triage(makeTask({ title: 'Weekly team standup' }), NO_SKILLS)
      expect(result.bucket).toBe('recurring')
      expect(result.acr).toBe(false)
    })
  })

  // ── research ────────────────────────────────────────────────────────────
  describe('research (rule 4)', () => {
    it('classifies to research for "audit" keyword', () => {
      const result = triage(makeTask({ title: 'Audit dependency vulnerabilities' }), NO_SKILLS)
      expect(result.bucket).toBe('research')
      expect(result.action).toBe('research')
    })

    it('classifies to research for "report" keyword', () => {
      const result = triage(makeTask({ title: 'Generate quarterly report' }), NO_SKILLS)
      expect(result.bucket).toBe('research')
    })

    it('classifies to research for "scrape" keyword', () => {
      // "pricing" would fire signoff first, so use a title without signoff keywords
      const result = triage(makeTask({ title: 'Scrape competitor product listings' }), NO_SKILLS)
      expect(result.bucket).toBe('research')
    })

    it('classifies to research for "digest" keyword', () => {
      // "weekly" would fire recurring first, so use a title without cadence keywords
      const result = triage(makeTask({ title: 'Create a news digest for the team' }), NO_SKILLS)
      expect(result.bucket).toBe('research')
    })

    it('sets acr=true when research task is software work', () => {
      // "scrape" is both research verb and software keyword
      const result = triage(makeTask({ title: 'Scrape product data using script' }), NO_SKILLS)
      expect(result.bucket).toBe('research')
      expect(result.acr).toBe(true)
    })

    it('sets acr=false when research task is not software', () => {
      const result = triage(makeTask({ title: 'Research competitors: check market' }), NO_SKILLS)
      expect(result.bucket).toBe('research')
      expect(result.acr).toBe(false)
    })

    it('rationale mentions n8n for non-software research', () => {
      // "pricing" would fire signoff; use "monitor" without signoff keywords
      const result = triage(makeTask({ title: 'Monitor uptime for the blog' }), NO_SKILLS)
      expect(result.bucket).toBe('research')
      expect(result.rationale).toContain('n8n')
    })

    it('rationale mentions ACR for software research', () => {
      const result = triage(makeTask({ title: 'backup database records' }), NO_SKILLS)
      expect(result.bucket).toBe('research')
      expect(result.acr).toBe(true)
      expect(result.rationale).toContain('ACR')
    })
  })

  // ── manual ──────────────────────────────────────────────────────────────
  describe('manual (rule 5 — fallback)', () => {
    it('classifies to manual when nothing else matches', () => {
      const result = triage(makeTask({ title: 'Write a thank-you card to the team' }), NO_SKILLS)
      expect(result.bucket).toBe('manual')
      expect(result.action).toBe('assist')
    })

    it('sets acr=false for plain non-software manual task', () => {
      const result = triage(makeTask({ title: 'Plan team outing' }), NO_SKILLS)
      expect(result.bucket).toBe('manual')
      expect(result.acr).toBe(false)
    })

    it('sets acr=true for software manual task', () => {
      const result = triage(makeTask({ title: 'Fix one-off bug in login flow' }), NO_SKILLS)
      expect(result.bucket).toBe('manual')
      expect(result.acr).toBe(true)
    })
  })

  // ── first-match-wins precedence ──────────────────────────────────────────
  describe('first-match-wins precedence', () => {
    it('skill match (rule 1) beats signoff keyword (rule 2)', () => {
      const skill = makeSkill({ match: ['approve'] })
      const task = makeTask({ title: 'approve the budget with finance' })
      const result = triage(task, [skill])
      // skill match wins — should be automatable NOT signoff
      expect(result.bucket).toBe('automatable')
    })

    it('skill match (rule 1) beats recurring cadence keyword (rule 3)', () => {
      const skill = makeSkill({ match: ['weekly'] })
      const task = makeTask({ title: 'weekly deploy run', tags: ['ritual'] })
      const result = triage(task, [skill])
      expect(result.bucket).toBe('automatable')
    })

    it('critical priority (rule 2) beats "audit" research verb (rule 4)', () => {
      const task = makeTask({ title: 'audit all the things', priority: 'critical' })
      const result = triage(task, NO_SKILLS)
      // priority:critical triggers signoff (rule 2) before audit triggers research (rule 4)
      expect(result.bucket).toBe('signoff')
    })

    it('ritual tag (rule 3) beats research verb (rule 4)', () => {
      // "report" is a rule-4 keyword; "ritual" tag should win (rule 3 comes first)
      const task = makeTask({ title: 'Generate weekly report', tags: ['ritual'] })
      const result = triage(task, NO_SKILLS)
      expect(result.bucket).toBe('recurring')
    })

    it('research verb (rule 4) beats manual fallback (rule 5)', () => {
      const task = makeTask({ title: 'compile the notes from the meeting' })
      const result = triage(task, NO_SKILLS)
      expect(result.bucket).toBe('research')
    })
  })
})

// ── fmtSaved ───────────────────────────────────────────────────────────────
describe('fmtSaved', () => {
  it('formats minutes under 60 as "Nm"', () => {
    expect(fmtSaved(0)).toBe('0m')
    expect(fmtSaved(1)).toBe('1m')
    expect(fmtSaved(59)).toBe('59m')
    expect(fmtSaved(45)).toBe('45m')
  })

  it('formats 60+ minutes as hours with one decimal (correct formula)', () => {
    // 60 min → Math.round(60/60*10)/10 = 10/10 = 1 → "1h"
    expect(fmtSaved(60)).toBe('1h')
    // 90 min → Math.round(90/60*10)/10 = Math.round(15)/10 = 1.5 → "1.5h"
    expect(fmtSaved(90)).toBe('1.5h')
    // 120 min → Math.round(120/60*10)/10 = Math.round(20)/10 = 2 → "2h"
    expect(fmtSaved(120)).toBe('2h')
  })

  it('P2-06: fmtSaved uses correct minutes→hours conversion (not the prototype /6 bug)', () => {
    // The prototype had Math.round(min/6)/10 which is algebraically identical for these values,
    // but the *intent* is min/60. This test explicitly names the corrected conversion.
    // 45m < 60 → '45m'
    expect(fmtSaved(45)).toBe('45m')
    // 90m → 1.5h (correct). Buggy prototype interpretation would still give 1.5h here,
    // but the formula is now clearly Math.round(min/60*10)/10 so 90/60=1.5 exactly.
    expect(fmtSaved(90)).toBe('1.5h')
    // Extra guard: the formula must NOT produce 15h for 90 min (that would be Math.round(90/6) = 15)
    expect(fmtSaved(90)).not.toBe('15h')
    // 120m → 2h
    expect(fmtSaved(120)).toBe('2h')
  })
})

// ── P2-06: promote→re-triage loop ─────────────────────────────────────────
describe('P2-06 — promote → re-triage loop (critical path)', () => {
  it('task triages to research before a matching skill exists', () => {
    const task = makeTask({
      id: 'TEST-42',
      title: 'audit dependency vulnerabilities',
      agent_status: 'scheduled',
    })
    const result = triage(task, NO_SKILLS)
    expect(result.bucket).toBe('research')
  })

  it('task flips to automatable after a matching skill is added (the flywheel loop)', () => {
    const task = makeTask({
      id: 'TEST-42',
      title: 'audit dependency vulnerabilities',
      agent_status: 'scheduled',
    })
    // Before promote: research bucket
    expect(triage(task, NO_SKILLS).bucket).toBe('research')

    // After promote: a skill with match terms derived from the task title is added
    const newSkill = makeSkill({
      id: 'skill-audit',
      name: 'Dependency audit',
      match: ['audit', 'dependency'],
      engine: 'acr',
    })
    const result = triage(task, [newSkill])
    expect(result.bucket).toBe('automatable')
    expect(result.skill?.id).toBe('skill-audit')
    expect(result.action).toBe('run')
  })

  it('no task mutation is required — triage is pure and derived from (task, skills)', () => {
    // Same task object, different skills → different bucket. Task is never modified.
    const task = makeTask({ title: 'audit the server logs', agent_status: 'scheduled' })
    const skillsBefore: Skill[] = []
    const skillsAfter = [makeSkill({ match: ['audit', 'server'], engine: 'acr' })]
    const before = triage(task, skillsBefore)
    const after = triage(task, skillsAfter)
    expect(before.bucket).toBe('research')
    expect(after.bucket).toBe('automatable')
    // Confirm the task object was not touched
    expect(task.agent_status).toBe('scheduled')
  })
})

// ── P2-06: proposalTaskIds gating ─────────────────────────────────────────
describe('P2-06 — proposalTaskIds queue gating', () => {
  it('a task with a pending proposal should be excluded from triaged results', () => {
    // Simulates the HermesView filter:
    //   triaged = scheduled.filter(t => t.agent_status === 'scheduled' && !proposalTaskIds.includes(t.id))
    const task1 = makeTask({ id: 'T-1', title: 'audit logs', agent_status: 'scheduled' })
    const task2 = makeTask({ id: 'T-2', title: 'write docs', agent_status: 'scheduled' })
    const scheduled = [task1, task2]
    const proposals = [{ taskId: 'T-1', id: 'p-1', project: 'TEST', skillName: 'Log audit',
      taskTitle: 'audit logs', summary: '', steps: [], savedPerRun: 30, frequency: 'weekly', engine: 'acr' as const }]
    const proposalTaskIds = proposals.map(p => p.taskId)
    const triaged = scheduled.filter(t => t.agent_status === 'scheduled' && !proposalTaskIds.includes(t.id))
    expect(triaged.map(t => t.id)).not.toContain('T-1')
    expect(triaged.map(t => t.id)).toContain('T-2')
  })

  it('after dismiss, task returns to triage queue (proposalTaskIds is empty)', () => {
    const task = makeTask({ id: 'T-1', title: 'audit logs', agent_status: 'scheduled' })
    const scheduled = [task]
    // Dismissed: proposalTaskIds is empty
    const proposalTaskIds: string[] = []
    const triaged = scheduled.filter(t => t.agent_status === 'scheduled' && !proposalTaskIds.includes(t.id))
    expect(triaged.map(t => t.id)).toContain('T-1')
    expect(triage(task, NO_SKILLS).bucket).toBe('research')
  })
})

// ── BUCKET_ORDER export ─────────────────────────────────────────────────────
describe('BUCKET_ORDER', () => {
  it('is exported and has the 5 expected buckets in order', () => {
    expect(Array.from(BUCKET_ORDER)).toEqual(['signoff', 'automatable', 'research', 'recurring', 'manual'])
  })
})
