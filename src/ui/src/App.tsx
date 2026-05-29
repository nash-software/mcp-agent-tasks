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
import { LiveFeedSection } from './components/LiveFeedSection'
import { CommandPalette, type PaletteCommand } from './components/CommandPalette'
import { useTasks } from './hooks/useTasks'
import { useToday } from './hooks/useToday'
import { useArtifacts } from './hooks/useArtifacts'
import { useCaptureOverlay } from './hooks/useCaptureOverlay'
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard'
import { NAV } from './lib/nav'
import type { ViewId, PanelState, FilterState, Task, TaskPriority } from './types'
import { localToday } from './lib/format'

const EMPTY_FILTERS: FilterState = { project: '', status: '', milestone: '', label: '' }

const VALID_VIEWS: ViewId[] = ['today', 'board', 'hermes', 'braindump', 'artifacts', 'roadmap', 'activity']

function readStoredView(): ViewId {
  const raw = localStorage.getItem('lifeos-view')
  return (raw && VALID_VIEWS.includes(raw as ViewId)) ? (raw as ViewId) : 'today'
}

function HermesPlaceholder(): React.JSX.Element {
  return <div className="p-8 text-ink-muted text-sm">Hermes — coming in Phase 2</div>
}

export function App(): React.JSX.Element {
  const [view, setView]             = useState<ViewId>(readStoredView)
  const [selectedTaskId, setSel]    = useState<string | null>(null)
  const [panel, setPanel]           = useState<PanelState | null>(null)
  const [cmdkOpen, setCmdkOpen]     = useState(false)
  const [focusMode, setFocusMode]   = useState(false)
  const [visibleIds, setVisibleIds] = useState<string[]>([])

  useEffect(() => { localStorage.setItem('lifeos-view', view) }, [view])

  const capture = useCaptureOverlay()
  const { tasks: allTasks } = useTasks()
  const { artifacts } = useArtifacts()

  const [targetMinutes] = useState<number>(() => {
    const raw = localStorage.getItem('lifeos-target')
    if (!raw) return 6 * 60
    const v = parseInt(raw, 10)
    return !isNaN(v) && v > 0 ? v : 6 * 60
  })
  const today = useRef(localToday())
  const todayHook = useToday(targetMinutes)

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
    focusCapture: capture.focus,
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
      cmds.push({
        id: 'sel-sign-off',
        cat: 'Selected task',
        label: 'Sign off to Hermes',
        sub: selectedTask.id,
        disabled: true,
        disabledHint: 'Coming in Phase 2',
        run: () => { /* Phase 2 stub */ },
      })
      cmds.push({
        id: 'sel-dispatch-acr',
        cat: 'Selected task',
        label: 'Dispatch to ACR',
        sub: selectedTask.id,
        disabled: true,
        disabledHint: 'Coming in Phase 2',
        run: () => { /* Phase 2 stub */ },
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
      run: () => { capture.focus() },
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

    // 4. Filter group (Phase 1 stub)
    cmds.push({
      id: 'filter-stub',
      cat: 'Filter',
      label: 'Filter by… (coming soon)',
      disabled: true,
      disabledHint: 'Filter actions land in Phase 2 (P2-01)',
      run: () => { /* Phase 2 stub */ },
    })

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

    return cmds
  }, [
    selectedTaskId, allTasks, todayHook, today,
    artifacts, focusMode, handleViewChange, setPanel, setSel, capture,
  ])

  // P2-03 affordance: Shift+Enter / expand in capture bar switches to braindump view
  const handleCaptureExpand = useCallback((_text: string): void => {
    // _text will be used by P2-03 to prefill the BrainDump editor
    handleViewChange('braindump')
  }, [handleViewChange])

  return (
    <div className="app-shell" data-focus={focusMode ? 'true' : undefined}>
      {/* Global capture bar — always visible, spans all columns (P1-06) */}
      <CaptureOverlay
        onExpand={handleCaptureExpand}
        registerFocus={capture.registerFocus}
      />

      {/* left nav */}
      <Nav view={view} onViewChange={handleViewChange} onPaletteOpen={() => setCmdkOpen(true)} />

      {/* main scroll region */}
      <main className="main">
        <div className="main-inner">
          {view === 'today'     && (
            <TodayView
              selectedTaskId={selectedTaskId}
              onSelectTask={setSel}
              onOpenDetail={(task) => setPanel({ mode: 'detail', taskId: task.id })}
              onVisibleIdsChange={setVisibleIds}
            />
          )}
          {view === 'board'     && <BoardView filters={EMPTY_FILTERS} onOpenPanel={setPanel} />}
          {view === 'hermes'    && <HermesPlaceholder />}
          {view === 'braindump' && <BrainDumpView projects={[]} />}
          {view === 'artifacts' && <ArtifactsView onOpenPanel={setPanel} />}
          {view === 'roadmap'   && <RoadmapView filters={EMPTY_FILTERS} />}
          {view === 'activity'  && <ActivityView onOpenPanel={setPanel} />}
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
    </div>
  )
}
