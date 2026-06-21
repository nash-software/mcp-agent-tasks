/**
 * advisor.ts — Pure logic for the Advisor view.
 * buildSuggestions, renderWithChips, localAdvice — no side effects, fully testable.
 * Ported from docs/epics/MCPAT-070/design_handoff/reference/advisor.jsx
 */
import React from 'react'
import type { Task, Goal } from '../types'
import type { NoteRecord } from '../api'
import pmJson from '../advisor/personas/pm.json'
import chairmanJson from '../advisor/personas/chairman.json'
import coachJson from '../advisor/personas/coach.json'
import ladderJson from '../advisor/plays/ladder.json'
import downwardArrowJson from '../advisor/plays/downward_arrow.json'
import odysseyJson from '../advisor/plays/odyssey.json'
import bestPossibleSelfJson from '../advisor/plays/best_possible_self.json'
import immunityJson from '../advisor/plays/immunity.json'
import focusingJson from '../advisor/plays/focusing.json'
import somaticPendulationJson from '../advisor/plays/somatic_pendulation.json'
import ifsPartsJson from '../advisor/plays/ifs_parts.json'
import byronKatieJson from '../advisor/plays/byron_katie.json'
import fearSettingJson from '../advisor/plays/fear_setting.json'
import regretMinJson from '../advisor/plays/regret_min.json'

// ── Types ──────────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'warning' | 'info'
export type SuggestionId = 's-crit' | 's-cap' | 's-block' | 's-root' | 's-auto' | 's-goal-gap' | 's-stall' | 's-distribution' | 's-brain-surface'
export type SuggestionAction = 'commit' | 'hermes' | 'open'

export type PersonaId = 'pm' | 'chairman' | 'coach'

// ── Play system types (T1.2) ───────────────────────────────────────────────

export type PlayId =
  | 'ladder'
  | 'downward_arrow'
  | 'odyssey'
  | 'best_possible_self'
  | 'immunity'
  | 'focusing'
  | 'somatic_pendulation'
  | 'ifs_parts'
  | 'byron_katie'
  | 'fear_setting'
  | 'regret_min'

export type PlayEntityType = 'belief' | 'fear' | 'value' | 'commitment'
export type PlayArtifactKind = 'odyssey_plan' | 'immunity_map' | 'values_charter' | 'fear_map' | 'future_self_letter' | 'belief_ledger'
export type PlayModelHint = 'cheap' | 'mid' | 'high'

export interface Play {
  id: PlayId
  label: string
  intent: string
  trigger_signals: string[]
  protocol: string[]
  opening_moves: string[]
  deepening_questions: string[]
  do_not: string[]
  writes: PlayEntityType[]
  artifact?: PlayArtifactKind
  exit_criteria: string
  model_hint: PlayModelHint
  safe_when_dysregulated: boolean
}

export const PLAYS: Record<PlayId, Play> = {
  ladder: ladderJson as Play,
  downward_arrow: downwardArrowJson as Play,
  odyssey: odysseyJson as Play,
  best_possible_self: bestPossibleSelfJson as Play,
  immunity: immunityJson as Play,
  focusing: focusingJson as Play,
  somatic_pendulation: somaticPendulationJson as Play,
  ifs_parts: ifsPartsJson as Play,
  byron_katie: byronKatieJson as Play,
  fear_setting: fearSettingJson as Play,
  regret_min: regretMinJson as Play,
}

export function getPlay(id: PlayId): Play | undefined {
  return PLAYS[id]
}

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
 * Derive up to 5 proactive suggestions from the user's live tasks + notes + goals.
 * Rules (first-match wins per slot, not overall):
 *   s-crit        — critical tasks not in_progress
 *   s-cap         — today's capacity vs target
 *   s-block       — first blocked open task
 *   s-root        — task IDs appearing in 2+ notes (shared root cause signal)
 *   s-auto        — weekly-tagged task with no agent_status and no scheduled date
 *   s-goal-gap    — no open tasks linked to any active goal (keyword match)
 *   s-stall       — project with 3+ open tasks, no in_progress in 14+ days
 *   s-distribution — no distribution/marketing tasks in_progress or scheduled (financial goal guard)
 *   s-brain-surface — brain search snippet for top active goal
 */
export function buildSuggestions(
  tasks: Task[],
  notes: NoteRecord[],
  target: number,
  goals: Goal[] = [],
  brainSnippet?: string,
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

  // ── Portfolio-level signals (appended after existing 5, cap is shared) ────

  const activeGoals = goals.filter(g => g.status === 'active')

  // 6 — s-goal-gap: no open tasks linked to any active goal by keyword
  if (activeGoals.length > 0 && out.length < 5) {
    const hasMatch = activeGoals.some(goal => {
      const words = goal.title.toLowerCase().split(/\W+/).filter(w => w.length > 2)
      return open.some(t => {
        const haystack = `${t.title} ${(t.tags ?? []).join(' ')}`.toLowerCase()
        return words.some(w => haystack.includes(w))
      })
    })
    if (!hasMatch) {
      const g0 = activeGoals[0]
      out.push({
        id: 's-goal-gap',
        severity: 'warning',
        title: `No tasks linked to your goal "${g0.title.slice(0, 60)}"`,
        rationale: `You have active goals but none of your open tasks appear to be working toward them. Goals without associated work items stall silently — add at least one task that maps to "${g0.title}".`,
        taskIds: [],
        actions: [],
        basis: 'goal · keyword match',
      })
    }
  }

  // 7 — s-stall: project with 3+ open tasks, no in_progress in 14+ days
  if (out.length < 5) {
    const NOW = Date.now()
    const STALL_MS = 14 * 24 * 60 * 60 * 1000
    // Group open tasks by project prefix (cap at 20 projects)
    const byProject = new Map<string, Task[]>()
    for (const t of open) {
      const prefix = t.id.split('-')[0] ?? ''
      if (!prefix) continue
      if (!byProject.has(prefix)) byProject.set(prefix, [])
      byProject.get(prefix)!.push(t)
    }
    // Check up to 20 most active projects
    const projects = [...byProject.entries()]
      .filter(([, ts]) => ts.length >= 3)
      .slice(0, 20)
    const stalled = projects.find(([, ts]) => {
      const hasInProgress = ts.some(t => t.status === 'in_progress')
      if (hasInProgress) return false
      const mostRecent = ts.reduce<number>((max, t) => {
        const ts2 = t.last_activity ? new Date(t.last_activity).getTime() : 0
        return ts2 > max ? ts2 : max
      }, 0)
      return mostRecent > 0 && NOW - mostRecent > STALL_MS
    })
    if (stalled) {
      const [prefix, ts] = stalled
      out.push({
        id: 's-stall',
        severity: 'warning',
        title: `Project ${prefix} has stalled — ${ts.length} open tasks, none in progress for 14+ days`,
        rationale: `"${prefix}" has ${ts.length} open tasks but nothing has moved in over two weeks. Either the project is waiting on something external (make that explicit with a blocked status) or it's been deprioritised without a deliberate decision.`,
        taskIds: ts.slice(0, 3).map(t => t.id),
        actions: [],
        basis: 'project · activity',
      })
    }
  }

  // 8 — s-distribution: no distribution/marketing tasks active (only when financial/client goal present)
  if (out.length < 5 && activeGoals.length > 0) {
    const FINANCIAL_KEYWORDS = /revenue|mrr|arr|sales|client|customer|£|\$|€|income|profit/i
    const hasFinancialGoal = activeGoals.some(g =>
      FINANCIAL_KEYWORDS.test(g.title) || FINANCIAL_KEYWORDS.test(g.metric ?? '') || FINANCIAL_KEYWORDS.test(g.description ?? ''),
    )
    if (hasFinancialGoal) {
      const DIST_TAGS = new Set(['marketing', 'sales', 'distribution', 'clients', 'visibility', 'outreach'])
      const TODAY_K = todayKey()
      const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const hasDistributionWork = open.some(t => {
        const tags = t.tags ?? []
        if (!tags.some(tag => DIST_TAGS.has(tag))) return false
        if (t.status === 'in_progress') return true
        if (t.scheduled_for && t.scheduled_for >= TODAY_K && t.scheduled_for <= sevenDaysLater) return true
        return false
      })
      if (!hasDistributionWork) {
        out.push({
          id: 's-distribution',
          severity: 'info',
          title: 'No distribution or sales work scheduled in the next 7 days',
          rationale: `You have a financial goal active but no tasks tagged marketing/sales/distribution/clients are in progress or scheduled this week. Revenue goals stall when all effort goes into building and none into getting it in front of people.`,
          taskIds: [],
          actions: [],
          basis: 'goal · tag audit',
        })
      }
    }
  }

  // 9 — s-brain-surface: brain search snippet for top active goal
  if (out.length < 5 && brainSnippet && activeGoals.length > 0) {
    const g0 = activeGoals[0]
    out.push({
      id: 's-brain-surface',
      severity: 'info',
      title: `Brain match for your goal "${g0.title.slice(0, 50)}"`,
      rationale: brainSnippet,
      taskIds: [],
      actions: [],
      basis: 'brain · search',
    })
  }

  // Scoring override: when a financial/client goal is active, s-distribution ranks above s-stall
  const activeGoalsLocal = goals.filter(g => g.status === 'active')
  const FINANCIAL_KEYWORDS_RANK = /revenue|mrr|arr|sales|client|customer|£|\$|€|income|profit/i
  const hasFinancialGoalForRank = activeGoalsLocal.some(g =>
    FINANCIAL_KEYWORDS_RANK.test(g.title) || FINANCIAL_KEYWORDS_RANK.test(g.metric ?? '') || FINANCIAL_KEYWORDS_RANK.test(g.description ?? ''),
  )
  if (hasFinancialGoalForRank) {
    const distIdx = out.findIndex(s => s.id === 's-distribution')
    const stallIdx = out.findIndex(s => s.id === 's-stall')
    if (distIdx !== -1 && stallIdx !== -1 && distIdx > stallIdx) {
      // Swap so distribution appears before stall
      const [distItem] = out.splice(distIdx, 1)
      out.splice(stallIdx, 0, distItem)
    }
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
