/**
 * ActionCard.test.tsx — Source-inspection tests for the ActionCard component.
 *
 * Strategy: environment: 'node' (no DOM/jsdom). Read source as string and assert
 * on structural contracts from the spec.
 *
 * ACs verified:
 *  AC1  — ActionCard exported as named export
 *  AC2  — renders type badge (Task / Note / Milestone) in pending state
 *  AC3  — Approve button fires approveAction from api
 *  AC4  — double-approve guard: status !== 'pending' check prevents second call
 *  AC5  — Dismiss collapses the card (returns null when dismissed)
 *  AC6  — Edit opens inline form (editing state with title input)
 *  AC7  — max-3 cap is enforced by AdvisorChat (not ActionCard itself)
 *  AC8  — confirmed state renders chip with created_id
 *  AC9  — error state shows inline error message with Retry button
 *  AC10 — imports approveAction from '../api'
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const UI_SRC = resolve(__dirname, '..')

function readSrc(relPath: string): string {
  return readFileSync(resolve(UI_SRC, relPath), 'utf-8')
}

describe('ActionCard.tsx — module structure', () => {
  const src = readSrc('components/ActionCard.tsx')

  it('AC1 — ActionCard is exported as named export', () => {
    expect(src).toMatch(/export\s+function\s+ActionCard/)
  })

  it('AC10 — imports approveAction from ../api', () => {
    expect(src).toContain('approveAction')
    expect(src).toContain('../api')
  })

  it('imports ActionDraft type', () => {
    expect(src).toContain('ActionDraft')
    expect(src).toContain('../types')
  })

  it('has ActionCardProps interface', () => {
    expect(src).toContain('ActionCardProps')
    expect(src).toContain('draft: ActionDraft')
  })
})

describe('ActionCard.tsx — states', () => {
  const src = readSrc('components/ActionCard.tsx')

  it('AC2 — type badges for all three action types', () => {
    expect(src).toContain('create_task')
    expect(src).toContain('create_note')
    expect(src).toContain('set_milestone')
    expect(src).toContain("'Task'")
    expect(src).toContain("'Note'")
    expect(src).toContain("'Milestone'")
  })

  it('AC5 — returns null when status is dismissed', () => {
    expect(src).toContain("status === 'dismissed'")
    expect(src).toContain('return null')
  })

  it('AC8 — confirmed state renders with confirmed chip', () => {
    expect(src).toContain("status === 'approved'")
    expect(src).toContain('confirmedId')
    expect(src).toContain('action-card confirmed')
  })

  it('AC9 — error state shows error message and Retry button', () => {
    expect(src).toContain('errorMsg')
    expect(src).toContain('Retry')
    expect(src).toContain('action-card-error')
  })

  it('AC6 — Edit opens inline form', () => {
    expect(src).toContain('editing')
    expect(src).toContain('action-card-edit-title')
    expect(src).toContain('Save & Create')
  })

  it('Approve/Edit/Dismiss buttons in pending state', () => {
    expect(src).toContain('Approve')
    expect(src).toContain('Edit')
    expect(src).toContain('Dismiss')
  })
})

describe('ActionCard.tsx — double-approve guard', () => {
  const src = readSrc('components/ActionCard.tsx')

  it('AC4 — guard: only proceeds when status is pending', () => {
    expect(src).toContain("draft.status !== 'pending'")
    expect(src).toMatch(/if\s*\(draft\.status\s*!==\s*'pending'\)\s*return/)
  })

  it('AC3 — calls approveAction on approve', () => {
    expect(src).toContain('approveAction(')
    expect(src).toContain('handleApprove')
  })

  it('onStatusChange called with approved before async call', () => {
    expect(src).toContain("onStatusChange(draft.id, 'approved')")
  })

  it('resets to pending on failure (retry path)', () => {
    expect(src).toContain("onStatusChange(draft.id, 'pending')")
  })
})

describe('ActionCard.tsx — edit flow', () => {
  const src = readSrc('components/ActionCard.tsx')

  it('edit state has title input', () => {
    expect(src).toContain('editTitle')
    expect(src).toContain('action-card-edit-title')
  })

  it('edit state has priority selector for create_task', () => {
    expect(src).toContain('editPriority')
    expect(src).toContain('action-card-edit-priority')
    expect(src).toContain('create_task')
  })

  it('project selector shown when projects prop has entries', () => {
    expect(src).toContain('editProject')
    expect(src).toContain('action-card-edit-project')
    expect(src).toContain('projects.length')
  })

  it('Save & Create fires handleSaveAndCreate', () => {
    expect(src).toContain('handleSaveAndCreate')
    expect(src).toContain('Save & Create')
  })
})

describe('AdvisorChat.tsx — action_draft integration', () => {
  const src = readSrc('components/AdvisorChat.tsx')

  it('imports ActionCard', () => {
    expect(src).toContain('ActionCard')
    expect(src).toContain('./ActionCard')
  })

  it('imports ActionDraft type', () => {
    expect(src).toContain('ActionDraft')
    expect(src).toContain('../types')
  })

  it('has actionDraftMap state', () => {
    expect(src).toContain('actionDraftMap')
    expect(src).toContain('Map')
  })

  it('handles action_draft frame from stream', () => {
    expect(src).toMatch(/frame\.type\s*===\s*['"]action_draft['"]/)
  })

  it('AC7 — max-3 cap enforced via existing.length >= 3 guard', () => {
    expect(src).toMatch(/existing\.length\s*>=\s*3/)
  })

  it('renders ActionCard components below assistant messages', () => {
    expect(src).toContain('<ActionCard')
    expect(src).toContain('action-cards')
  })

  it('accepts projects prop', () => {
    expect(src).toContain('projects')
    expect(src).toContain('projects?: string[]')
  })

  it('handleDraftStatusChange updates map entry', () => {
    expect(src).toContain('handleDraftStatusChange')
    expect(src).toContain('onStatusChange')
  })
})

describe('api.ts — action_draft frame', () => {
  const src = readSrc('api.ts')

  it('AdvisorChatFrame union includes action_draft variant', () => {
    expect(src).toContain("type: 'action_draft'")
    expect(src).toContain('draftType: string')
  })

  it('SSE parser handles action_draft event type', () => {
    expect(src).toMatch(/currentEvent\s*===\s*['"]action_draft['"]/)
  })

  it('approveAction function exported', () => {
    expect(src).toContain('export async function approveAction')
  })

  it('approveAction POSTs to /api/advisor/actions/approve', () => {
    expect(src).toContain('/api/advisor/actions/approve')
  })

  it('ApproveActionRequest interface exported', () => {
    expect(src).toContain('ApproveActionRequest')
  })

  it('ApproveActionResponse interface exported', () => {
    expect(src).toContain('ApproveActionResponse')
  })
})

describe('types.ts — ActionDraft types', () => {
  const src = readSrc('types.ts')

  it('ActionDraftType exported with three values', () => {
    expect(src).toContain('create_task')
    expect(src).toContain('create_note')
    expect(src).toContain('set_milestone')
    expect(src).toContain('ActionDraftType')
  })

  it('ActionDraftStatus exported', () => {
    expect(src).toContain('ActionDraftStatus')
    expect(src).toContain("'pending'")
    expect(src).toContain("'approved'")
    expect(src).toContain("'edited'")
    expect(src).toContain("'dismissed'")
  })

  it('ActionDraft interface has all required fields', () => {
    expect(src).toContain('interface ActionDraft')
    expect(src).toContain('id: string')
    expect(src).toContain('type: ActionDraftType')
    expect(src).toContain('title: string')
    expect(src).toContain('source_response_id: string')
    expect(src).toContain('status: ActionDraftStatus')
  })
})
