import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from './components/Nav'
import { TodayView } from './views/TodayView'
import { BoardView } from './views/BoardView'
import { RoadmapView } from './views/RoadmapView'
import { ActivityView } from './views/ActivityView'
import { BrainDumpView } from './views/BrainDumpView'
import { ArtifactsView } from './views/ArtifactsView'
import { TaskPanel } from './components/TaskPanel'
import { CaptureOverlay, CaptureToast } from './components/CaptureOverlay'
import { LiveFeedSection } from './components/LiveFeedSection'
import { useTasks } from './hooks/useTasks'
import { useCaptureOverlay } from './hooks/useCaptureOverlay'
import { useGlobalKeyboard } from './hooks/useGlobalKeyboard'
import type { ViewId, PanelState, FilterState } from './types'

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
  const [showToast, setShowToast]   = useState(false)

  useEffect(() => { localStorage.setItem('lifeos-view', view) }, [view])

  const capture = useCaptureOverlay()
  const { tasks: allTasks } = useTasks()

  const panelTask = panel ? (allTasks.find(t => t.id === panel.taskId) ?? null) : null

  const handleViewChange = useCallback((v: ViewId): void => {
    setView(v)
    setPanel(null)
  }, [])

  function handleCaptured(): void {
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2200)
  }

  const handlers = useMemo(() => ({
    setView: handleViewChange,
    setPanel,
    setSel,
    setCmdkOpen,
    setFocusMode,
    moveSelection: (_dir: 'up' | 'down') => {
      /* P1-03 stub — TodayView will provide visibleIds */
    },
    markDone:        () => console.warn('[P1-02 stub] markDone not wired'),
    cyclePriority:   () => console.warn('[P1-02 stub] cyclePriority not wired'),
    toggleCommitted: () => console.warn('[P1-02 stub] toggleCommitted not wired'),
  }), [handleViewChange, setPanel, setSel, setCmdkOpen, setFocusMode])

  useGlobalKeyboard({
    view,
    selectedTaskId,
    panel,
    focusMode,
    cmdkOpen,
    visibleIds: [],   // P1-03 will lift the real ordered id list
    focusCapture: capture.open,
    handlers,
  })

  return (
    <div className="app-shell" data-focus={focusMode ? 'true' : undefined}>
      {/* capture row — P1-06 will replace stub with real capture bar */}
      <div className="capture bg-surface-1 border-b border-surface-3 flex items-center px-4 gap-3">
        <button
          onClick={capture.open}
          className="text-ink-muted text-sm hover:text-ink transition-colors"
        >
          Quick capture
          <kbd className="ml-2 text-xs text-ink-faint">Ctrl+Space</kbd>
        </button>
      </div>

      {/* left nav */}
      <Nav view={view} onViewChange={handleViewChange} onPaletteOpen={() => setCmdkOpen(true)} />

      {/* main scroll region */}
      <main className="main">
        <div className="main-inner">
          {view === 'today'     && <TodayView />}
          {view === 'board'     && <BoardView filters={EMPTY_FILTERS} onTaskClick={(t) => setSel(t.id)} />}
          {view === 'hermes'    && <HermesPlaceholder />}
          {view === 'braindump' && <BrainDumpView projects={[]} />}
          {view === 'artifacts' && <ArtifactsView />}
          {view === 'roadmap'   && <RoadmapView filters={EMPTY_FILTERS} />}
          {view === 'activity'  && <ActivityView />}
        </div>
      </main>

      {/* ambient right rail — P1-05 will replace with real LiveFeed rail */}
      <aside className="ambient bg-surface-1 border-l border-surface-3 overflow-y-auto">
        <LiveFeedSection />
      </aside>

      {/* capture overlay (modal) */}
      {capture.isOpen && (
        <CaptureOverlay onClose={capture.close} onCaptured={handleCaptured} />
      )}

      {/* panel — P1-04 peek / detail slide-in (absolute inside .main) */}
      {panel && (
        <TaskPanel
          panel={panel}
          task={panelTask ?? undefined}
          onClose={() => setPanel(null)}
          onPromote={() => setPanel(p => p ? { ...p, mode: 'detail' } : p)}
        />
      )}

      {showToast && <CaptureToast />}
    </div>
  )
}
