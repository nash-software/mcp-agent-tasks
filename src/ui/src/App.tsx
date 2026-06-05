import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Nav } from './components/Nav'
import { TodayView } from './views/TodayView'
import { BoardView } from './views/BoardView'
import { RoadmapView } from './views/RoadmapView'
import { ActivityView } from './views/ActivityView'
import { BrainDumpView } from './views/BrainDumpView'
import { ArtifactsView } from './views/ArtifactsView'
import { TaskPanel } from './components/TaskPanel'
import { CaptureOverlay } from './components/CaptureOverlay'
import { NewTaskModal } from './components/NewTaskModal'
import { ProjectsModal } from './components/ProjectsModal'
import { LiveFeedSection } from './components/LiveFeedSection'
import { CommandPalette, type PaletteCommand } from './components/CommandPalette'
import { FilterBar, type FilterBarProject } from './components/FilterBar'
import { HermesView } from './views/HermesView'
import { CompletedView } from './views/CompletedView'
import { NotesView } from './views/NotesView'
import { AdvisorView } from './views/AdvisorView'
import { useTasks } from './hooks/useTasks'
import { useToday } from './hooks/useToday'
import { useArtifacts } from './hooks/useArtifacts'
import { useMilestones } from './hooks/useMilestones'
import { useCaptureOverlay } from './hooks/useCaptureOverlay'
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard'
import { NAV } from './lib/nav'
import type { ViewId, PanelState, Task, TaskPriority, TaskArea, Density, TaskType, TaskStatus } from './types'
import { localToday } from './lib/format'
import { fetchProjects, type ProjectEntry, signoffTask, dispatchToAcr } from './api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { type Filter, EMPTY_FILTER, filterActive } from './lib/filter'
import { SortControl } from './components/SortControl'
import { type SortKey, type SortDir, type TodaySortKey, TODAY_SORT_KEYS } from './lib/sort'

const VALID_VIEWS: ViewId[] = ['today', 'board', 'hermes', 'braindump', 'artifacts', 'roadmap', 'activity', 'completed']

// ─── Density types + persistence ────────────────────────────────────────────
const VALID_DENSITIES: Density[] = ['compact', 'balanced', 'airy']

/** Migrate legacy stored values to the Phase-B density names. */
function migrateDensity(raw: string): Density {
  if (raw === 'cozy')     return 'balanced'
  if (raw === 'spacious') return 'airy'
  return VALID_DENSITIES.includes(raw as Density) ? (raw as Density) : 'balanced'
}

function readStoredDensity(): Density {
  try {
    const raw = localStorage.getItem('lifeos-density')
    return raw ? migrateDensity(raw) : 'balanced'
  } catch {
    return 'balanced' // localStorage unavailable (SSR / sandboxed)
  }
}

/** Views that use the full main width (no column cap). All others get the readable column. */
const FULL_WIDTH_VIEWS = new Set<ViewId>(['board'])

/** Transient handoff state from the capture bar to Brain Dump (P2-03). */
interface BrainDumpSeed {
  text: string
  /** Monotonically-increasing token so two handoffs of the same text still re-trigger the consumer effect. */
  nonce: number
}

/** Views the global filter bar applies to (epic §4 — five filterable surfaces). */
const FILTERABLE_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>([
  'today', 'board', 'roadmap', 'artifacts', 'activity', 'notes',
])

/** Views that actually apply the sort (MCPAT-069 C). Roadmap/Activity keep their intrinsic order,
 *  so the Sort control is hidden there rather than shown-but-ignored (no silent omission).
 *  MCPAT-070 Phase C: 'today' removed — Today has its own todaySort toolbar (4 keys, fixed dirs). */
const SORTABLE_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(['board'])

/** Read the persisted Today sort key, validating against the canonical TODAY_SORT_KEYS list. */
function readStoredTodaySort(): TodaySortKey {
  try {
    const raw = localStorage.getItem('lifeos-today-sort')
    return (raw && (TODAY_SORT_KEYS as readonly string[]).includes(raw))
      ? (raw as TodaySortKey)
      : 'priority'
  } catch {
    return 'priority'
  }
}

function readStoredView(): ViewId {
  const raw = localStorage.getItem('lifeos-view')
  return (raw && VALID_VIEWS.includes(raw as ViewId)) ? (raw as ViewId) : 'today'
}

/** Read the persisted filter, falling back to EMPTY_FILTER on missing / corrupt / legacy JSON.
 * MCPAT-069 B7: spread EMPTY_FILTER first so an old {projects,areas} blob produces a full Filter
 * with new dims defaulted (never undefined). Each new dim is validated against its allowed set.
 */
function readStoredFilter(): Filter {
  try {
    const raw = localStorage.getItem('lifeos-filter')
    if (!raw) return EMPTY_FILTER
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return EMPTY_FILTER
    const p = parsed as Record<string, unknown>
    // Validate each dimension individually; missing or invalid → default from EMPTY_FILTER
    const validAreas = (v: unknown): TaskArea[] =>
      Array.isArray(v)
        ? (v as unknown[]).filter((x): x is TaskArea =>
            x === 'client' || x === 'personal' || x === 'outsource' || x === 'internal')
        : []
    const validStrings = (v: unknown): string[] =>
      Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : []
    const validTypes = (v: unknown): TaskType[] =>
      Array.isArray(v)
        ? (v as unknown[]).filter((x): x is TaskType =>
            x === 'feature' || x === 'bug' || x === 'chore' || x === 'spike' ||
            x === 'refactor' || x === 'spec' || x === 'plan')
        : []
    const validStatuses = (v: unknown): TaskStatus[] =>
      Array.isArray(v)
        ? (v as unknown[]).filter((x): x is TaskStatus =>
            x === 'todo' || x === 'in_progress' || x === 'done' || x === 'blocked' ||
            x === 'archived' || x === 'draft' || x === 'approved' || x === 'closed')
        : []
    const validPriorities = (v: unknown): TaskPriority[] =>
      Array.isArray(v)
        ? (v as unknown[]).filter((x): x is TaskPriority =>
            x === 'critical' || x === 'high' || x === 'medium' || x === 'low')
        : []
    const validScheduled = (v: unknown): Filter['scheduled'] =>
      (v === 'today' || v === 'week' || v === 'overdue' || v === 'none') ? v : null
    const validWindow = (v: unknown): '24h' | '7d' | '30d' | null =>
      (v === '24h' || v === '7d' || v === '30d') ? v : null

    return {
      ...EMPTY_FILTER,
      projects: validStrings(p['projects']),
      areas: validAreas(p['areas']),
      types: validTypes(p['types']),
      statuses: validStatuses(p['statuses']),
      priorities: validPriorities(p['priorities']),
      milestones: validStrings(p['milestones']),
      attention: typeof p['attention'] === 'boolean' ? p['attention'] : false,
      scheduled: validScheduled(p['scheduled']),
      createdWithin: validWindow(p['createdWithin']),
      updatedWithin: validWindow(p['updatedWithin']),
    }
  } catch {
    return EMPTY_FILTER
  }
}

/** Read the persisted sort, falling back to the default on missing / corrupt JSON. */
function readStoredSort(): { key: SortKey; dir: SortDir } {
  const VALID_KEYS: SortKey[] = ['priority', 'created', 'updated', 'scheduled', 'title', 'complexity', 'estimate']
  const VALID_DIRS: SortDir[] = ['asc', 'desc']
  try {
    const raw = localStorage.getItem('lifeos-sort')
    if (!raw) return { key: 'priority', dir: 'asc' }
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed && typeof parsed === 'object' &&
      VALID_KEYS.includes((parsed as { key?: unknown }).key as SortKey) &&
      VALID_DIRS.includes((parsed as { dir?: unknown }).dir as SortDir)
    ) {
      return parsed as { key: SortKey; dir: SortDir }
    }
    return { key: 'priority', dir: 'asc' }
  } catch {
    return { key: 'priority', dir: 'asc' }
  }
}

export function App(): React.JSX.Element {
  const [view, setView]             = useState<ViewId>(readStoredView)
  const [selectedTaskId, setSel]    = useState<string | null>(null)
  const [panel, setPanel]           = useState<PanelState | null>(null)
  const [cmdkOpen, setCmdkOpen]     = useState(false)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [projectsModalOpen, setProjectsModalOpen] = useState(false)
  const [focusMode, setFocusMode]   = useState(false)
  const [visibleIds, setVisibleIds] = useState<string[]>([])
  const [filter, setFilter]         = useState<Filter>(readStoredFilter)
  const [sort, setSort]             = useState<{ key: SortKey; dir: SortDir }>(readStoredSort)
  const [todaySort, setTodaySort]   = useState<TodaySortKey>(readStoredTodaySort)
  const [density, setDensity]       = useState<Density>(readStoredDensity)
  // P2-03 — transient seed: capture bar hands text to Brain Dump through this state
  const [brainDumpSeed, setBrainDumpSeed] = useState<BrainDumpSeed | null>(null)
  const seedNonceRef = useRef(0) // monotonic — unique nonce per handoff (collision-free vs Date.now)

  // ─── Favourites (P2-02) — persisted to localStorage('lifeos-favs') ──────────
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('lifeos-favs')
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.every((x): x is string => typeof x === 'string')) {
        return parsed
      }
      return []
    } catch {
      return []
    }
  })

  const toggleFav = useCallback((prefix: string): void => {
    setFavorites(fs => fs.includes(prefix) ? fs.filter(x => x !== prefix) : [...fs, prefix])
  }, [])

  useEffect(() => { localStorage.setItem('lifeos-view', view) }, [view])
  useEffect(() => { localStorage.setItem('lifeos-filter', JSON.stringify(filter)) }, [filter])
  useEffect(() => {
    try { localStorage.setItem('lifeos-sort', JSON.stringify(sort)) } catch { /* noop */ }
  }, [sort])
  useEffect(() => {
    try { localStorage.setItem('lifeos-today-sort', todaySort) } catch { /* noop */ }
  }, [todaySort])
  useEffect(() => {
    try {
      localStorage.setItem('lifeos-favs', JSON.stringify(favorites))
    } catch {
      // localStorage may be unavailable — fail silently
    }
  }, [favorites])
  useEffect(() => {
    try { localStorage.setItem('lifeos-density', density) } catch { /* noop */ }
  }, [density])

  const setDensityPersisted = useCallback((d: Density): void => {
    setDensity(d)
  }, [])

  const handleSortChange = useCallback((key: SortKey, dir: SortDir): void => {
    setSort({ key, dir })
  }, [])

  const capture = useCaptureOverlay()
  const { tasks: allTasks } = useTasks()
  const { artifacts } = useArtifacts()
  const { milestones } = useMilestones()
  const { data: projectEntries = [] } = useQuery<ProjectEntry[]>({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  })

  // Prune favourites whose project is no longer in the known set (once projects loads).
  useEffect(() => {
    if (projectEntries.length === 0) return
    const known = new Set(projectEntries.map(p => p.prefix))
    setFavorites(fs => {
      const pruned = fs.filter(f => known.has(f))
      return pruned.length === fs.length ? fs : pruned
    })
  }, [projectEntries])

  // ─── Filter: area map + project list + counts (derived from tasks ∪ /api/projects) ──────
  const areaMap = useMemo((): Record<string, TaskArea> => {
    const map: Record<string, TaskArea> = {}
    for (const t of allTasks) {
      if (t.project && t.area) map[t.project] = t.area
    }
    return map
  }, [allTasks])

  const projectCounts = useMemo((): Record<string, number> => {
    const counts: Record<string, number> = {}
    for (const t of allTasks) {
      if (!t.project) continue
      if (t.status === 'done' || t.status === 'archived') continue
      counts[t.project] = (counts[t.project] ?? 0) + 1
    }
    return counts
  }, [allTasks])

  const navCounts = useMemo((): Partial<Record<ViewId, number>> => {
    const todayStr = localToday()
    let todayCount = 0
    let boardCount = 0
    for (const t of allTasks) {
      if (t.status === 'done' || t.status === 'closed' || t.status === 'archived') continue
      if (t.scheduled_for === todayStr) todayCount++
      if (t.status === 'todo' || t.status === 'in_progress') boardCount++
    }
    const counts: Partial<Record<ViewId, number>> = {}
    if (todayCount > 0)      counts.today     = todayCount
    if (boardCount > 0)      counts.board     = boardCount
    if (artifacts.length > 0) counts.artifacts = artifacts.length
    return counts
  }, [allTasks, artifacts])

  const filterProjects = useMemo((): FilterBarProject[] => {
    const prefixes = new Set<string>()
    for (const t of allTasks) if (t.project) prefixes.add(t.project)
    for (const p of projectEntries) prefixes.add(p.prefix)
    // Build a lookup so the FilterBar can show "PREFIX — Name" when a name exists (MCPAT-063).
    const nameByPrefix = new Map(projectEntries.map(p => [p.prefix, p.name]))
    return Array.from(prefixes)
      .sort((a, b) => a.localeCompare(b))
      .map(prefix => {
        const projectName = nameByPrefix.get(prefix)
        return { prefix, name: projectName ?? prefix, area: areaMap[prefix] ?? null }
      })
  }, [allTasks, projectEntries, areaMap])

  const toggleProject = useCallback((prefix: string): void => {
    setFilter(f => ({
      ...f,
      projects: f.projects.includes(prefix)
        ? f.projects.filter(p => p !== prefix)
        : [...f.projects, prefix],
    }))
  }, [])

  const toggleArea = useCallback((area: TaskArea): void => {
    setFilter(f => ({
      ...f,
      areas: f.areas.includes(area)
        ? f.areas.filter(a => a !== area)
        : [...f.areas, area],
    }))
  }, [])

  const toggleType = useCallback((type: TaskType): void => {
    setFilter(f => ({
      ...f,
      types: f.types.includes(type) ? f.types.filter(t => t !== type) : [...f.types, type],
    }))
  }, [])

  const toggleStatus = useCallback((status: TaskStatus): void => {
    setFilter(f => ({
      ...f,
      statuses: f.statuses.includes(status) ? f.statuses.filter(s => s !== status) : [...f.statuses, status],
    }))
  }, [])

  const togglePriority = useCallback((priority: TaskPriority): void => {
    setFilter(f => ({
      ...f,
      priorities: f.priorities.includes(priority) ? f.priorities.filter(p => p !== priority) : [...f.priorities, priority],
    }))
  }, [])

  const toggleMilestone = useCallback((milestoneId: string): void => {
    setFilter(f => ({
      ...f,
      milestones: f.milestones.includes(milestoneId) ? f.milestones.filter(m => m !== milestoneId) : [...f.milestones, milestoneId],
    }))
  }, [])

  const toggleAttention = useCallback((): void => {
    setFilter(f => ({ ...f, attention: !f.attention }))
  }, [])

  const setScheduled = useCallback((v: Filter['scheduled']): void => {
    setFilter(f => ({ ...f, scheduled: v }))
  }, [])

  const setCreatedWithin = useCallback((v: Filter['createdWithin']): void => {
    setFilter(f => ({ ...f, createdWithin: v }))
  }, [])

  const setUpdatedWithin = useCallback((v: Filter['updatedWithin']): void => {
    setFilter(f => ({ ...f, updatedWithin: v }))
  }, [])

  const clearFilter = useCallback((): void => { setFilter(EMPTY_FILTER) }, [])

  const [targetMinutes] = useState<number>(() => {
    const raw = localStorage.getItem('lifeos-target')
    if (!raw) return 6 * 60
    const v = parseInt(raw, 10)
    return !isNaN(v) && v > 0 ? v : 6 * 60
  })
  const today = useRef(localToday())
  const todayHook = useToday(targetMinutes)
  const qc = useQueryClient()

  // ─── Hermes sign-off mutation (P4-06a) ───────────────────────────────────
  const signoffMut = useMutation({
    mutationFn: (taskId: string) => signoffTask(taskId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['today'] })
    },
  })

  // ─── ACR dispatch mutation (P4-06a) ──────────────────────────────────────
  const acrDispatchMut = useMutation({
    mutationFn: (taskId: string) => dispatchToAcr(taskId, { source: 'hermes' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['acr', 'status'] })
    },
  })

  const panelTask = panel ? (allTasks.find(t => t.id === panel.taskId) ?? null) : null

  const getTaskById = useCallback((id: string): Task | undefined => {
    return allTasks.find(t => t.id === id) ??
      todayHook.data?.committed.find(t => t.id === id) ??
      todayHook.data?.candidates.find(t => t.id === id)
  }, [allTasks, todayHook.data])

  const handleViewChange = useCallback((v: ViewId): void => {
    setView(v)
    setPanel(null)
  }, [])

  const handlers = useMemo(() => ({
    setView: handleViewChange,
    setPanel,
    setSel,
    setCmdkOpen,
    setFocusMode,
    moveSelection: (dir: 'up' | 'down') => {
      setSel(prev => {
        if (visibleIds.length === 0) return prev
        const idx = prev ? visibleIds.indexOf(prev) : -1
        if (dir === 'down') {
          return visibleIds[Math.min(idx + 1, visibleIds.length - 1)] ?? null
        } else {
          return visibleIds[Math.max(idx - 1, 0)] ?? null
        }
      })
    },
    markDone: () => {
      if (!selectedTaskId) return
      void todayHook.markDone(selectedTaskId)
    },
    cyclePriority: () => {
      if (!selectedTaskId) return
      const task = getTaskById(selectedTaskId)
      if (!task) return
      void todayHook.cyclePriority(selectedTaskId, task.priority as TaskPriority)
    },
    toggleCommitted: () => {
      if (!selectedTaskId) return
      const task = getTaskById(selectedTaskId)
      if (!task) return
      if (task.scheduled_for === today.current) {
        void todayHook.removeFromToday(selectedTaskId)
      } else {
        void todayHook.scheduleForToday(selectedTaskId)
      }
    },
  }), [handleViewChange, setPanel, setSel, setCmdkOpen, setFocusMode,
    selectedTaskId, visibleIds, todayHook, getTaskById])

  useGlobalKeyboard({
    view,
    selectedTaskId,
    panel,
    focusMode,
    cmdkOpen,
    visibleIds,
    focusCapture: capture.focusCapture,
    handlers,
  })

  // ─── Command palette buildCommands ────────────────────────────────────────
  const commands = useMemo((): PaletteCommand[] => {
    const cmds: PaletteCommand[] = []
    const selectedTask: Task | undefined = selectedTaskId
      ? allTasks.find(t => t.id === selectedTaskId) ??
        todayHook.data?.committed.find(t => t.id === selectedTaskId) ??
        todayHook.data?.candidates.find(t => t.id === selectedTaskId)
      : undefined

    // 1. Selected task group (only when a task is focused and resolved)
    if (selectedTask) {
      const isScheduledToday = selectedTask.scheduled_for === today.current
      cmds.push({
        id: 'sel-mark-done',
        cat: 'Selected task',
        label: 'Mark done',
        sub: selectedTask.id,
        run: () => { void todayHook.markDone(selectedTask.id) },
      })
      cmds.push({
        id: 'sel-commit-toggle',
        cat: 'Selected task',
        label: isScheduledToday ? 'Remove from today' : 'Commit to today',
        sub: selectedTask.id,
        run: () => {
          if (isScheduledToday) {
            void todayHook.removeFromToday(selectedTask.id)
          } else {
            void todayHook.scheduleForToday(selectedTask.id)
          }
        },
      })
      // Sign off to Hermes: only available when task is not already signed off (agent_status absent)
      cmds.push({
        id: 'sel-sign-off',
        cat: 'Selected task',
        label: 'Sign off to Hermes',
        sub: selectedTask.id,
        disabled: selectedTask.agent_status === 'scheduled',
        disabledHint: selectedTask.agent_status === 'scheduled' ? 'Already signed off' : undefined,
        run: () => { signoffMut.mutate(selectedTask.id) },
      })
      cmds.push({
        id: 'sel-dispatch-acr',
        cat: 'Selected task',
        label: 'Dispatch to ACR',
        sub: selectedTask.id,
        run: () => { acrDispatchMut.mutate(selectedTask.id) },
      })
      cmds.push({
        id: 'sel-open-detail',
        cat: 'Selected task',
        label: 'Open detail',
        sub: selectedTask.id,
        run: () => { setPanel({ mode: 'detail', taskId: selectedTask.id }) },
      })
    }

    // 2. Create group
    cmds.push({
      id: 'create-quick-capture',
      cat: 'Create',
      label: 'Quick capture',
      sub: 'Focus capture bar',
      kbd: 'Ctrl+Space',
      run: () => { capture.focusCapture() },
    })
    cmds.push({
      id: 'create-new-task',
      cat: 'Create',
      label: 'New task…',
      sub: 'Full-field create form',
      run: () => { setNewTaskOpen(true) },
    })
    cmds.push({
      id: 'create-brain-dump',
      cat: 'Create',
      label: 'Open Brain Dump',
      run: () => { handleViewChange('braindump') },
    })

    // 3. Navigate group
    for (const navItem of NAV) {
      cmds.push({
        id: `nav-${navItem.id}`,
        cat: 'Navigate',
        label: `Go to ${navItem.label}`,
        kbd: String(navItem.kbd),
        run: () => { handleViewChange(navItem.id) },
      })
    }
    cmds.push({
      id: 'nav-focus-mode',
      cat: 'Navigate',
      label: focusMode ? 'Exit focus mode' : 'Enter focus mode',
      kbd: '.',
      run: () => { setFocusMode(!focusMode) },
    })

    // 4. Filter group (P2-01) — one "Filter by <PREFIX>" per known project + Clear all
    // Label is always "Filter by <PREFIX>" (toggles on/off); "Clear all filters" appears only
    // when a filter is active — per spec §4 palette requirements.
    for (const p of filterProjects) {
      cmds.push({
        id: `filter-project-${p.prefix}`,
        cat: 'Filter',
        label: `Filter by ${p.prefix}`,
        sub: p.area ?? undefined,
        run: () => { toggleProject(p.prefix) },
      })
    }
    if (filterActive(filter)) {
      cmds.push({
        id: 'filter-clear-all',
        cat: 'Filter',
        label: 'Clear all filters',
        run: () => { clearFilter() },
      })
    }

    // 5. Tasks group — fuzzy over all tasks
    for (const task of allTasks) {
      cmds.push({
        id: `task-${task.id}`,
        cat: 'Tasks',
        label: task.title,
        sub: task.id,
        run: () => {
          setSel(task.id)
          setPanel({ mode: 'detail', taskId: task.id })
        },
      })
    }

    // 6. Artifacts group — fuzzy over artifact filenames
    for (const artifact of artifacts) {
      const filename = artifact.path.split(/[/\\]/).pop() ?? artifact.path
      cmds.push({
        id: `artifact-${artifact.path}`,
        cat: 'Artifacts',
        label: filename,
        sub: artifact.project,
        run: () => { handleViewChange('artifacts') },
      })
    }

    // 7. Density group (P3-01)
    const densityOptions: { id: Density; label: string }[] = [
      { id: 'compact',  label: 'Density: Compact'  },
      { id: 'balanced', label: 'Density: Cozy'     },
      { id: 'airy',     label: 'Density: Spacious' },
    ]
    for (const opt of densityOptions) {
      cmds.push({
        id: `density-${opt.id}`,
        cat: 'Density',
        label: opt.label,
        sub: density === opt.id ? 'active' : undefined,
        run: () => { setDensityPersisted(opt.id) },
      })
    }

    return cmds
  }, [
    selectedTaskId, allTasks, todayHook, today,
    artifacts, focusMode, handleViewChange, setPanel, setSel, capture,
    filterProjects, filter, toggleProject, clearFilter,
    density, setDensityPersisted,
  ])

  // P2-03 — capture bar → Brain Dump handoff.
  // Empty / whitespace-only text is a no-op (spec Failure Modes).
  // A monotonic counter (not Date.now(), which collides within the same millisecond) guarantees
  // every handoff has a unique nonce so identical text dispatched twice always re-fires the
  // consumer effect (AC 5).
  const handleCaptureExpand = useCallback((text: string): void => {
    const trimmed = text.trim()
    if (trimmed === '') return
    seedNonceRef.current += 1
    setBrainDumpSeed({ text, nonce: seedNonceRef.current })
    handleViewChange('braindump')
  }, [handleViewChange])

  // MCPAT-069: a single render-time clock threaded into the task-surface views so every date-preset
  // and attention-staleness check in one render evaluates against the same instant (no per-row skew).
  const now = Date.now()

  return (
    <div className="app-shell" data-focus={focusMode ? 'true' : undefined} data-density={density}>
      {/* Global capture bar — always visible, spans all columns (P1-06) */}
      <CaptureOverlay
        onExpand={handleCaptureExpand}
        registerFocus={capture.registerFocus}
        activeProject={filter.projects.length === 1 ? filter.projects[0] : undefined}
      />

      {/* left nav */}
      <Nav
        view={view}
        onViewChange={handleViewChange}
        onPaletteOpen={() => setCmdkOpen(true)}
        onNewTask={() => capture.focusCapture('task')}
        onOpenProjects={() => setProjectsModalOpen(true)}
        favorites={favorites}
        projectCounts={projectCounts}
        filterProjects={filterProjects}
        onToggleProject={toggleProject}
        activeProjects={filter.projects}
        areaMap={areaMap}
        density={density}
        onDensityChange={setDensityPersisted}
        navCounts={navCounts}
      />

      {/* main scroll region */}
      <main className="main">
        {/* Global filter bar — shown above all five filterable views (P2-01).
            MCPAT-070 Phase C: Today gets its own .today-toolbar (FilterBar flex:1 + Today SortControl).
            All other filterable views keep the shared .filter-bar-row with Board SortControl. */}
        {FILTERABLE_VIEWS.has(view) && view === 'today' && (
          <div className="today-toolbar">
            <FilterBar
              filter={filter}
              projects={filterProjects}
              milestones={milestones}
              favorites={favorites}
              projectCounts={projectCounts}
              onToggleProject={toggleProject}
              onToggleArea={toggleArea}
              onToggleFav={toggleFav}
              onToggleType={toggleType}
              onToggleStatus={toggleStatus}
              onTogglePriority={togglePriority}
              onToggleMilestone={toggleMilestone}
              onToggleAttention={toggleAttention}
              onSetScheduled={setScheduled}
              onSetCreatedWithin={setCreatedWithin}
              onSetUpdatedWithin={setUpdatedWithin}
              onClear={clearFilter}
            />
            <SortControl
              sort={{ key: todaySort as unknown as SortKey, dir: 'asc' }}
              onChange={(k) => setTodaySort(k as unknown as TodaySortKey)}
              keys={TODAY_SORT_KEYS}
              todayMode={true}
            />
          </div>
        )}
        {FILTERABLE_VIEWS.has(view) && view !== 'today' && (
          <div className="filter-bar-row">
            <FilterBar
              filter={filter}
              projects={filterProjects}
              milestones={milestones}
              favorites={favorites}
              projectCounts={projectCounts}
              onToggleProject={toggleProject}
              onToggleArea={toggleArea}
              onToggleFav={toggleFav}
              onToggleType={toggleType}
              onToggleStatus={toggleStatus}
              onTogglePriority={togglePriority}
              onToggleMilestone={toggleMilestone}
              onToggleAttention={toggleAttention}
              onSetScheduled={setScheduled}
              onSetCreatedWithin={setCreatedWithin}
              onSetUpdatedWithin={setUpdatedWithin}
              onClear={clearFilter}
            />
            {SORTABLE_VIEWS.has(view) && <SortControl sort={sort} onChange={handleSortChange} />}
          </div>
        )}
        <div className="main-inner" data-width={(FULL_WIDTH_VIEWS.has(view) || (focusMode && view === 'today')) ? 'full' : undefined}>
          {view === 'today'     && (
            <TodayView
              filter={filter}
              areaMap={areaMap}
              todaySort={todaySort}
              now={now}
              selectedTaskId={selectedTaskId}
              onSelectTask={setSel}
              onOpenDetail={(task) => setPanel({ mode: 'detail', taskId: task.id })}
              onVisibleIdsChange={setVisibleIds}
              focusMode={focusMode}
              onToggleFocus={() => setFocusMode(f => !f)}
            />
          )}
          {view === 'board'     && <BoardView filter={filter} areaMap={areaMap} sort={sort} now={now} onOpenPanel={setPanel} />}
          {view === 'hermes'    && <HermesView onOpenPanel={(task) => setPanel({ mode: 'detail', taskId: task.id })} />}
          {view === 'braindump' && (
            <BrainDumpView
              projects={[]}
              initialText={brainDumpSeed?.text}
              seedNonce={brainDumpSeed?.nonce}
              onSeedConsumed={() => { setBrainDumpSeed(null) }}
            />
          )}
          {view === 'artifacts' && <ArtifactsView filter={filter} areaMap={areaMap} onOpenPanel={setPanel} />}
          {view === 'roadmap'   && <RoadmapView filter={filter} areaMap={areaMap} />}
          {view === 'activity'  && <ActivityView filter={filter} areaMap={areaMap} onOpenPanel={setPanel} />}
          {view === 'completed' && <CompletedView onOpenPanel={setPanel} />}
          {view === 'notes'     && <NotesView filter={filter} areaMap={areaMap} focusCapture={capture.focusCapture} />}
          {view === 'advisor'   && <AdvisorView onOpenPanel={setPanel} />}
        </div>
      </main>

      {/* ambient right rail — P1-05 persistent ACR / Knowledge / Activity */}
      <aside className="ambient bg-surface-1 border-l border-surface-3 overflow-hidden">
        <LiveFeedSection onOpenPanel={setPanel} />
      </aside>

      {/* panel — P1-04 peek / detail slide-in (absolute inside .main) */}
      {panel && (
        <TaskPanel
          panel={panel}
          task={panelTask ?? undefined}
          onClose={() => setPanel(null)}
          onPromote={() => setPanel(p => p ? { ...p, mode: 'detail' } : p)}
        />
      )}

      {/* P1-10 — command palette (Cmd+K) */}
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        commands={commands}
      />

      {/* P5-04 — New-task modal (full-field create) */}
      <NewTaskModal
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        projects={projectEntries}
      />

      {/* MCPAT-063 — Projects modal (settings cog) */}
      <ProjectsModal
        open={projectsModalOpen}
        onClose={() => setProjectsModalOpen(false)}
        projects={projectEntries}
      />
    </div>
  )
}
