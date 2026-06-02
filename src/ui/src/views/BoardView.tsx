import React, { useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Task, TaskStatus, PanelState } from '../types'
import { useTasks } from '../hooks/useTasks'
import { closeBatch, transitionTask } from '../api'
import { BoardCard } from '../components/BoardCard'
import { ViewHeader } from '../components/ViewHeader'
import { type Filter, matchFilter, type Area } from '../lib/filter'
import { BOARD_STATUSES, COLUMN_LABEL, isValidBoardTransition } from '../lib/transitions'
import { sortTasks, type SortKey, type SortDir } from '../lib/sort'

// ── Droppable column wrapper ───────────────────────────────────────────────

interface DroppableColumnProps {
  status: TaskStatus
  children: React.ReactNode
  isValidTarget: boolean
  activeStatus: TaskStatus | null
}

function DroppableColumn({ status, children, isValidTarget, activeStatus }: DroppableColumnProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  // Only show visual target feedback when a drag is active
  const isDragActive = activeStatus !== null
  const isInvalid = isDragActive && !isValidTarget && activeStatus !== status

  return (
    <div
      ref={setNodeRef}
      className={[
        'min-h-[80px] rounded-lg transition-colors duration-100',
        isOver && isValidTarget
          ? 'bg-accent/8 ring-1 ring-accent/40'
          : isOver && !isValidTarget
            ? 'bg-status-red/8 ring-1 ring-status-red/30'
            : isDragActive && isInvalid
              ? 'opacity-60'
              : '',
      ].join(' ')}
    >
      {children}
    </div>
  )
}

// ── Main BoardView ─────────────────────────────────────────────────────────

interface Props {
  filter: Filter
  areaMap?: Record<string, Area>
  /** MCPAT-069 Phase C: sort applied within each board column. */
  sort?: { key: SortKey; dir: SortDir }
  /** MCPAT-069: render-time clock injected by App so date-preset + attention filtering use one instant. */
  now?: number
  onOpenPanel: (panel: PanelState) => void
}

export function BoardView({ filter, areaMap = {}, sort, now = Date.now(), onOpenPanel }: Props): React.JSX.Element {
  const { tasks: allTasks, isLoading, error } = useTasks()
  const tasks = allTasks.filter(t => matchFilter(filter, t, areaMap, now))

  // Track which task is being dragged (for DragOverlay rendering)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  // Error state for failed transitions (visible to user)
  const [transitionError, setTransitionError] = useState<string | null>(null)

  const queryClient = useQueryClient()

  // "Complete all" — batch-close every done task (P4-02)
  const completeAll = useMutation({
    mutationFn: () => closeBatch(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['today'] })
    },
  })

  // Transition mutation with optimistic update + rollback
  const transition = useMutation({
    mutationFn: ({ id, to }: { id: string; to: TaskStatus }) => transitionTask(id, to),
    onMutate: async ({ id, to }) => {
      // Cancel any in-flight refetches
      await queryClient.cancelQueries({ queryKey: ['tasks'] })
      // Snapshot for rollback
      const snapshot = queryClient.getQueryData<Task[]>(['tasks'])
      // Optimistic update
      queryClient.setQueryData<Task[]>(['tasks'], old =>
        old
          ? old.map(t => (t.id === id ? { ...t, status: to } : t))
          : old
      )
      return { snapshot }
    },
    onError: (err, _vars, ctx) => {
      // Roll back to the snapshot
      if (ctx?.snapshot !== undefined) {
        queryClient.setQueryData(['tasks'], ctx.snapshot)
      }
      setTransitionError(err instanceof Error ? err.message : 'Transition failed')
      // Auto-clear after 5 s
      setTimeout(() => { setTransitionError(null) }, 5000)
    },
    onSuccess: () => {
      setTransitionError(null)
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['today'] })
    },
  })

  // Sensors split by modality (P5-07): MouseSensor for desktop (8px distance so plain clicks still open
  // the panel) and TouchSensor with a 200ms long-press delay so on phones a short touch scrolls the board
  // and press-and-hold starts a drag. NOTE: PointerSensor is deliberately NOT used — pointer events fire
  // for touch too, so its distance activation would race the TouchSensor delay and hijack scroll.
  //          KeyboardSensor for a11y (Space/Enter picks up, arrows move, Space/Enter drops)
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragStart = useCallback((event: DragStartEvent): void => {
    const task = event.active.data.current?.task as Task | undefined
    if (task) {
      setActiveTask(task)
      setTransitionError(null)
    }
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent): void => {
    setActiveTask(null)

    const { active, over } = event
    if (!over) return // dropped outside any droppable

    const taskData = active.data.current?.task as Task | undefined
    if (!taskData) return

    const toStatus = over.id as TaskStatus
    if (!(BOARD_STATUSES as readonly TaskStatus[]).includes(toStatus)) return // dropped outside a column

    // No-op: same column
    if (taskData.status === toStatus) return

    // Client-side validity check — gives immediate feedback before server round-trip
    // The server validates too; a 409 triggers rollback.
    if (!isValidBoardTransition(taskData.status, toStatus)) {
      setTransitionError(
        `Cannot move from "${taskData.status}" to "${COLUMN_LABEL[toStatus] ?? toStatus}" — invalid transition`,
      )
      setTimeout(() => { setTransitionError(null) }, 5000)
      return
    }

    transition.mutate({ id: taskData.id, to: toStatus })
  }, [transition])

  // ── Loading skeleton ─────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div
        className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      >
        {BOARD_STATUSES.map(status => (
          <div key={status} className="space-y-3">
            <div className="h-4 bg-surface-2 rounded w-24 animate-pulse" />
            {[1, 2, 3].map(i => (
              <div key={i} className="h-10 bg-surface-2 rounded animate-pulse" />
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-status-red text-sm">
        Failed to load tasks: {error.message}
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      <ViewHeader title="Board" subtitle="All tasks across every project" />

      {/* Transition error banner */}
      {transitionError && (
        <div
          role="alert"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg
                     bg-status-red/10 border border-status-red/30 text-status-red text-sm"
        >
          <span className="shrink-0">⚠</span>
          <span>{transitionError}</span>
          <button
            type="button"
            onClick={() => { setTransitionError(null) }}
            className="ml-auto text-status-red/60 hover:text-status-red transition-colors"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements: {
            onDragStart({ active }) {
              const t = active.data.current?.task as Task | undefined
              return `Picked up task: ${t?.title ?? active.id}. Use arrow keys to move between columns, Space or Enter to drop.`
            },
            onDragOver({ active, over }) {
              const t = active.data.current?.task as Task | undefined
              if (!over) return `Task ${t?.title ?? active.id} is not over a column.`
              const colLabel = COLUMN_LABEL[over.id as TaskStatus] ?? String(over.id)
              const valid = isValidBoardTransition(
                t?.status ?? 'todo',
                over.id as TaskStatus,
              )
              return valid
                ? `Task over column "${colLabel}". Drop to move.`
                : `Column "${colLabel}" is not a valid target for this task.`
            },
            onDragEnd({ active, over }) {
              const t = active.data.current?.task as Task | undefined
              if (!over) return `Task ${t?.title ?? active.id} dropped — no column.`
              const colLabel = COLUMN_LABEL[over.id as TaskStatus] ?? String(over.id)
              return `Task dropped onto column "${colLabel}".`
            },
            onDragCancel({ active }) {
              const t = active.data.current?.task as Task | undefined
              return `Drag cancelled — task "${t?.title ?? active.id}" returned to original position.`
            },
          },
        }}
      >
        <div
          className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
        >
          {BOARD_STATUSES.map(status => {
            // MCPAT-069 C4: sort within each column; column-by-status layout unchanged
            const colFiltered = tasks.filter((t: Task) => t.status === status)
            const colTasks = sort ? sortTasks(colFiltered, sort.key, sort.dir) : colFiltered
            const isValidTarget = activeTask !== null
              ? isValidBoardTransition(activeTask.status, status)
              : true

            return (
              <div key={status} className="space-y-2">
                {/* Column header */}
                <div className="flex items-center justify-between">
                  <h2
                    className="font-semibold text-ink-muted uppercase tracking-wider"
                    style={{ fontSize: 11 }}
                  >
                    {COLUMN_LABEL[status]}{' '}
                    <span className="text-ink-faint font-mono tabular-nums">
                      ({colTasks.length})
                    </span>
                  </h2>

                  {/* Complete all — closes every done task into the Completed tab (P4-02) */}
                  {status === 'done' && colTasks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Complete all Done tasks? They move to the Completed tab.')) {
                          completeAll.mutate()
                        }
                      }}
                      disabled={completeAll.isPending}
                      className="text-[10px] font-medium text-accent hover:underline disabled:opacity-50"
                      title="Move all done tasks to Completed"
                    >
                      {completeAll.isPending ? 'Completing…' : 'Complete all'}
                    </button>
                  )}
                </div>

                {/* Droppable column area */}
                <DroppableColumn
                  status={status}
                  isValidTarget={isValidTarget}
                  activeStatus={activeTask?.status ?? null}
                >
                  <div className="space-y-2">
                    {colTasks.map((task: Task) => (
                      <BoardCard
                        key={task.id}
                        task={task}
                        onOpenPanel={onOpenPanel}
                      />
                    ))}

                    {colTasks.length === 0 && (
                      <p className="text-xs text-ink-muted italic px-3 py-2">No tasks</p>
                    )}
                  </div>
                </DroppableColumn>
              </div>
            )
          })}
        </div>

        {/* DragOverlay — renders the card being dragged, floating above everything */}
        <DragOverlay>
          {activeTask !== null && (
            <BoardCard
              task={activeTask}
              onOpenPanel={onOpenPanel}
              isOverlay
            />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
