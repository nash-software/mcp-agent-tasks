import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { NAV } from '../lib/nav'
import { MOD } from '../lib/platform'
import { useAcrStatus } from '../hooks/useAcrStatus'
import { AreaDot } from './atoms'
import type { ViewId, TaskArea } from '../types'
import type { FilterBarProject } from './FilterBar'
import type { Density } from '../types'

interface NavProps {
  view: ViewId
  onViewChange: (v: ViewId) => void
  onPaletteOpen: () => void
  /** Pinned project prefixes (P2-02). */
  favorites: string[]
  /** Open-task count per prefix (P2-02, derived once in App). */
  projectCounts: Record<string, number>
  /** All known projects (same list as FilterBar). */
  filterProjects: FilterBarProject[]
  /** Toggle a project in the global filter (P2-01). */
  onToggleProject: (prefix: string) => void
  /** Prefixes currently active in the global filter — pinned rows show active treatment. */
  activeProjects: string[]
  /** Area map for resolving project area — prefix → area (P2-01, built in App). */
  areaMap: Record<string, TaskArea>
  /** Current density setting (P3-01). */
  density: Density
  /** Callback to change density (P3-01). */
  onDensityChange: (d: Density) => void
}

const DENSITY_OPTIONS: { label: string; value: Density }[] = [
  { label: 'Compact', value: 'compact' },
  { label: 'Cozy',    value: 'cozy'    },
  { label: 'Spacious',  value: 'spacious'  },
]

export function Nav({
  view,
  onViewChange,
  onPaletteOpen,
  favorites,
  projectCounts,
  filterProjects,
  onToggleProject,
  activeProjects,
  areaMap,
  density,
  onDensityChange,
}: NavProps): React.JSX.Element {
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

  // Build a lookup from filterProjects for resolving area per pinned prefix.
  const projectByPrefix = React.useMemo(() => {
    const m: Record<string, FilterBarProject> = {}
    for (const p of filterProjects) m[p.prefix] = p
    return m
  }, [filterProjects])

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

      {/* Favourites group — only rendered when at least one project is pinned */}
      {favorites.length > 0 && (
        <div className="mt-4">
          <div className="px-3 py-1 text-ink-faint text-xs uppercase tracking-wide overflow-hidden whitespace-nowrap">
            Favourites
          </div>
          <div className="flex flex-col gap-0.5 px-2 mt-0.5">
            {favorites.map(prefix => {
              const proj = projectByPrefix[prefix]
              // Skip-render stale pins whose project can't be resolved
              if (!proj) return null
              const area = proj.area ?? areaMap[prefix] ?? null
              const count = projectCounts[prefix]
              const active = activeProjects.includes(prefix)
              return (
                <button
                  key={prefix}
                  onClick={() => onToggleProject(prefix)}
                  title={`${proj.name} — click to filter everywhere`}
                  aria-pressed={active}
                  className={`flex items-center gap-2 w-full px-3 py-2 rounded text-sm transition-colors ${
                    active
                      ? 'bg-surface-2 text-ink ring-1 ring-inset ring-accent/40'
                      : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                  }`}
                >
                  {area && <AreaDot area={area} />}
                  <span className="font-mono text-xs overflow-hidden whitespace-nowrap">{prefix}</span>
                  {count != null && count > 0 && (
                    <span className="ml-auto text-xs text-ink-faint font-mono tabular-nums overflow-hidden whitespace-nowrap">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

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

        {/* Density segmented control (P3-01) */}
        <div
          className="flex items-center rounded overflow-hidden"
          style={{ border: '1px solid var(--color-surface-3, #27272a)' }}
          role="group"
          aria-label="Density"
        >
          {DENSITY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onDensityChange(opt.value)}
              title={opt.label}
              aria-pressed={density === opt.value}
              className={`flex-1 py-1 transition-colors text-[11px] leading-none ${
                density === opt.value
                  ? 'bg-surface-2 text-ink'
                  : 'bg-transparent text-ink-faint hover:text-ink-muted'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Search / palette button */}
        <button
          onClick={onPaletteOpen}
          className="bg-surface-2 text-ink-muted text-xs px-3 py-1.5 rounded hover:text-ink transition-colors overflow-hidden whitespace-nowrap"
        >
          Search {MOD}K
        </button>
      </div>
    </nav>
  )
}
