/**
 * FilterBar — Life OS global filter bar (P2-01).
 *
 * Ported from `design_handoff_life_os/reference/filters.jsx:29-116`, realised in the §3 token
 * system (classes defined in index.css, mirroring how P1-10 re-realised the `cmdk-*` classes).
 *
 * Renders: favourite quick-chips · a Filter button → popover (projects checkbox+star, area chips) ·
 * removable active-filter chips · Clear (only when filterActive). Popover closes on outside-click.
 *
 * `favorites` + `onToggleFav` are P2-02 data — consumed here (star toggle + quick-chips) but the
 * persistence/sidebar-pinning is owned by P2-02. When P2-02 is not merged, `favorites` is empty and
 * `onToggleFav` is a no-op.
 */
import React, { useState, useEffect, useRef } from 'react'
import { Filter as FilterIcon, Star, Check, X } from 'lucide-react'
import type { TaskArea } from '../types'
import { type Filter, filterActive } from '../lib/filter'
import { AreaDot } from './atoms'

// ── Area metadata (label + hex), canonical order ───────────────────────────

const AREA_HEX: Record<TaskArea, string> = {
  client:    '#F59E0B',
  personal:  '#22C55E',
  outsource: '#8B5CF6',
  internal:  '#6B7280',
}

const AREA_LABEL: Record<TaskArea, string> = {
  client:    'Client',
  personal:  'Personal',
  outsource: 'Outsource',
  internal:  'Internal',
}

const ALL_AREAS: TaskArea[] = ['client', 'personal', 'outsource', 'internal']

// ── Project row shape (prefix + display name + area) ───────────────────────

export interface FilterBarProject {
  prefix: string
  name: string
  area: TaskArea | null
}

interface Props {
  filter: Filter
  /** All known projects for the popover list (task-derived ∪ /api/projects). */
  projects: FilterBarProject[]
  /** Favourited prefixes (P2-02). */
  favorites: string[]
  /** Open-task count per prefix, drives the chip badge. */
  projectCounts: Record<string, number>
  onToggleProject: (prefix: string) => void
  onToggleArea: (area: TaskArea) => void
  /** P2-02 — no-op until favourites ship. */
  onToggleFav: (prefix: string) => void
  onClear: () => void
}

// ── Internal checkbox atom ─────────────────────────────────────────────────

function Checkbox({ on }: { on: boolean }): React.JSX.Element {
  return (
    <span className={`fb-check ${on ? 'on' : ''}`}>
      {on && <Check size={11} />}
    </span>
  )
}

// ── Component ──────────────────────────────────────────────────────────────

export function FilterBar({
  filter,
  projects,
  favorites,
  projectCounts,
  onToggleProject,
  onToggleArea,
  onToggleFav,
  onClear,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const favProjects = projects.filter(p => favorites.includes(p.prefix))
  const active = filterActive(filter)
  const activeCount = filter.projects.length + filter.areas.length

  return (
    <div className="filter-bar">
      {/* favourite quick-chips */}
      {favProjects.map(p => (
        <button
          key={p.prefix}
          className={`fav-chip ${filter.projects.includes(p.prefix) ? 'active' : ''}`}
          onClick={() => onToggleProject(p.prefix)}
          title={p.name !== p.prefix ? `${p.prefix} — ${p.name}` : p.prefix}
          type="button"
        >
          <Star size={11} className="fav-chip-star" />
          <span className="fc-prefix">
            {p.name && p.name !== p.prefix ? `${p.prefix} — ${p.name}` : p.prefix}
          </span>
          {projectCounts[p.prefix] ? <span className="fc-count">{projectCounts[p.prefix]}</span> : null}
        </button>
      ))}
      {favProjects.length > 0 && <span className="fb-divider" />}

      {/* Filter button + popover */}
      <div className="filter-anchor" ref={anchorRef}>
        <button
          className={`filter-btn ${open || active ? 'on' : ''}`}
          onClick={() => setOpen(o => !o)}
          type="button"
        >
          <FilterIcon size={13} />
          Filter
          {active && <span className="filter-btn-n">{activeCount}</span>}
        </button>

        {open && (
          <div className="filter-pop">
            <div className="filter-pop-sec">
              <div className="fp-sec-label">Projects</div>
              {projects.length === 0 ? (
                <div className="fp-empty">No projects yet</div>
              ) : (
                projects.map(p => (
                  <div key={p.prefix} className="filter-pop-row">
                    <button
                      className="fpr-main"
                      onClick={() => onToggleProject(p.prefix)}
                      type="button"
                    >
                      <Checkbox on={filter.projects.includes(p.prefix)} />
                      <span className="fpr-prefix">{p.prefix}</span>
                      <span className="fpr-name">{p.name && p.name !== p.prefix ? p.name : ''}</span>
                      {p.area && <AreaDot area={p.area} />}
                    </button>
                    <button
                      className={`fav-star ${favorites.includes(p.prefix) ? 'on' : ''}`}
                      title={favorites.includes(p.prefix) ? 'Unfavourite' : 'Favourite — pins to sidebar'}
                      onClick={(e) => { e.stopPropagation(); onToggleFav(p.prefix) }}
                      type="button"
                    >
                      <Star size={14} fill={favorites.includes(p.prefix) ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="filter-pop-sec fp-sec-areas">
              <div className="fp-sec-label">Areas</div>
              <div className="fp-areas">
                {ALL_AREAS.map(a => {
                  const sel = filter.areas.includes(a)
                  return (
                    <button
                      key={a}
                      className={`fp-area-chip ${sel ? 'sel' : ''}`}
                      style={sel ? { color: AREA_HEX[a], borderColor: 'currentColor' } : undefined}
                      onClick={() => onToggleArea(a)}
                      type="button"
                    >
                      <span className="d" style={{ background: AREA_HEX[a] }} />
                      {AREA_LABEL[a]}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* active filter chips */}
      {filter.projects.map(p => (
        <button
          key={`fp-${p}`}
          className="filter-chip"
          onClick={() => onToggleProject(p)}
          type="button"
        >
          <span className="fpr-prefix">{p}</span>
          <X size={12} />
        </button>
      ))}
      {filter.areas.map(a => (
        <button
          key={`fa-${a}`}
          className="filter-chip"
          onClick={() => onToggleArea(a)}
          type="button"
        >
          <span className="d" style={{ background: AREA_HEX[a] }} />
          {AREA_LABEL[a]}
          <X size={12} />
        </button>
      ))}

      {active && (
        <button className="filter-clear" onClick={onClear} type="button">
          Clear
        </button>
      )}
    </div>
  )
}
