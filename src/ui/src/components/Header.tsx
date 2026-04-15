import React from 'react'

export type TabId = 'board' | 'roadmap' | 'activity'

const TABS: { id: TabId; label: string }[] = [
  { id: 'board',    label: 'Board' },
  { id: 'roadmap',  label: 'Roadmap' },
  { id: 'activity', label: 'Activity' },
]

interface Props {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

export function Header({ activeTab, onTabChange }: Props): React.JSX.Element {
  return (
    <header className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex items-center gap-6">
      <h1 className="text-slate-100 font-semibold text-lg">agent-tasks</h1>
      <nav className="flex gap-1">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-indigo-900 text-violet-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </header>
  )
}
