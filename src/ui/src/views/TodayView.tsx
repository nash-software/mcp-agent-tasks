/**
 * TodayView — rebuilt for P1-03.
 *
 * Layout: HeroTask → CapacityGauge → committed list → collapsible candidate queue
 *
 * Selection state is owned by App (P1-02). TodayView receives selectedTaskId + onSelectTask.
 * Keyboard actions (J/K, D, P, T) are dispatched by useGlobalKeyboard in App.
 * Filter forward-compat: hero + capacity never filtered; committed + candidates can be narrowed.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { useToday } from '../hooks/useToday'
import { HeroTask } from '../components/HeroTask'
import { CapacityGauge } from '../components/CapacityGauge'
import { TaskCard } from '../components/TaskCard'
import { EstimatePrompt } from '../components/EstimatePrompt'
import { AreaChip } from '../components/atoms'
import { ViewHeader } from '../components/ViewHeader'
import { Minimize2, Maximize2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchTasks } from '../api'
import type { Task, TaskArea, TaskPriority } from '../types'
import { PRI_RANK } from '../lib/format'
import { type Filter, matchFilter, type Area } from '../lib/filter'
import { isCommittedBucket } from '../lib/today-buckets'

// ── Constants ────────────────────────────────────────────────────────────

const DEFAULT_TARGET_MINUTES = 6 * 60 // 6 hours

const AREA_ORDER: TaskArea[] = ['client', 'personal', 'internal', 'outsource']

function readTargetMinutes(): number {
  const raw = localStorage.getItem('lifeos-target')
  if (!raw) return DEFAULT_TARGET_MINUTES
  const v = parseInt(raw, 10)
  return !isNaN(v) && v > 0 ? v : DEFAULT_TARGET_MINUTES
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sortCommitted(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    // Done tasks sink to the bottom
    const doneDiff = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)
    if (doneDiff !== 0) return doneDiff
    return PRI_RANK[a.priority] - PRI_RANK[b.priority]
  })
}

function groupByArea(tasks: Task[]): Map<TaskArea, Task[]> {
  const map = new Map<TaskArea, Task[]>()
  for (const area of AREA_ORDER) {
    const group = tasks.filter(t => (t.area ?? 'internal') === area)
    if (group.length > 0) {
      map.set(area, group.sort((a, b) => PRI_RANK[a.priority] - PRI_RANK[b.priority]))
    }
  }
  return map
}

// ── Props ────────────────────────────────────────────────────────────────

interface TodayViewProps {
  filter: Filter
  areaMap?: Record<string, Area>
  selectedTaskId?: string | null
  onSelectTask?: (id: string | null) => void
  onOpenDetail?: (task: Task) => void
  onVisibleIdsChange?: (ids: string[]) => void
  focusMode?: boolean
  onToggleFocus?: () => void
}

// ── Component ────────────────────────────────────────────────────────────

export function TodayView({
  filter,
  areaMap = {},
  selectedTaskId,
  onSelectTask,
  onOpenDetail,
  onVisibleIdsChange,
  focusMode = false,
  onToggleFocus,
}: TodayViewProps): React.JSX.Element {
  const [targetMinutes, setTargetMinutes] = useState<number>(readTargetMinutes)
  const [candidatesOpen, setCandidatesOpen] = useState(true)
  const [needsCallOpen, setNeedsCallOpen] = useState(false)
  /** P4-04: task id for which the estimate prompt is open, or null */
  const [estimatePromptTaskId, setEstimatePromptTaskId] = useState<string | null>(null)

  const {
    data,
    isLoading,
    error,
    scheduleForToday,
    scheduleWithEstimate,
    markDone,
    pauseTask,
    blockTask,
  } = useToday(targetMinutes)

  // "Needs your call" — draft tasks (P2-04b stub)
  const { data: draftTasks = [] } = useQuery({
    queryKey: ['tasks', 'draft'],
    queryFn: () => fetchTasks({ status: 'draft' }),
    staleTime: 60000,
  })


  // ── Derived lists (filtering-ready structure) ─────────────────────────

  const committed = data?.committed ?? []
  const candidates = data?.candidates ?? []
  const capacity = data?.capacity ?? { committedMinutes: 0, targetMinutes }

  // Hero: the first in_progress task (defensive: log warning if multiple)
  const inProgressTasks = committed.filter(t => t.status === 'in_progress')
  if (inProgressTasks.length > 1) {
    console.warn('[TodayView] Multiple in_progress tasks — rendering highest-priority as hero')
  }
  const heroTask: Task | null = inProgressTasks[0] ?? null

  // AC3: filtering narrows the committed list + candidate queue ONLY — never the hero or
  // capacity gauge (hero is the single current focus; capacity is the whole day's load).
  // Committed list: all scheduled today excluding the hero, then matchFilter.
  const committedList = sortCommitted(
    committed
      // isCommittedBucket excludes the hero (in_progress) and drafts so a task id never renders in
      // two Today buckets (which made selecting it highlight both rows). See lib/today-buckets.
      .filter(isCommittedBucket)
      .filter(t => matchFilter(filter, t.project ?? '', t.area, areaMap))
  )

  // Candidates: scheduled_for == null && status === 'todo' (server already filters this)
  const filteredCandidates = candidates.filter(t => matchFilter(filter, t.project ?? '', t.area, areaMap))
  const candidatesByArea = groupByArea(filteredCandidates)

  // P4-04: Count committed (non-done) tasks with no estimate
  // Used for the capacity gauge "N unestimated" hint (AC 6)
  const unestimatedCount = committed.filter(
    t => t.status !== 'done'
      && (t.estimate_hours == null || t.estimate_hours <= 0)
  ).length

  // P4-04: Task for which the estimate prompt is open (both committed candidates + draft tasks)
  const estimatePromptTask: Task | null =
    estimatePromptTaskId
      ? (candidates.find(t => t.id === estimatePromptTaskId)
          ?? draftTasks.find(t => t.id === estimatePromptTaskId)
          ?? null)
      : null

  // Flatten visible IDs for keyboard navigation (hero first, then committed, then candidates)
  const visibleIds: string[] = [
    ...(heroTask ? [heroTask.id] : []),
    ...committedList.map(t => t.id),
    ...filteredCandidates.map(t => t.id),
  ]

  // Notify App of current visible IDs whenever they change
  useEffect(() => {
    onVisibleIdsChange?.(visibleIds)
  }, [visibleIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Target change handler ─────────────────────────────────────────────

  const handleTargetChange = useCallback((newMinutes: number): void => {
    setTargetMinutes(newMinutes)
    localStorage.setItem('lifeos-target', String(newMinutes))
  }, [])

  // ── Hero action handlers ──────────────────────────────────────────────

  const handleMarkDone = useCallback((task: Task): void => {
    void markDone(task.id)
  }, [markDone])

  const handlePause = useCallback((task: Task): void => {
    void pauseTask(task.id)
  }, [pauseTask])

  const handleBlock = useCallback((task: Task): void => {
    const reason = window.prompt('Reason for blocking (optional):') ?? undefined
    void blockTask(task.id, reason || undefined)
  }, [blockTask])

  const handleOpenDetail = useCallback((task: Task): void => {
    onOpenDetail?.(task)
  }, [onOpenDetail])

  // ── Task row handlers ─────────────────────────────────────────────────

  /**
   * P4-04: Commit task to Today.
   * - If the task already has estimate_hours → schedule immediately (no prompt, AC 7).
   * - If the task has no estimate_hours → open the estimate prompt (AC 1).
   */
  const handleCommit = useCallback((task: Task): void => {
    if (task.estimate_hours != null && task.estimate_hours > 0) {
      // Already estimated — schedule directly, no prompt (AC 7)
      void scheduleForToday(task.id)
    } else {
      // No estimate — open prompt
      setEstimatePromptTaskId(task.id)
    }
  }, [scheduleForToday])

  /** P4-04: User confirmed an estimate in the prompt. */
  const handleEstimateConfirm = useCallback((estimateHours: number): void => {
    if (!estimatePromptTaskId) return
    void scheduleWithEstimate(estimatePromptTaskId, estimateHours)
    setEstimatePromptTaskId(null)
  }, [estimatePromptTaskId, scheduleWithEstimate])

  /** P4-04: User skipped the estimate — still commit the task. */
  const handleEstimateSkip = useCallback((): void => {
    if (!estimatePromptTaskId) return
    void scheduleWithEstimate(estimatePromptTaskId, null)
    setEstimatePromptTaskId(null)
  }, [estimatePromptTaskId, scheduleWithEstimate])

  /** P4-04: User dismissed the prompt without committing. */
  const handleEstimateDismiss = useCallback((): void => {
    setEstimatePromptTaskId(null)
  }, [])

  // ── Loading / error states ────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-24 bg-surface-1 rounded-card animate-pulse" />
        <div className="h-4 bg-surface-1 rounded animate-pulse w-1/2" />
        <div className="space-y-1">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-surface-1 rounded animate-pulse" style={{ height: 'var(--row-h, 40px)' }} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-status-red text-sm">
        Failed to load: {error.message}
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────

  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long' })
  // Local YYYY-MM-DD so the date matches the (local) weekday around timezone boundaries.
  const isoDate = new Date().toLocaleDateString('en-CA')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--section-gap, 24px)' }}>

      {/* View header */}
      <ViewHeader
        title="Today"
        subtitle={weekday}
        right={
          <>
            <span className="font-mono text-xs text-ink-muted tabular-nums">{isoDate}</span>
            <button
              type="button"
              onClick={onToggleFocus}
              title={focusMode ? 'Exit focus mode (.)' : 'Focus mode (.)'}
              aria-pressed={focusMode}
              className="ml-1 w-6 h-6 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors"
            >
              {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </>
        }
      />

      {/* Hero */}
      <HeroTask
        task={heroTask}
        onDone={handleMarkDone}
        onPause={handlePause}
        onBlock={handleBlock}
        onOpenDetail={handleOpenDetail}
      />

      {/* Capacity gauge */}
      <CapacityGauge
        committedMinutes={capacity.committedMinutes}
        targetMinutes={targetMinutes}
        onTargetChange={handleTargetChange}
        unestimatedCount={unestimatedCount}
      />

      {/* Committed list */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-ink-muted uppercase tracking-wide font-medium">
            Committed today
          </span>
          <span className="text-xs text-ink-faint font-mono">{committedList.length}</span>
        </div>

        {committedList.length === 0 ? (
          <div
            className="flex items-center px-3 rounded-card text-ink-muted text-xs italic"
            style={{ height: 'var(--row-h, 40px)', color: 'var(--color-muted, #71717a)' }}
          >
            Nothing committed yet — commit something from below.
          </div>
        ) : (
          <div className="space-y-2">
            {committedList.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                mode="committed"
                selected={selectedTaskId === task.id}
                onClick={() => {
                  onSelectTask?.(task.id)
                  handleOpenDetail(task)
                }}
                onMarkDone={() => handleMarkDone(task)}
                onOpenDetail={() => handleOpenDetail(task)}
              />
            ))}
          </div>
        )}
      </section>

      {/* P4-04: Estimate prompt — shown inline when committing an unestimated task (AC 1) */}
      {estimatePromptTask !== null && (
        <EstimatePrompt
          taskTitle={estimatePromptTask.title}
          onConfirm={handleEstimateConfirm}
          onSkip={handleEstimateSkip}
          onDismiss={handleEstimateDismiss}
        />
      )}

      {/* Needs your call (P2-04b stub) — hidden when empty */}
      {draftTasks.length > 0 && (
        <section>
          <button
            className="flex items-center gap-2 w-full text-left py-1 text-xs text-ink-muted uppercase tracking-wide font-medium hover:text-ink-2 transition-colors"
            onClick={() => setNeedsCallOpen(o => !o)}
          >
            <span className="text-xs">{needsCallOpen ? '▾' : '▸'}</span>
            Needs your call
            <span className="font-mono text-ink-faint">{draftTasks.length}</span>
          </button>
          {needsCallOpen && (
            <div>
              {draftTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  mode="candidate"
                  selected={selectedTaskId === task.id}
                  onClick={() => { onSelectTask?.(task.id); handleOpenDetail(task) }}
                  onCommit={() => handleCommit(task)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Candidate queue */}
      {filteredCandidates.length > 0 && (
        <section>
          <button
            className="flex items-center gap-2 w-full text-left py-1 text-xs text-ink-muted uppercase tracking-wide font-medium hover:text-ink-2 transition-colors"
            onClick={() => setCandidatesOpen(o => !o)}
          >
            <span className="text-xs">{candidatesOpen ? '▾' : '▸'}</span>
            <span>{filteredCandidates.length} unscheduled</span>
            <span className="text-ink-faint normal-case font-normal">commit to today</span>
          </button>

          {candidatesOpen && (
            <div className="mt-1 space-y-3">
              {Array.from(candidatesByArea.entries()).map(([area, tasks]) => (
                <div key={area}>
                  {/* Area group header */}
                  <div className="flex items-center gap-2 px-3 py-1">
                    <AreaChip area={area} />
                    <span className="text-xs font-mono text-ink-faint">{tasks.length}</span>
                  </div>
                  {/* Candidate rows */}
                  {tasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      mode="candidate"
                      selected={selectedTaskId === task.id}
                      onClick={() => { onSelectTask?.(task.id); handleOpenDetail(task) }}
                      onCommit={() => handleCommit(task)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// ── Exported helpers for App keyboard wiring ─────────────────────────────

/**
 * Hook for App to call today-view mutations based on selectedTaskId.
 * Returns handlers that App's keyboard dispatch can call directly.
 */
export function useTodayActions(
  targetMinutes: number,
  selectedTaskId: string | null,
  getTaskById: (id: string) => Task | undefined,
): {
  markDone: () => void
  cyclePriority: () => void
  toggleCommitted: (today: string) => void
} {
  const { markDone, cyclePriority, scheduleForToday, removeFromToday } = useToday(targetMinutes)

  return {
    markDone: () => {
      if (!selectedTaskId) return
      void markDone(selectedTaskId)
    },
    cyclePriority: () => {
      if (!selectedTaskId) return
      const task = getTaskById(selectedTaskId)
      if (!task) return
      void cyclePriority(selectedTaskId, task.priority as TaskPriority)
    },
    toggleCommitted: (today: string) => {
      if (!selectedTaskId) return
      const task = getTaskById(selectedTaskId)
      if (!task) return
      if (task.scheduled_for === today) {
        void removeFromToday(selectedTaskId)
      } else {
        void scheduleForToday(selectedTaskId)
      }
    },
  }
}
