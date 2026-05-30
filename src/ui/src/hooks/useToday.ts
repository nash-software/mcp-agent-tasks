import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  fetchToday,
  scheduleTask,
  transitionTask,
  updateTaskPriority,
  updateTask,
  fetchTasks,
} from '../api'
import type { TodayResponse, Task, TaskPriority } from '../types'
import { PRI_RANK, localToday } from '../lib/format'

const PRIORITY_CYCLE: TaskPriority[] = ['critical', 'high', 'medium', 'low']

function nextPriority(current: TaskPriority): TaskPriority {
  const idx = PRIORITY_CYCLE.indexOf(current)
  return PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length]
}

export interface UseTodayReturn {
  data: TodayResponse | null
  isLoading: boolean
  error: Error | null
  draftTasks: Task[]
  scheduleForToday: (taskId: string) => Promise<void>
  /**
   * Schedule a task to Today AND set its estimate_hours in one compound action.
   * Used by the EstimatePrompt flow (P4-04).
   * - estimateHours: the chosen estimate (> 0). If null/undefined, schedules only (skip path).
   * - The schedule always happens; the PATCH happens only when estimateHours is provided.
   * - If the PATCH fails, the task still lands in Today (acceptable degradation per spec).
   */
  scheduleWithEstimate: (taskId: string, estimateHours: number | null) => Promise<void>
  removeFromToday: (taskId: string) => Promise<void>
  markDone: (taskId: string) => Promise<void>
  pauseTask: (taskId: string) => Promise<void>
  blockTask: (taskId: string, reason?: string) => Promise<void>
  cyclePriority: (taskId: string, currentPriority: TaskPriority) => Promise<void>
}

export function useToday(targetMinutes?: number): UseTodayReturn {
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['today', targetMinutes],
    queryFn: () => fetchToday(targetMinutes),
    staleTime: 15000,
    refetchInterval: 30000,
  })

  // Draft tasks for "Needs your call" section (P2-04b stub)
  const { data: draftTasks = [] } = useQuery({
    queryKey: ['tasks', 'draft'],
    queryFn: () => fetchTasks({ status: 'draft' }),
    staleTime: 60000,
  })

  const today = localToday()

  // Helper: invalidate both today + tasks query keys
  function invalidate(): Promise<unknown[]> {
    return Promise.all([
      qc.invalidateQueries({ queryKey: ['today'] }),
      qc.invalidateQueries({ queryKey: ['tasks'] }),
    ])
  }

  // --- Schedule/Unschedule mutation (optimistic) ---
  const scheduleMutation = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string | null }) =>
      scheduleTask(id, date),
    onMutate: async ({ id, date }) => {
      await qc.cancelQueries({ queryKey: ['today'] })
      const prev = qc.getQueryData<TodayResponse>(['today', targetMinutes])
      if (prev) {
        qc.setQueryData<TodayResponse>(['today', targetMinutes], (d) => {
          if (!d) return d
          if (date) {
            // moving candidate → committed
            const task = d.candidates.find(t => t.id === id)
            if (!task) return d
            const updatedTask = { ...task, scheduled_for: date }
            const newCommitted = [...d.committed, updatedTask].sort(
              (a, b) => PRI_RANK[a.priority] - PRI_RANK[b.priority]
            )
            const addedMinutes = (task.estimate_hours ?? 0) * 60
            return {
              ...d,
              committed: newCommitted,
              candidates: d.candidates.filter(t => t.id !== id),
              capacity: {
                ...d.capacity,
                committedMinutes: d.capacity.committedMinutes + addedMinutes,
              },
            }
          } else {
            // moving committed → candidate
            const task = d.committed.find(t => t.id === id)
            if (!task) return d
            const updatedTask = { ...task, scheduled_for: null }
            const removedMinutes = task.status !== 'done' && task.status !== 'cancelled'
              ? (task.estimate_hours ?? 0) * 60
              : 0
            return {
              ...d,
              committed: d.committed.filter(t => t.id !== id),
              candidates: [...d.candidates, updatedTask],
              capacity: {
                ...d.capacity,
                committedMinutes: Math.max(0, d.capacity.committedMinutes - removedMinutes),
              },
            }
          }
        })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['today', targetMinutes], ctx.prev)
    },
    onSettled: () => { void invalidate() },
  })

  // --- Mark done mutation (optimistic) ---
  const markDoneMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => transitionTask(id, 'done'),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['today'] })
      const prev = qc.getQueryData<TodayResponse>(['today', targetMinutes])
      if (prev) {
        qc.setQueryData<TodayResponse>(['today', targetMinutes], (d) => {
          if (!d) return d
          const update = (tasks: Task[]): Task[] =>
            tasks.map(t => t.id === id ? { ...t, status: 'done' as const } : t)
          // Done tasks sink to bottom of committed list
          const newCommitted = update(d.committed).sort((a, b) => {
            const doneDiff = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)
            if (doneDiff !== 0) return doneDiff
            return PRI_RANK[a.priority] - PRI_RANK[b.priority]
          })
          // Remove from capacity (done tasks don't consume capacity)
          const doneTask = d.committed.find(t => t.id === id)
          const freedMinutes = doneTask ? (doneTask.estimate_hours ?? 0) * 60 : 0
          return {
            ...d,
            committed: newCommitted,
            capacity: {
              ...d.capacity,
              committedMinutes: Math.max(0, d.capacity.committedMinutes - freedMinutes),
            },
          }
        })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['today', targetMinutes], ctx.prev)
    },
    onSettled: () => { void invalidate() },
  })

  // --- Pause mutation (→ todo, optimistic) ---
  const pauseMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => transitionTask(id, 'todo'),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['today'] })
      const prev = qc.getQueryData<TodayResponse>(['today', targetMinutes])
      if (prev) {
        qc.setQueryData<TodayResponse>(['today', targetMinutes], (d) => {
          if (!d) return d
          const update = (tasks: Task[]): Task[] =>
            tasks.map(t => t.id === id ? { ...t, status: 'todo' as const } : t)
          return { ...d, committed: update(d.committed) }
        })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['today', targetMinutes], ctx.prev)
    },
    onSettled: () => { void invalidate() },
  })

  // --- Block mutation (optimistic) ---
  const blockMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      transitionTask(id, 'blocked', reason),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['today'] })
      const prev = qc.getQueryData<TodayResponse>(['today', targetMinutes])
      if (prev) {
        qc.setQueryData<TodayResponse>(['today', targetMinutes], (d) => {
          if (!d) return d
          const update = (tasks: Task[]): Task[] =>
            tasks.map(t => t.id === id ? { ...t, status: 'blocked' as const } : t)
          return { ...d, committed: update(d.committed) }
        })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['today', targetMinutes], ctx.prev)
    },
    onSettled: () => { void invalidate() },
  })

  // --- Cycle priority mutation (optimistic) ---
  const cyclePriorityMutation = useMutation({
    mutationFn: ({ id, newPriority }: { id: string; newPriority: TaskPriority }) =>
      updateTaskPriority(id, newPriority),
    onMutate: async ({ id, newPriority }) => {
      await qc.cancelQueries({ queryKey: ['today'] })
      const prev = qc.getQueryData<TodayResponse>(['today', targetMinutes])
      if (prev) {
        qc.setQueryData<TodayResponse>(['today', targetMinutes], (d) => {
          if (!d) return d
          const update = (tasks: Task[]): Task[] =>
            tasks.map(t => t.id === id ? { ...t, priority: newPriority } : t)
          const newCommitted = update(d.committed).sort((a, b) => {
            const doneDiff = (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)
            if (doneDiff !== 0) return doneDiff
            return PRI_RANK[a.priority] - PRI_RANK[b.priority]
          })
          return { ...d, committed: newCommitted, candidates: update(d.candidates) }
        })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['today', targetMinutes], ctx.prev)
    },
    onSettled: () => { void invalidate() },
  })

  // Public API (void wrappers — callers don't need the Task result)
  async function scheduleForToday(taskId: string): Promise<void> {
    await scheduleMutation.mutateAsync({ id: taskId, date: today })
  }

  /**
   * P4-04: Schedule to Today AND optionally set estimate_hours.
   * Optimistic update for the schedule; PATCH for estimate fires in parallel.
   * PATCH failure is surfaced via console.warn but does not un-commit the task.
   */
  async function scheduleWithEstimate(taskId: string, estimateHours: number | null): Promise<void> {
    // Always schedule first (optimistic update, rollback on failure)
    await scheduleMutation.mutateAsync({ id: taskId, date: today })

    // If an estimate was provided, patch it (best-effort — failure is acceptable)
    if (estimateHours !== null && estimateHours > 0) {
      try {
        await updateTask(taskId, { estimate_hours: estimateHours })
        // Refresh today so capacity gauge reflects the new estimate
        void invalidate()
      } catch (patchErr) {
        console.warn('[useToday] estimate PATCH failed (task still committed):', patchErr)
        // Surface passively: refetch so the task shows WITHOUT an estimate and the
        // capacity gauge counts it as unestimated, making the failure visible (codex F2).
        void invalidate()
      }
    }
  }

  async function removeFromToday(taskId: string): Promise<void> {
    await scheduleMutation.mutateAsync({ id: taskId, date: null })
  }

  async function markDone(taskId: string): Promise<void> {
    await markDoneMutation.mutateAsync({ id: taskId })
  }

  async function pauseTask(taskId: string): Promise<void> {
    await pauseMutation.mutateAsync({ id: taskId })
  }

  async function blockTask(taskId: string, reason?: string): Promise<void> {
    await blockMutation.mutateAsync({ id: taskId, reason })
  }

  async function cyclePriority(taskId: string, currentPriority: TaskPriority): Promise<void> {
    await cyclePriorityMutation.mutateAsync({
      id: taskId,
      newPriority: nextPriority(currentPriority),
    })
  }

  return {
    data: data ?? null,
    isLoading,
    error: error as Error | null,
    draftTasks,
    scheduleForToday,
    scheduleWithEstimate,
    removeFromToday,
    markDone,
    pauseTask,
    blockTask,
    cyclePriority,
  }
}
