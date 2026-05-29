import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { NAV } from '../lib/nav'
import { useAcrStatus } from '../hooks/useAcrStatus'
import type { ViewId } from '../types'

interface NavProps {
  view: ViewId
  onViewChange: (v: ViewId) => void
  onPaletteOpen: () => void
}

export function Nav({ view, onViewChange, onPaletteOpen }: NavProps): React.JSX.Element {
  const acrQ = useAcrStatus()

  const brainQ = useQuery({
    queryKey: ['brain-ping'],
    queryFn: async () => {
      try {
        const r = await fetch('/api/brain/search?q=status')
        return r.ok ? (r.json() as Promise<{ offline?: boolean }>) : { offline: true }
      } catch {
        return { offline: true }
      }
    },
    staleTime: 30_000,
  })

  const acrOffline = acrQ.data?.offline ?? true
  const brainOffline = brainQ.data?.offline ?? true

  return (
    <nav className="nav flex flex-col h-full bg-bg border-r border-surface-3 py-3">
      {/* Nav items */}
      <div className="flex flex-col gap-0.5 px-2">
        {NAV.map(item => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            title={item.label}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded text-sm transition-colors ${
              view === item.id
                ? 'bg-surface-2 text-ink'
                : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
            }`}
          >
            <item.icon size={16} />
            <span className="overflow-hidden whitespace-nowrap">{item.label}</span>
            <span className="ml-auto text-xs text-ink-faint overflow-hidden whitespace-nowrap">
              {item.kbd}
            </span>
          </button>
        ))}
      </div>

      {/* Favourites placeholder */}
      <div className="mt-4 px-3 py-1 text-ink-faint text-xs uppercase tracking-wide overflow-hidden whitespace-nowrap">
        Favourites
      </div>
      <div className="px-3 py-1 text-ink-faint text-xs italic overflow-hidden whitespace-nowrap">
        — none yet —
      </div>

      {/* Footer */}
      <div className="mt-auto px-3 py-2 border-t border-surface-3 flex flex-col gap-2">
        {/* ACR status dot */}
        <div className="flex items-center gap-2 overflow-hidden">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              acrOffline ? 'bg-ink-faint' : 'bg-status-green'
            }`}
          />
          <span className="text-ink-faint text-xs overflow-hidden whitespace-nowrap">ACR</span>
        </div>

        {/* Brain status dot */}
        <div className="flex items-center gap-2 overflow-hidden">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              brainOffline ? 'bg-ink-faint' : 'bg-status-green'
            }`}
          />
          <span className="text-ink-faint text-xs overflow-hidden whitespace-nowrap">Brain</span>
        </div>

        {/* Search / palette button */}
        <button
          onClick={onPaletteOpen}
          className="bg-surface-2 text-ink-muted text-xs px-3 py-1.5 rounded hover:text-ink transition-colors overflow-hidden whitespace-nowrap"
        >
          Search ⌘K
        </button>
      </div>
    </nav>
  )
}
