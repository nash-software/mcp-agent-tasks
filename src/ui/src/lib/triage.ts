/**
 * triage.ts — deterministic task classifier for Hermes.
 * Pure functions, zero side effects. Port from design_handoff_life_os/reference/agent.jsx.
 * First-match-wins: skill > signoff > recurring > research > manual.
 */
import type { Task, Skill, Engine } from '../types'

export const BUCKET_ORDER = ['signoff', 'automatable', 'research', 'recurring', 'manual'] as const
export type Bucket = (typeof BUCKET_ORDER)[number]

/** Icon names map to lucide-react component names (used by consumers, not imported here). */
export const BUCKETS: Record<Bucket, { label: string; iconName: string; colorClass: string }> = {
  signoff:     { label: 'Needs your sign-off', iconName: 'Lock',    colorClass: 'text-status-amber' },
  automatable: { label: 'Automatable now',     iconName: 'Zap',     colorClass: 'text-status-green' },
  research:    { label: 'Worth automating',    iconName: 'FlaskConical', colorClass: 'text-accent' },
  recurring:   { label: 'Recurring ritual',    iconName: 'Repeat',  colorClass: 'text-status-blue'  },
  manual:      { label: 'One-off · manual',    iconName: 'Hand',    colorClass: 'text-ink-muted'    },
}

export const VENUE: Record<Engine, string> = {
  acr:    'on ACR',
  n8n:    'via an n8n flow',
  hermes: 'myself',
}

export interface Triage {
  bucket: Bucket
  skill?: Skill
  action: 'run' | 'approve' | 'schedule' | 'research' | 'assist'
  rationale: string
  acr?: boolean
}

// Verbatim from agent.jsx — do NOT reorder keywords or rewrite regex.
// eslint-disable-next-line no-useless-escape
export const SOFTWARE_RE = /\b(deploy|migrat|build|api|endpoint|bug|refactor|script|backup|database|db|crawl|scrape|test|ci|pipeline|audit|lighthouse|lint|typecheck|code|server|cron|postgres|webhook)\b/

export function isSoftware(task: Task): boolean {
  return SOFTWARE_RE.test(
    (task.title + ' ' + (task.tags ?? []).join(' ') + ' ' + (task.why ?? '')).toLowerCase(),
  )
}

export function matchSkill(task: Task, skills: Skill[]): Skill | undefined {
  const text = (task.title + ' ' + (task.tags ?? []).join(' ')).toLowerCase()
  return skills.find((s) => s.match.some((m) => text.includes(m)))
}

/** First-match-wins triage. Returns a Triage with bucket + rationale + optional skill/acr. */
export function triage(task: Task, skills: Skill[]): Triage {
  const text = (
    task.title + ' ' + (task.tags ?? []).join(' ') + ' ' + (task.why ?? '')
  ).toLowerCase()

  // Rule 1: skill match → automatable (always wins)
  const skill = matchSkill(task, skills)
  if (skill) {
    return {
      bucket: 'automatable',
      skill,
      action: 'run',
      rationale: `Matches your "${skill.name}" skill — I'll run it ${VENUE[skill.engine] ?? 'myself'} and hand you the output.`,
    }
  }

  // Rule 2: commitment / judgement call → signoff
  if (
    /\b(sow|contract|approve|approval|decide|decision|sign off|pricing|invoice|client call|negotiat|hire|legal)\b/.test(text) ||
    task.priority === 'critical'
  ) {
    return {
      bucket: 'signoff',
      action: 'approve',
      rationale: "This touches a client commitment or a judgement call. I won't act until you approve it.",
    }
  }

  // Rule 3: cadence / ritual → recurring
  if (
    (task.tags ?? []).includes('ritual') ||
    /\b(weekly|daily|every (week|day|morning)|recurring|standup|review)\b/.test(text)
  ) {
    return {
      bucket: 'recurring',
      action: 'schedule',
      acr: isSoftware(task),
      rationale: 'Looks like something you repeat on a cadence — worth putting on a schedule so it just happens.',
    }
  }

  // Rule 4: automation verb → research
  if (
    /\b(audit|report|check|scan|scrape|crawl|sync|generate|lint|test|backup|monitor|migrate|export|screenshot|benchmark|digest|compile)\b/.test(text)
  ) {
    const sw = isSoftware(task)
    return {
      bucket: 'research',
      action: 'research',
      acr: sw,
      rationale: sw
        ? 'No skill yet — and this is software work. I can scope it, and I\'d likely hand execution to ACR.'
        : 'No skill yet, but it\'s repeatable. I can scope it and build an n8n flow so it runs itself.',
    }
  }

  // Rule 5: fallback → manual
  const sw = isSoftware(task)
  return {
    bucket: 'manual',
    action: 'assist',
    acr: sw,
    rationale: sw
      ? 'One-off, but it\'s software — I can draft it, or hand it straight to ACR to execute.'
      : "One-off — automating it would cost more than it saves. I can draft a first pass, but it's yours to own.",
  }
}

/** Format minutes saved as "Nm" or "Xh".
 *  Correct formula: Math.round(min / 60 * 10) / 10  (algebraically: minutes → hours, 1 decimal).
 *  The prototype used Math.round(min/6)/10 which is algebraically identical but misleading;
 *  this makes the intent clear and avoids the off-by-10 confusion documented in the spec.
 */
export function fmtSaved(min: number): string {
  if (min < 60) return min + 'm'
  return Math.round(min / 60 * 10) / 10 + 'h'
}
