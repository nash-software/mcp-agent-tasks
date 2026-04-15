import React, { useState } from 'react'
import { Header, type TabId } from './components/Header'
import { FilterBar } from './components/FilterBar'
import { BoardView } from './views/BoardView'
import { RoadmapView } from './views/RoadmapView'
import { ActivityView } from './views/ActivityView'
import { useTasks } from './hooks/useTasks'
import { useMilestones } from './hooks/useMilestones'
import type { FilterState } from './types'

const EMPTY_FILTERS: FilterState = { project: '', status: '', milestone: '', label: '' }

export function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('board')
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)

  // Derive filter options from all tasks (no server-side filter for meta queries)
  const { tasks: allTasks } = useTasks()
  const { milestones } = useMilestones()

  const projects = [...new Set(allTasks.map(t => t.project).filter((p): p is string => Boolean(p)))].sort()
  const labels = [...new Set(allTasks.flatMap(t => t.labels ?? []))].sort()

  return (
    <div className="bg-slate-950 text-slate-200 min-h-screen flex flex-col">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      {activeTab !== 'activity' && (
        <FilterBar
          projects={projects}
          milestones={milestones}
          labels={labels}
          value={filters}
          onChange={setFilters}
        />
      )}
      <main className="flex-1">
        {activeTab === 'board'    && <BoardView filters={filters} />}
        {activeTab === 'roadmap'  && <RoadmapView filters={filters} />}
        {activeTab === 'activity' && <ActivityView />}
      </main>
    </div>
  )
}
