import React, { useState } from 'react'
import { Header, type TabId } from './components/Header'
import { FilterBar } from './components/FilterBar'
import { BoardView } from './views/BoardView'
import { RoadmapView } from './views/RoadmapView'
import { ActivityView } from './views/ActivityView'
import { InboxView } from './views/InboxView'
import { TodayView } from './views/TodayView'
import { BrainDumpView } from './views/BrainDumpView'
import { TaskDetailPanel } from './components/TaskDetailPanel'
import { CaptureOverlay, CaptureToast } from './components/CaptureOverlay'
import { useTasks } from './hooks/useTasks'
import { useMilestones } from './hooks/useMilestones'
import { useCaptureOverlay } from './hooks/useCaptureOverlay'
import type { FilterState, Task } from './types'

const EMPTY_FILTERS: FilterState = { project: '', status: '', milestone: '', label: '' }

export function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('today')
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [showToast, setShowToast] = useState(false)

  // Derive filter options from all tasks (no server-side filter for meta queries)
  const { tasks: allTasks } = useTasks()
  const { milestones } = useMilestones()
  const capture = useCaptureOverlay()

  const projects = [...new Set(allTasks.map(t => t.project).filter((p): p is string => Boolean(p)))].sort()
  const labels = [...new Set(allTasks.flatMap(t => t.labels ?? []))].sort()

  const showFilterBar = activeTab !== 'activity' && activeTab !== 'today' && activeTab !== 'braindump'

  function handleCaptured(): void {
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2200)
  }

  return (
    <div className="bg-slate-950 text-slate-200 min-h-screen flex flex-col">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      {showFilterBar && (
        <FilterBar
          projects={projects}
          milestones={milestones}
          labels={labels}
          value={filters}
          onChange={setFilters}
        />
      )}
      <main className="flex-1">
        {activeTab === 'today'    && <TodayView />}
        {activeTab === 'board'    && <BoardView filters={filters} onTaskClick={setSelectedTask} />}
        {activeTab === 'roadmap'  && <RoadmapView filters={filters} />}
        {activeTab === 'activity' && <ActivityView />}
        {activeTab === 'inbox'     && <InboxView projects={projects} />}
        {activeTab === 'braindump' && <BrainDumpView projects={projects} />}
      </main>
      <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} />
      {capture.isOpen && (
        <CaptureOverlay onClose={capture.close} onCaptured={handleCaptured} />
      )}
      {showToast && <CaptureToast />}
    </div>
  )
}
