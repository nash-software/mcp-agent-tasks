import React from 'react'
import { Search, Plus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { NAV_GROUPS, NAV_BY_ID } from '../lib/nav'
import { MOD } from '../lib/platform'
import { useAcrStatus } from '../hooks/useAcrStatus'
import { AreaDot } from './atoms'
import { UpdateButton } from './UpdateButton'
import type { ViewId, TaskArea, Density } from '../types'
import type { FilterBarProject } from './FilterBar'

interface NavProps {
  view: ViewId
  onViewChange: (v: ViewId) => void
  onPaletteOpen: () => void
  /** Open the full-field New-task modal (P5-04). */
  onNewTask: () => void
  /** Open the projects management modal (MCPAT-063). */
  onOpenProjects: () => void
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
  /** Per-view counts — when defined, shown as a badge; otherwise the kbd hint is shown. */
  navCounts?: Partial<Record<ViewId, number>>
  /** When true (server running under the tray), show the dev Update control in the footer. */
  devTray?: boolean
}

const DENSITY_OPTIONS: { label: string; value: Density }[] = [
  { label: 'Compact',  value: 'compact'  },
  { label: 'Cozy',     value: 'balanced' },
  { label: 'Spacious', value: 'airy'     },
]

export function Nav({
  view,
  onViewChange,
  onPaletteOpen,
  onNewTask,
  onOpenProjects,
  favorites,
  projectCounts,
  filterProjects,
  onToggleProject,
  activeProjects,
  areaMap,
  density,
  onDensityChange,
  navCounts = {},
  devTray = false,
}: NavProps): React.JSX.Element {
  const acrQ = useAcrStatus()

  const brainQ = useQuery({
    queryKey: ['brain-status'],
    queryFn: async () => {
      try {
        const r = await fetch('/api/brain/status')
        return r.ok ? (r.json() as Promise<{ online: boolean }>) : { online: false }
      } catch {
        return { online: false }
      }
    },
    staleTime: 30_000,
  })

  const acrOffline = acrQ.data?.offline ?? true
  const brainOffline = !(brainQ.data?.online ?? false)

  const projectByPrefix = React.useMemo(() => {
    const m: Record<string, FilterBarProject> = {}
    for (const p of filterProjects) m[p.prefix] = p
    return m
  }, [filterProjects])

  return (
    <nav className="nav flex flex-col h-full bg-bg border-r border-surface-3 py-3">
      {/* 3 labelled groups (Workspace / Assistants / Library) from NAV_GROUPS */}
      {NAV_GROUPS.map((grp, grpIdx) => (
        <div key={grp.label} className={`nav-group ${grpIdx > 0 ? 'mt-2' : 'mt-1'}`}>
          <div className="nav-group-label px-3 py-1 text-ink-faint text-xs uppercase tracking-wide overflow-hidden whitespace-nowrap">
            {grp.label}
          </div>
          <div className="flex flex-col gap-0.5 px-2 mt-0.5">
            {grp.ids.map(id => {
              const item = NAV_BY_ID[id]
              const count = navCounts[id]
              return (
                <button
                  key={id}
                  onClick={() => onViewChange(id)}
                  title={item.label}
                  className={`flex items-center gap-3 w-full px-3 py-2 rounded text-sm transition-colors ${
                    view === id
                      ? 'bg-surface-2 text-ink'
                      : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                  }`}
                >
                  <item.icon size={16} />
                  <span className="overflow-hidden whitespace-nowrap">{item.label}</span>
                  {count != null ? (
                    <span className="ml-auto text-xs text-ink-faint font-mono tabular-nums overflow-hidden whitespace-nowrap count">
                      {count}
                    </span>
                  ) : (
                    <span className="ml-auto text-xs text-ink-faint overflow-hidden whitespace-nowrap nav-kbd">
                      {item.kbd >= 0 && <kbd>{item.kbd}</kbd>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {/* Favourites — only rendered when at least one project is pinned */}
      {favorites.length > 0 && (
        <div className="nav-pinned mt-4">
          <div className="nav-group-label px-3 py-1 text-ink-faint text-xs uppercase tracking-wide overflow-hidden whitespace-nowrap">
            Favourites
          </div>
          <div className="flex flex-col gap-0.5 px-2 mt-0.5">
            {favorites.map(prefix => {
              const proj = projectByPrefix[prefix]
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
                  <span className="font-mono text-xs overflow-hidden whitespace-nowrap">
                    {proj.name && proj.name !== prefix ? `${prefix} — ${proj.name}` : prefix}
                  </span>
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
      <div className="nav-foot mt-auto px-3 py-2 border-t border-surface-3 flex flex-col gap-2">
        {/* New task — primary action */}
        <button
          onClick={onNewTask}
          className="nav-foot-btn primary flex items-center gap-2 w-full bg-accent text-accent-text text-xs px-3 py-1.5 rounded hover:bg-accent/90 transition-colors font-medium"
          aria-label="New task"
        >
          <Plus size={14} aria-hidden />
          New task
        </button>

        {/* Search / command palette */}
        <button
          onClick={onPaletteOpen}
          className="nav-foot-btn flex items-center gap-2 w-full bg-surface-2 text-ink-muted text-xs px-3 py-1.5 rounded hover:text-ink transition-colors"
          aria-label="Search"
        >
          <Search size={13} aria-hidden />
          Search
          <kbd className="ml-auto">{MOD}+K</kbd>
        </button>

        {/* Density segmented control */}
        <div
          className="nav-density flex items-center rounded overflow-hidden"
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
              className={`nd-btn flex-1 py-1 transition-colors text-[11px] leading-none ${
                density === opt.value
                  ? 'bg-surface-2 text-ink on'
                  : 'bg-transparent text-ink-faint hover:text-ink-muted'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Status dots — ACR + Brain */}
        <div className="nav-status flex items-center gap-4 px-1">
          <span
            className="ns-item flex items-center gap-1.5 text-xs text-ink-faint"
            title={acrOffline ? 'ACR offline' : 'ACR online'}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                acrOffline ? 'bg-ink-faint' : 'bg-status-green'
              }`}
            />
            ACR
          </span>
          <span
            className="ns-item flex items-center gap-1.5 text-xs text-ink-faint"
            title={brainOffline ? 'Brain offline' : 'Brain online'}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                brainOffline ? 'bg-ink-faint' : 'bg-status-green'
              }`}
            />
            Brain
          </span>
        </div>

        {/* Dev-only rebuild trigger (server running under the tray). Hidden in prod. */}
        <UpdateButton devTray={devTray} />

        {/* Settings cog — manage projects */}
        <button
          onClick={onOpenProjects}
          className="bg-surface-2 text-ink-muted text-xs px-3 py-1.5 rounded hover:text-ink transition-colors overflow-hidden whitespace-nowrap"
          aria-label="Manage projects"
          title="Manage projects"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Projects
        </button>
      </div>
    </nav>
  )
}
