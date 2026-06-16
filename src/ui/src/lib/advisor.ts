/**
 * advisor.ts — Pure logic for the Advisor view.
 * buildSuggestions, renderWithChips, localAdvice — no side effects, fully testable.
 * Ported from docs/epics/MCPAT-070/design_handoff/reference/advisor.jsx
 */
import React from 'react'
import type { Task } from '../types'
import type { NoteRecord } from '../api'
import pmJson from '../advisor/personas/pm.json'
import chairmanJson from '../advisor/personas/chairman.json'
import coachJson from '../advisor/personas/coach.json'

// ── Types ──────────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'warning' | 'info'
export type SuggestionId = 's-crit' | 's-cap' | 's-block' | 's-root' | 's-auto'
export type SuggestionAction = 'commit' | 'hermes' | 'open'

export type PersonaId = 'pm' | 'chairman' | 'coach'

export interface Persona {
  id: PersonaId
  label: string
  descriptor: string
  model: string
  system_prompt: string
  output_style: string
  suggested_prompts: readonly string[]
}

export interface Suggestion {
  rank: number
  id: SuggestionId
  severity: Severity
  title: string
  rationale: string
  taskIds: string[]
  actions: SuggestionAction[]
  basis: string
}

// ── Constants ──────────────────────────────────────────────────────────────

export const SEV_LABEL: Record<Severity, string> = {
  critical: 'Act now',
  warning: 'Watch',
  info: 'Consider',
}

export const ID_RE = /\b[A-Z]{2,5}-\d+\b/g

export const PERSONAS: Record<PersonaId, Persona> = {
  pm: pmJson as Persona,
  chairman: chairmanJson as Persona,
  coach: coachJson as Persona,
}

export const SUGGESTED_PROMPTS: Record<PersonaId, readonly string[]> = {
  pm: pmJson.suggested_prompts,
  chairman: chairmanJson.suggested_prompts,
  coach: coachJson.suggested_prompts,
}

// ── Today key (ISO date string) ────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── buildSuggestions ───────────────────────────────────────────────────────

/**
 * Derive up to 5 proactive suggestions from the user's live tasks + notes.
 * Rules (first-match wins per slot, not overall):
 *   s-crit  — critical tasks not in_progress
 *   s-cap   — today's capacity vs target
 *   s-block — first blocked open task
 *   s-root  — task IDs appearing in 2+ notes (shared root cause signal)
 *   s-auto  — weekly-tagged task with no agent_status and no scheduled date
 */
export function buildSuggestions(
  tasks: Task[],
  notes: NoteRecord[],
  target: number,
): Suggestion[] {
  const TODAY_K = todayKey()
  const open = tasks.filter(t => t.status !== 'done' && t.status !== 'closed' && t.status !== 'archived')
  const out: Omit<Suggestion, 'rank'>[] = []

  // 1 — s-crit: critical work not moving
  const critIdle = open.filter(t => t.priority === 'critical' && t.status !== 'in_progress')
  if (critIdle.length > 0) {
    const t0 = critIdle[0]
    out.push({
      id: 's-crit',
      severity: 'critical',
      title: critIdle.length === 1
        ? `Start ${t0.id} first — your only critical task isn't moving`
        : `${critIdle.length} critical tasks aren't in progress`,
      rationale: `${t0.id} ("${t0.title}") is priority:critical but still ${t0.status.replace('_', ' ')}. Critical work sitting idle while lower-priority tasks are in flight is a prioritisation inversion — pull it to the front of the queue.`,
      taskIds: critIdle.map(t => t.id).slice(0, 3),
      actions: ['commit'],
      basis: 'priority + status',
    })
  }

  // 2 — s-cap: capacity read for today
  const committed = open.filter(t => t.scheduled_for === TODAY_K)
  const hrs = committed.reduce((s, t) => s + (t.estimate_hours ?? 0), 0)
  if (committed.length > 0) {
    if (hrs > target) {
      out.push({
        id: 's-cap',
        severity: 'warning',
        title: `You're over capacity — ${fmtHM(hrs)} committed against a ${target}h ceiling`,
        rationale: `${committed.length} tasks are on today and they add up to ${fmtHM(hrs)}. Past ${target}h the estimates lie and tomorrow borrows from today. Defer the lowest-leverage one before you start.`,
        taskIds: committed
          .slice()
          .sort((a, b) => PRI_RANK[b.priority] - PRI_RANK[a.priority])
          .map(t => t.id)
          .slice(0, 2),
        actions: [],
        basis: 'capacity model',
      })
    } else {
      out.push({
        id: 's-cap',
        severity: 'info',
        title: `${fmtHM(hrs)} committed of ${target}h — room for one or two more`,
        rationale: 'Today is comfortably under the ceiling. Good moment to pull a high-priority unscheduled task in rather than letting the slack fill itself.',
        taskIds: [],
        actions: [],
        basis: 'capacity model',
      })
    }
  }

  // 3 — s-block: first open blocked task
  const blocked = open.filter(t => t.status === 'blocked')
  if (blocked.length > 0) {
    const b = blocked[0]
    out.push({
      id: 's-block',
      severity: 'warning',
      title: `${b.id} is blocked — chase the unblock or reschedule it`,
      rationale: `"${b.title}" is parked: ${b.block_reason ?? 'waiting on an external dependency'}. It's high-priority, so the longer it waits the more it compresses the rest of the plan. Confirm the window or move it off the radar.`,
      taskIds: [b.id],
      actions: ['open'],
      basis: 'status age',
    })
  }

  // 4 — s-root: task IDs appearing in 2+ notes (shared root cause signal)
  if (notes.length > 0) {
    const freq = new Map<string, number>()
    const taskIds = new Set(tasks.map(t => t.id))
    for (const note of notes) {
      ID_RE.lastIndex = 0
      const found = new Set<string>()
      let m: RegExpExecArray | null
      while ((m = ID_RE.exec(note.body)) !== null) {
        const id = m[0]
        if (taskIds.has(id) && !found.has(id)) {
          found.add(id)
          freq.set(id, (freq.get(id) ?? 0) + 1)
        }
      }
    }
    // collect IDs that appear in >=2 notes and are open (not done/closed/archived)
    const openIds = new Set(open.map(t => t.id))
    const crossNote = [...freq.entries()]
      .filter(([id, count]) => count >= 2 && openIds.has(id))
      .map(([id]) => id)

    if (crossNote.length >= 2) {
      const id0 = crossNote[0]
      const id1 = crossNote[1]
      out.push({
        id: 's-root',
        severity: 'info',
        title: `Fix ${id0} and ${id1} together — they share one root cause`,
        rationale: `Your notes tie ${id0} and ${id1} to the same underlying issue. Writing the shared fix once closes both instead of patching them twice.`,
        taskIds: crossNote.slice(0, 2),
        actions: ['commit'],
        basis: 'brain · patterns/dispatch.md',
      })
    }
  }

  // 5 — s-auto: weekly ritual worth automating
  const ritual = open.find(
    t => (t.tags ?? []).includes('weekly') && !t.agent_status && t.scheduled_for == null,
  )
  if (ritual) {
    out.push({
      id: 's-auto',
      severity: 'info',
      title: `Hand ${ritual.id} to Hermes — it's a weekly ritual you keep doing by hand`,
      rationale: `"${ritual.title}" recurs on a cadence and the inputs barely change. Sign it off once and it runs itself — that's ~${fmtHM(ritual.estimate_hours ?? 0.5)} back every week.`,
      taskIds: [ritual.id],
      actions: ['hermes'],
      basis: 'recurrence pattern',
    })
  }

  return out.slice(0, 5).map((s, i) => ({ rank: i + 1, ...s }))
}

// ── renderWithChips ────────────────────────────────────────────────────────

/**
 * Split text on task ID matches. Returns an array of strings and React button
 * elements, where each task ID becomes a clickable chip.
 * Caller must reset ID_RE.lastIndex before use — we reset it here.
 */
export function renderWithChips(
  text: string,
  onOpenTask: (id: string) => void,
): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = []
  let last = 0
  ID_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ID_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const id = m[0]
    parts.push(
      React.createElement(
        'button',
        { key: m.index, className: 'id-chip', onClick: () => onOpenTask(id) },
        id,
      ),
    )
    last = m.index + id.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

// ── localAdvice ────────────────────────────────────────────────────────────

/**
 * Offline / fallback responder. Three keyword branches (first-match wins):
 *   1. block|stuck|waiting — lists blocked tasks
 *   2. standup|update|summar|week|recap — done/wip/next/watch-out summary
 *   3. automat|hermes|delegate|agent — finds s-auto or generic automation hint
 *   default — top suggestion or generic "start highest-priority" message
 */
export function localAdvice(
  prompt: string,
  tasks: Task[],
  suggestions: Suggestion[],
): string {
  const q = prompt.toLowerCase()
  const TODAY_K = todayKey()
  const open = tasks.filter(t => t.status !== 'done' && t.status !== 'closed' && t.status !== 'archived')

  if (/block|stuck|waiting/.test(q)) {
    const b = open.filter(t => t.status === 'blocked')
    return b.length > 0
      ? `${b.map(t => t.id).join(', ')} ${b.length === 1 ? 'is' : 'are'} blocked. ${b[0].id} is waiting on: ${b[0].block_reason ?? 'an external dependency'}. Everything else is actionable — nothing else is gated.`
      : 'Nothing is blocked right now. Your constraint is capacity, not dependencies.'
  }

  if (/standup|update|summar|week|recap/.test(q)) {
    const done = tasks.filter(t => t.status === 'done').slice(0, 3).map(t => t.id)
    const wip = open.filter(t => t.status === 'in_progress').map(t => t.id)
    const next = open
      .filter(t => t.scheduled_for === TODAY_K && t.status === 'todo')
      .slice(0, 3)
      .map(t => t.id)
    const topFlag = suggestions[0] ? suggestions[0].title : 'all clear'
    return `Yesterday → shipped ${done.join(', ') || '—'}. In progress → ${wip.join(', ') || 'nothing claimed'}. Today → ${next.join(', ') || '—'}. Watch-out → ${topFlag}.`
  }

  if (/automat|hermes|delegate|agent/.test(q)) {
    const a = suggestions.find(s => s.id === 's-auto')
    return a
      ? a.rationale
      : "The strongest automation candidate is anything tagged \"weekly\" — same inputs each run. Sign one off to Hermes and watch it for a cycle."
  }

  // default
  const top = suggestions[0]
  return top
    ? `${top.title}. ${top.rationale}`
    : "You're in good shape — start the highest-priority committed task and protect the capacity ceiling."
}

// ── Internal helpers ───────────────────────────────────────────────────────

const PRI_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

function fmtHM(h: number): string {
  const hours = Math.floor(h)
  const mins = Math.round((h - hours) * 60)
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}
