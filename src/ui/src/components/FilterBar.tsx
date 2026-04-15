import React from 'react'
import type { Milestone, FilterState } from '../types'

interface Props {
  projects: string[]
  milestones: Milestone[]
  labels: string[]
  value: FilterState
  onChange: (next: FilterState) => void
}

export function FilterBar({ projects, milestones, labels, value, onChange }: Props): React.JSX.Element {
  function set(key: keyof FilterState, v: string): void {
    onChange({ ...value, [key]: v })
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-6 py-3 bg-slate-900 border-b border-slate-800">
      <select
        value={value.project}
        onChange={e => set('project', e.target.value)}
        className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded px-2 py-1"
      >
        <option value="">All projects</option>
        {projects.map(p => <option key={p} value={p}>{p}</option>)}
      </select>

      <select
        value={value.milestone}
        onChange={e => set('milestone', e.target.value)}
        className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded px-2 py-1"
      >
        <option value="">All milestones</option>
        {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
      </select>

      <select
        value={value.label}
        onChange={e => set('label', e.target.value)}
        className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded px-2 py-1"
      >
        <option value="">All labels</option>
        {labels.map(l => <option key={l} value={l}>{l}</option>)}
      </select>

      {(value.project || value.milestone || value.label) && (
        <button
          onClick={() => onChange({ project: '', status: '', milestone: '', label: '' })}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
