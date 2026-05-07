import React from 'react'
import { useStats } from '../hooks/useStats'
import type { TaskStatus } from '../types'

export type TabId = 'board' | 'roadmap' | 'activity' | 'inbox'

const TABS: { id: TabId; label: string }[] = [
  { id: 'board',    label: 'Board' },
  { id: 'roadmap',  label: 'Roadmap' },
  { id: 'activity', label: 'Activity' },
  { id: 'inbox',    label: 'Inbox' },
]

const STATUS_LABELS: { key: TaskStatus; label: string; color: string }[] = [
  { key: 'todo',        label: 'Todo',        color: 'text-slate-400' },
  { key: 'in_progress', label: 'Active',      color: 'text-blue-400' },
  { key: 'blocked',     label: 'Blocked',     color: 'text-amber-400' },
  { key: 'done',        label: 'Done',        color: 'text-emerald-400' },
]

interface Props {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

export function Header({ activeTab, onTabChange }: Props): React.JSX.Element {
  const { stats, isLoading } = useStats()

  const totals: Record<string, number> = {}
  if (!isLoading) {
    for (const entry of stats) {
      for (const [status, count] of Object.entries(entry.stats.by_status ?? {})) {
        totals[status] = (totals[status] ?? 0) + count
      }
    }
  }

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
      {!isLoading && (
        <div className="ml-auto flex gap-4 text-xs">
          {STATUS_LABELS.map(s => (
            <span key={s.key} className={s.color}>
              {s.label} <strong>{totals[s.key] ?? 0}</strong>
            </span>
          ))}
        </div>
      )}
    </header>
  )
}
