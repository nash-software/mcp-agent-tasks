/**
 * HermesView — the Hermes agent queue, triage, and automation layer.
 * Sign-off gate: ONLY tasks with agent_status set (non-null, non-done) appear here.
 * P2-05 delivers: triage classifier, task queue, sign-off gate, daily budget,
 *   AgentTaskCard per bucket, agent log, and placeholder regions for P2-06.
 * Port from design_handoff_life_os/reference/agent.jsx (AgentView + AgentControl).
 */
import React, { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, Server, Zap, Minus, Plus } from 'lucide-react'
import { fetchTasks } from '../api'
import { fetchSkills, fetchAgentLog, clearSignoffTask, dispatchToAcr, postAgentResearch, postAgentSchedule } from '../api'
import { useAcrStatus } from '../hooks/useAcrStatus'
import { triage, BUCKET_ORDER, BUCKETS, fmtSaved } from '../lib/triage'
import type { Bucket, Triage } from '../lib/triage'
import { AgentTaskCard, RunningCard } from '../components/AgentTaskCard'
import type { Task, Skill, AgentLog, Proposal } from '../types'

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

// ── Skill stub row (P2-06 will replace with SkillCard grid) ───────────────
interface SkillStubProps {
  skill: Skill
}

function SkillStub({ skill }: SkillStubProps): React.JSX.Element {
  const engLabel = skill.engine === 'acr' ? 'ACR' : skill.engine === 'n8n' ? 'n8n' : 'Hermes'
  const engColor = skill.engine === 'acr' ? 'text-status-red' : skill.engine === 'n8n' ? 'text-status-blue' : 'text-status-green'
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-card bg-surface-1 border border-surface-3 text-xs">
      <Zap size={13} className="text-ink-muted shrink-0" />
      <span className="font-medium text-ink flex-1 truncate">{skill.name}</span>
      <span className={`font-mono ${engColor}`}>{engLabel}</span>
      <span className="font-mono text-ink-faint">{skill.runs} runs</span>
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
    // treat error/empty gracefully
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
  // ONLY tasks with agent_status set (non-null, non-done) are visible to Hermes.
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

  // P2-06 proposals (empty for now — consumed to exclude proposal-origin tasks from triage)
  const proposals: Proposal[] = []
  const proposalTaskIds: string[] = []

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
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['tasks'], ctx.prev)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['agent', 'log'] })
    },
  })

  const researchMut = useMutation({
    mutationFn: (taskId: string) => postAgentResearch(taskId),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['agent', 'log'] }) },
  })

  const scheduleMut = useMutation({
    mutationFn: (taskId: string) => postAgentSchedule(taskId),
  })

  // ── Action dispatcher ────────────────────────────────────────────────────
  const handleAction = useCallback((action: string, task: Task, tri: Triage): void => {
    const wantsAcr = action === 'approve' || action === 'acr' ||
      (action === 'run' && tri.skill?.engine === 'acr')
    // Never dispatch to ACR while it's offline — surface nothing, just skip (button is also disabled).
    if (wantsAcr && acrOffline) return

    switch (action) {
      case 'run': {
        if (tri.skill?.engine === 'acr') {
          dispatchAcrMut.mutate({ taskId: task.id, skillId: tri.skill.id })
        } else {
          // Optimistic run via hermes/n8n: mark running.
          qc.setQueryData<Task[]>(['tasks'], (old = []) =>
            old.map((t) => t.id === task.id ? { ...t, agent_status: 'running' } : t),
          )
        }
        incrementJobsToday() // one job consumed, regardless of engine
        break
      }
      case 'approve':
      case 'acr': {
        dispatchAcrMut.mutate({ taskId: task.id, skillId: tri.skill?.id })
        incrementJobsToday()
        break
      }
      case 'research': {
        researchMut.mutate(task.id)
        break
      }
      case 'schedule': {
        scheduleMut.mutate(task.id)
        break
      }
      case 'assist':
      default:
        // No-op for P2-05; P2-06 wires up real draft/assist
        break
    }
  }, [qc, acrOffline, dispatchAcrMut, researchMut, scheduleMut, incrementJobsToday])

  const handleDispatch = useCallback((): void => {
    if (!recommended || budgetLeft <= 0) return
    // handleAction owns the budget increment + ACR-offline guard.
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
              {/* ACR access chip */}
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

          {/* Automation proposals — P2-06 placeholder */}
          {/* P2-06 will render ProposalCard components here */}

          {/* Bucket sections — non-empty only, fixed order per AC-3 */}
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

          {/* Skills & automations — P2-06 will replace stubs with SkillCard grid */}
          <Section label="Skills & automations" count={skills.length} hint="your recurring work, absorbed — Don't Repeat Yourself">
            {skills.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {skills.map((s) => <SkillStub key={s.id} skill={s} />)}
              </div>
            ) : (
              <div className="text-sm text-ink-muted py-4 text-center">
                No skills yet — they&apos;re created as Hermes learns your repeatable work (P2-06).
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
