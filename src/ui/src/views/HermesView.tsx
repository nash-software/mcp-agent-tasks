/**
 * HermesView — the Hermes agent queue, triage, and automation layer.
 * Sign-off gate: ONLY tasks with agent_status set (non-null, non-done) appear here.
 * P2-05 delivers: triage classifier, task queue, sign-off gate, daily budget,
 *   AgentTaskCard per bucket, agent log, and placeholder regions for P2-06.
 * P2-06 delivers: ProposalCard list, real SkillCard grid, promote→re-triage loop,
 *   research heuristic, runSkillDirect, proposalTaskIds queue gating.
 * Port from design_handoff_life_os/reference/agent.jsx (AgentView + AgentControl).
 */
import React, { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, Server, Zap, Minus, Plus } from 'lucide-react'
import { fetchTasks } from '../api'
import {
  fetchSkills, fetchAgentLog, clearSignoffTask, dispatchToAcr,
  postAgentResearch, postAgentSchedule, promoteSkill, buildProposalHeuristic,
} from '../api'
import type { PromoteSkillPayload } from '../api'
import { useAcrStatus } from '../hooks/useAcrStatus'
import { triage, BUCKET_ORDER, BUCKETS, fmtSaved } from '../lib/triage'
import type { Bucket, Triage } from '../lib/triage'
import { AgentTaskCard, RunningCard } from '../components/AgentTaskCard'
import { ProposalCard } from '../components/ProposalCard'
import { SkillCard } from '../components/SkillCard'
import type { Task, Skill, AgentLog, Proposal, ProposalWithMatch } from '../types'

// ── Daily budget persistence ──────────────────────────────────────────────
const BUDGET_KEY = 'lifeos-budget'

function readBudget(): number {
  try {
    const raw = localStorage.getItem(BUDGET_KEY)
    if (!raw) return 1
    const n = parseInt(raw, 10)
    return !isNaN(n) && n >= 0 ? n : 1
  } catch {
    return 1
  }
}

function writeBudget(n: number): void {
  try { localStorage.setItem(BUDGET_KEY, String(n)) } catch { /* noop */ }
}

// ── Section wrapper ────────────────────────────────────────────────────────
interface SectionProps {
  label: string
  count?: number
  hint?: string
  children: React.ReactNode
}

function Section({ label, count, hint, children }: SectionProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-ink">{label}</span>
        {count != null && (
          <span className="font-mono text-xs text-ink-muted">{count}</span>
        )}
        {hint && <span className="text-xs text-ink-muted">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

// ── Agent log row ──────────────────────────────────────────────────────────
interface AgentLogRowProps {
  entry: AgentLog
}

function AgentLogRow({ entry }: AgentLogRowProps): React.JSX.Element {
  const color = entry.kind === 'run' ? 'text-status-green' : entry.kind === 'research' ? 'text-accent' : 'text-status-blue'
  return (
    <div className="flex items-center gap-2 text-xs py-1.5 border-b border-surface-3 last:border-0">
      <span className={color}>
        {entry.kind === 'run' ? <Zap size={12} /> : entry.kind === 'research' ? <Server size={12} /> : <Bot size={12} />}
      </span>
      <span className="flex-1 text-ink truncate">{entry.title}</span>
      {entry.savedMin > 0 && (
        <span className="font-mono text-status-green shrink-0">+{fmtSaved(entry.savedMin)}</span>
      )}
      <span className="font-mono text-ink-faint shrink-0">{entry.at}</span>
    </div>
  )
}

// ── Main view ──────────────────────────────────────────────────────────────
interface HermesViewProps {
  onOpenPanel?: (task: Task) => void
}

// jobsToday is client-tracked, reset at local midnight
function readJobsToday(): number {
  try {
    const raw = localStorage.getItem('lifeos-jobs-today')
    if (!raw) return 0
    const { date, count } = JSON.parse(raw) as { date: string; count: number }
    const today = new Date().toISOString().slice(0, 10)
    if (date !== today) return 0
    return typeof count === 'number' ? count : 0
  } catch {
    return 0
  }
}

function writeJobsToday(count: number): void {
  try {
    const date = new Date().toISOString().slice(0, 10)
    localStorage.setItem('lifeos-jobs-today', JSON.stringify({ date, count }))
  } catch { /* noop */ }
}

export function HermesView({ onOpenPanel }: HermesViewProps): React.JSX.Element {
  const qc = useQueryClient()

  // ── Data queries ────────────────────────────────────────────────────────
  const { data: allTasks = [] } = useQuery<Task[]>({
    queryKey: ['tasks'],
    queryFn: () => fetchTasks(),
  })
  const { data: skills = [] } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: fetchSkills,
    retry: 1,
  })
  const { data: agentLogRaw = [] } = useQuery<AgentLog[]>({
    queryKey: ['agent', 'log'],
    queryFn: fetchAgentLog,
    retry: 1,
  })
  const acrQuery = useAcrStatus()
  const acrOffline = acrQuery.data?.offline ?? false

  // ── Budget state ────────────────────────────────────────────────────────
  const [dailyBudget, setDailyBudgetState] = useState<number>(readBudget)
  const [jobsToday, setJobsToday] = useState<number>(readJobsToday)

  const setDailyBudget = useCallback((n: number): void => {
    const clamped = Math.max(0, n)
    setDailyBudgetState(clamped)
    writeBudget(clamped)
  }, [])

  const incrementJobsToday = useCallback((): void => {
    setJobsToday(prev => {
      const next = prev + 1
      writeJobsToday(next)
      return next
    })
  }, [])

  // ── Sign-off gate (AC-1) ────────────────────────────────────────────────
  const scheduled = useMemo(
    () => allTasks.filter(
      (t) => t.agent_status != null && t.agent_status !== 'done' && t.status !== 'done',
    ),
    [allTasks],
  )

  const running = useMemo(
    () => scheduled.filter((t) => t.agent_status === 'running'),
    [scheduled],
  )

  // ── P2-06: Proposals state ───────────────────────────────────────────────
  // Proposals are transient client state. proposalTaskIds filters those tasks from triage queue.
  const [proposals, setProposals] = useState<ProposalWithMatch[]>([])
  // Per-proposal promote error (calm inline, no toast)
  const [promoteErrors, setPromoteErrors] = useState<Record<string, string>>({})

  const proposalTaskIds = useMemo(
    () => proposals.map(p => p.taskId),
    [proposals],
  )

  // ── Triage queue ────────────────────────────────────────────────────────
  const triaged = useMemo(
    () =>
      scheduled
        .filter((t) => t.agent_status === 'scheduled' && !proposalTaskIds.includes(t.id))
        .map((t) => ({ task: t, tri: triage(t, skills) })),
    [scheduled, skills, proposalTaskIds],
  )

  const byBucket = useMemo((): Partial<Record<Bucket, Array<{ task: Task; tri: Triage }>>> => {
    const acc: Partial<Record<Bucket, Array<{ task: Task; tri: Triage }>>> = {}
    for (const x of triaged) {
      const bk = x.tri.bucket
      if (!acc[bk]) acc[bk] = []
      acc[bk]!.push(x)
    }
    return acc
  }, [triaged])

  const recommended = byBucket.automatable?.[0] ?? null

  const empty = scheduled.length === 0 && proposals.length === 0

  // ── Budget math ─────────────────────────────────────────────────────────
  const budgetLeft = Math.max(0, dailyBudget - jobsToday)
  const savedTotal = skills.reduce((s, k) => s + k.minutesSaved, 0)
  const runsTotal = skills.reduce((s, k) => s + k.runs, 0)

  const agentLog = agentLogRaw.slice(0, 8)

  // ── Mutations ───────────────────────────────────────────────────────────
  const unscheduleMut = useMutation({
    mutationFn: (taskId: string) => clearSignoffTask(taskId),
    onMutate: async (taskId: string) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const prev = qc.getQueryData<Task[]>(['tasks'])
      qc.setQueryData<Task[]>(['tasks'], (old = []) =>
        old.map((t) => t.id === taskId ? { ...t, agent_status: undefined } : t),
      )
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev)
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['tasks'] }) },
  })

  const dispatchAcrMut = useMutation({
    mutationFn: ({ taskId, skillId }: { taskId: string; skillId?: string }) =>
      dispatchToAcr(taskId, { source: 'hermes', skillId }),
    onMutate: async ({ taskId }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const prev = qc.getQueryData<Task[]>(['tasks'])
      qc.setQueryData<Task[]>(['tasks'], (old = []) =>
        old.map((t) => t.id === taskId ? { ...t, agent_status: 'running' } : t),
      )
      return { prev }
    },
    onSuccess: (data) => {
      if (data && typeof data.jobId === 'string') incrementJobsToday()
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['agent', 'log'] })
    },
  })

  // ── P2-06: Promote mutation ──────────────────────────────────────────────
  const promoteMut = useMutation({
    mutationFn: (payload: PromoteSkillPayload) => promoteSkill(payload),
    onMutate: async (payload) => {
      // Optimistic: push synthetic skill into ['skills'] cache
      await qc.cancelQueries({ queryKey: ['skills'] })
      const prevSkills = qc.getQueryData<Skill[]>(['skills'])

      const syntheticSkill: Skill = {
        id: `optimistic-${Date.now()}`,
        name: payload.name,
        project: payload.project,
        engine: payload.engine as Skill['engine'],
        desc: payload.desc,
        match: payload.match,
        runs: 0,
        minutesSaved: 0,
        lastRun: 'just now',
        origin: payload.origin,
      }
      qc.setQueryData<Skill[]>(['skills'], (old = []) => [...old, syntheticSkill])

      // Optimistic: append a promote agent-log entry
      await qc.cancelQueries({ queryKey: ['agent', 'log'] })
      const prevLog = qc.getQueryData<AgentLog[]>(['agent', 'log'])
      const logEntry: AgentLog = {
        id: `opt-log-${Date.now()}`,
        kind: 'promote',
        title: `Promoted: ${payload.name}`,
        project: payload.project,
        savedMin: payload.savedPerRun ?? 0,
        at: 'just now',
      }
      qc.setQueryData<AgentLog[]>(['agent', 'log'], (old = []) => [logEntry, ...old])

      return { prevSkills, prevLog, syntheticSkillId: syntheticSkill.id }
    },
    onSuccess: () => {
      // Re-fetch skills so the real server-assigned id + the source task can re-triage properly
      void qc.invalidateQueries({ queryKey: ['skills'] })
      void qc.invalidateQueries({ queryKey: ['agent', 'log'] })
    },
    onError: (_err, _payload, ctx) => {
      // Full rollback: restore skills + log
      if (ctx?.prevSkills !== undefined) qc.setQueryData(['skills'], ctx.prevSkills)
      if (ctx?.prevLog !== undefined) qc.setQueryData(['agent', 'log'], ctx.prevLog)
    },
  })

  const researchMut = useMutation({
    mutationFn: (taskId: string) => postAgentResearch(taskId),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['agent', 'log'] }) },
  })

  const scheduleMut = useMutation({
    mutationFn: (taskId: string) => postAgentSchedule(taskId),
  })

  // ── P2-06: Propose handler ───────────────────────────────────────────────
  // Research action: try server endpoint; on failure, fall back to client heuristic.
  const handleResearch = useCallback(async (task: Task): Promise<void> => {
    // Guard: don't create a duplicate proposal for the same task
    if (proposalTaskIds.includes(task.id)) return

    try {
      // Attempt server-side research (P2-04 endpoint)
      await researchMut.mutateAsync(task.id)
      // If the server returns a full Proposal, it would come through a refetch.
      // For P2-06, the endpoint may not return a full Proposal shape yet — fall through to heuristic.
    } catch {
      // Research offline or unavailable — fall through to heuristic silently
    }

    // Client heuristic always produces a Proposal (AC #4 fallback per spec)
    const proposal = buildProposalHeuristic(task) as ProposalWithMatch
    setProposals(prev => [...prev, proposal])
  }, [proposalTaskIds, researchMut])

  // ── P2-06: Promote handler ───────────────────────────────────────────────
  const handlePromote = useCallback((proposal: ProposalWithMatch): void => {
    // Guard: if the task already matches an existing skill (stale proposal / race), clear and exit
    const task = allTasks.find(t => t.id === proposal.taskId)
    if (task) {
      const existingMatch = skills.find(s =>
        s.match.some(m => (task.title + ' ' + (task.tags ?? []).join(' ')).toLowerCase().includes(m)),
      )
      if (existingMatch) {
        // Skill already exists — just clear the proposal, no duplicate
        setProposals(prev => prev.filter(p => p.id !== proposal.id))
        return
      }
    }

    // Clear prior promote error for this proposal
    setPromoteErrors(prev => {
      const next = { ...prev }
      delete next[proposal.id]
      return next
    })

    // Build payload for POST /api/skills
    const payload: PromoteSkillPayload = {
      name: proposal.skillName,
      desc: proposal.summary,
      engine: proposal.engine,
      match: proposal._match.length > 0 ? proposal._match : [proposal.skillName.toLowerCase()],
      runs: 0,
      minutesSaved: 0,
      origin: proposal.taskId,
      project: proposal.project,
      savedPerRun: proposal.savedPerRun,
    }

    // Remove the proposal optimistically (task will re-triage once ['skills'] invalidated)
    setProposals(prev => prev.filter(p => p.id !== proposal.id))

    promoteMut.mutate(payload, {
      onError: () => {
        // Rollback: restore the proposal + show inline error
        setProposals(prev => [...prev, proposal])
        setPromoteErrors(prev => ({ ...prev, [proposal.id]: 'Could not save skill — please try again.' }))
      },
    })
  }, [allTasks, skills, promoteMut])

  // ── P2-06: Dismiss handler ───────────────────────────────────────────────
  const handleDismiss = useCallback((proposal: Proposal): void => {
    setProposals(prev => prev.filter(p => p.id !== proposal.id))
    // Task returns to its triage bucket on next render (no mutation needed)
  }, [])

  // ── P2-06: runSkillDirect — called by Dispatch button for automatable skills ──
  const runSkillDirect = useCallback((skill: Skill): void => {
    if (skill.engine === 'acr') {
      // ACR skills run on the real ACR machine. Dispatch only (source:'hermes', skillId); the
      // mutation's onSuccess consumes budget (real jobId only) and invalidates ['skills']/['agent','log']
      // so the runs/minutesSaved bump + run log come from backend truth — no unrollbackable
      // optimistic counters, no double budget count.
      const matchingTask = scheduled.find(t => triage(t, [skill]).bucket === 'automatable')
      if (matchingTask) {
        dispatchAcrMut.mutate({ taskId: matchingTask.id, skillId: skill.id })
      }
      return
    }
    // n8n / hermes skills run locally (no backend execution yet, P2-06 UI) — these always "succeed",
    // so optimistic bump + run log + budget are safe and never need rollback.
    const savedThisRun = skill.runs > 0
      ? Math.round(skill.minutesSaved / Math.max(skill.runs, 1))
      : skill.minutesSaved
    qc.setQueryData<Skill[]>(['skills'], (old = []) =>
      old.map(s => s.id === skill.id
        ? { ...s, runs: s.runs + 1, minutesSaved: s.minutesSaved + savedThisRun, lastRun: 'just now' }
        : s),
    )
    const logEntry: AgentLog = {
      id: `opt-run-${Date.now()}`,
      kind: 'run',
      title: `Ran: ${skill.name}`,
      project: skill.project,
      savedMin: savedThisRun,
      at: 'just now',
    }
    qc.setQueryData<AgentLog[]>(['agent', 'log'], (old = []) => [logEntry, ...old])
    incrementJobsToday()
  }, [scheduled, dispatchAcrMut, incrementJobsToday, qc])

  // ── Action dispatcher ────────────────────────────────────────────────────
  const handleAction = useCallback((action: string, task: Task, tri: Triage): void => {
    const wantsAcr = action === 'approve' || action === 'acr' ||
      (action === 'run' && tri.skill?.engine === 'acr')
    if (wantsAcr && acrOffline) return

    switch (action) {
      case 'run': {
        if (tri.skill?.engine === 'acr') {
          dispatchAcrMut.mutate({ taskId: task.id, skillId: tri.skill.id })
        } else {
          qc.setQueryData<Task[]>(['tasks'], (old = []) =>
            old.map((t) => t.id === task.id ? { ...t, agent_status: 'running' } : t),
          )
          incrementJobsToday()
        }
        break
      }
      case 'approve':
      case 'acr': {
        dispatchAcrMut.mutate({ taskId: task.id, skillId: tri.skill?.id })
        break
      }
      case 'research': {
        void handleResearch(task)
        break
      }
      case 'schedule': {
        scheduleMut.mutate(task.id)
        break
      }
      case 'assist':
      default:
        break
    }
  }, [qc, acrOffline, dispatchAcrMut, handleResearch, scheduleMut, incrementJobsToday])

  const handleDispatch = useCallback((): void => {
    if (!recommended || budgetLeft <= 0) return
    handleAction('run', recommended.task, recommended.tri)
  }, [recommended, budgetLeft, handleAction])

  const handleOpen = useCallback((task: Task): void => {
    onOpenPanel?.({ ...task })
  }, [onOpenPanel])

  const handleUnschedule = useCallback((task: Task): void => {
    unscheduleMut.mutate(task.id)
  }, [unscheduleMut])

  // ── State line ───────────────────────────────────────────────────────────
  const stateLine = running.length > 0
    ? `Working — ${running.length} job${running.length > 1 ? 's' : ''} running`
    : budgetLeft > 0
    ? "Idle — ready for today's job"
    : 'Done for today'

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      {/* View header */}
      <div>
        <h1 className="text-2xl font-semibold text-ink">Hermes</h1>
        <p className="text-sm text-ink-2 mt-0.5">
          Your assistant — triages, automates, and hands software work to ACR
        </p>
      </div>

      {/* Agent control header */}
      <div className="flex items-start justify-between gap-4 p-4 rounded-card bg-surface-1 border border-surface-3">
        {/* Left: avatar + state */}
        <div className="flex items-start gap-3">
          <div className={`flex items-center justify-center w-9 h-9 rounded-card bg-surface-2 shrink-0 ${running.length > 0 ? 'ring-2 ring-status-blue ring-offset-1 ring-offset-surface-1' : ''}`}>
            <Bot size={18} className={running.length > 0 ? 'text-status-blue' : 'text-ink-muted'} />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-sm font-medium text-ink">
              {stateLine}
              <span
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-badge text-xs ${acrOffline ? 'bg-surface-2 text-ink-faint' : 'bg-surface-2 text-ink-muted'}`}
                title={acrOffline ? 'ACR offline' : 'Hermes has access to the ACR machine'}
              >
                <Server size={9} />
                ACR
              </span>
            </div>
            <div className="text-xs text-ink-muted font-mono">
              Saved you{' '}
              <span className="font-semibold text-ink">{fmtSaved(savedTotal)}</span>
              {' '}across {runsTotal} runs ·{' '}
              <span>{jobsToday}/{dailyBudget}</span> jobs today
            </div>
          </div>
        </div>

        {/* Right: budget stepper + dispatch button */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1" title="How many jobs the agent may run per day">
            <span className="text-xs text-ink-muted">Daily budget</span>
            <button
              className="flex items-center justify-center w-6 h-6 rounded-badge bg-surface-2 text-ink-muted hover:text-ink transition-colors"
              onClick={() => { setDailyBudget(dailyBudget - 1) }}
            >
              <Minus size={11} />
            </button>
            <span className="font-mono text-sm text-ink w-4 text-center">{dailyBudget}</span>
            <button
              className="flex items-center justify-center w-6 h-6 rounded-badge bg-surface-2 text-ink-muted hover:text-ink transition-colors"
              onClick={() => { setDailyBudget(dailyBudget + 1) }}
            >
              <Plus size={11} />
            </button>
          </div>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-input bg-accent text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
            disabled={!recommended || budgetLeft <= 0 || (recommended?.tri.skill?.engine === 'acr' && acrOffline)}
            onClick={handleDispatch}
            title={
              !recommended ? 'Nothing queued to auto-run'
              : recommended.tri.skill?.engine === 'acr' && acrOffline ? 'ACR is offline — cannot dispatch'
              : `Run: ${recommended.task.title}`
            }
          >
            <Zap size={13} />
            {budgetLeft <= 0 ? 'Budget spent' : 'Dispatch next job'}
          </button>
        </div>
      </div>

      {/* Empty state */}
      {empty && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Bot size={36} className="text-ink-muted" />
          <div className="text-base font-semibold text-ink">Nothing signed off yet</div>
          <div className="text-sm text-ink-muted max-w-sm leading-relaxed">
            Sign a task off from the Board, Today, or any task menu and it lands here.
            Hermes only ever touches what you&apos;ve explicitly handed him.
          </div>
        </div>
      )}

      {!empty && (
        <>
          {/* Working now */}
          {running.length > 0 && (
            <Section label="Working now" count={running.length}>
              <div className="flex flex-col gap-2">
                {running.map((t) => <RunningCard key={t.id} task={t} />)}
              </div>
            </Section>
          )}

          {/* P2-06: Automation proposals (real ProposalCard list) */}
          {proposals.length > 0 && (
            <Section
              label="Automation proposals"
              count={proposals.length}
              hint="review → promote to a reusable skill"
            >
              <div className="flex flex-col gap-3">
                {proposals.map((p) => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    onPromote={() => { handlePromote(p) }}
                    onDismiss={handleDismiss}
                    promoteError={promoteErrors[p.id]}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* Bucket sections — non-empty only, fixed order */}
          {BUCKET_ORDER.filter((bk) => (byBucket[bk]?.length ?? 0) > 0).map((bk) => (
            <Section key={bk} label={BUCKETS[bk].label} count={byBucket[bk]!.length}>
              <div className="flex flex-col gap-2">
                {byBucket[bk]!.map(({ task, tri }) => (
                  <AgentTaskCard
                    key={task.id}
                    task={task}
                    tri={tri}
                    onAction={handleAction}
                    onOpen={handleOpen}
                    onUnschedule={handleUnschedule}
                    acrOffline={acrOffline}
                  />
                ))}
              </div>
            </Section>
          ))}

          {/* P2-06: Skills & automations — real SkillCard grid */}
          <Section
            label="Skills & automations"
            count={skills.length}
            hint="your recurring work, absorbed — Don't Repeat Yourself"
          >
            {skills.length > 0 ? (
              <div className="flex flex-col gap-2">
                {skills.map((s) => (
                  <SkillCard
                    key={s.id}
                    skill={s}
                    onRun={runSkillDirect}
                  />
                ))}
              </div>
            ) : (
              <div className="text-sm text-ink-muted py-4 text-center">
                No skills yet — they&apos;re created as Hermes learns your repeatable work.
                Research a task above to get started.
              </div>
            )}
          </Section>

          {/* Agent log */}
          {agentLog.length > 0 && (
            <Section label="Agent log" hint="what it's done for you">
              <div className="rounded-card bg-surface-1 border border-surface-3 px-3 py-1">
                {agentLog.map((e) => <AgentLogRow key={e.id} entry={e} />)}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
