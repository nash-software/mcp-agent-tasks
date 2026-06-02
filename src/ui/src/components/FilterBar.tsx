/**
 * FilterBar — Life OS global filter bar (P2-01, extended by MCPAT-069).
 *
 * Renders: favourite quick-chips · a Filter button → popover (projects checkbox+star, area chips) ·
 * "More filters" collapsible disclosure (Type/Status/Priority/Milestone/Attention + date presets) ·
 * removable active-filter chips · Clear (only when filterActive). Popover closes on outside-click.
 *
 * `favorites` + `onToggleFav` are P2-02 data — consumed here (star toggle + quick-chips) but the
 * persistence/sidebar-pinning is owned by P2-02. When P2-02 is not merged, `favorites` is empty and
 * `onToggleFav` is a no-op.
 *
 * MCPAT-069: Added Type/Status/Priority/Milestone/attention/scheduled/createdWithin/updatedWithin
 * filter dimensions, rendered in a collapsible "More filters" disclosure section to avoid wall effect.
 */
import React, { useState, useEffect, useRef } from 'react'
import { Filter as FilterIcon, Star, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import type { TaskArea, TaskType, TaskStatus, TaskPriority, Milestone } from '../types'
import { type Filter, filterActive, activeFilterCount } from '../lib/filter'
import { STATUS_DOT, PRIORITY_COLOR } from '../lib/tokens'
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

// ── Type metadata ──────────────────────────────────────────────────────────

const ALL_TYPES: TaskType[] = ['feature', 'bug', 'chore', 'spike', 'refactor', 'spec', 'plan']

const TYPE_LABEL: Record<TaskType, string> = {
  feature:  'Feature',
  bug:      'Bug',
  chore:    'Chore',
  spike:    'Spike',
  refactor: 'Refactor',
  spec:     'Spec',
  plan:     'Plan',
}

// ── Status metadata ────────────────────────────────────────────────────────

const ALL_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'draft', 'approved', 'done', 'closed', 'archived']

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo:        'Todo',
  in_progress: 'In progress',
  blocked:     'Blocked',
  draft:       'Draft',
  approved:    'Approved',
  done:        'Done',
  closed:      'Closed',
  archived:    'Archived',
}

// ── Priority metadata ──────────────────────────────────────────────────────

const ALL_PRIORITIES: TaskPriority[] = ['critical', 'high', 'medium', 'low']

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
}

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
  /** All known milestones (from useMilestones). */
  milestones: Milestone[]
  /** Favourited prefixes (P2-02). */
  favorites: string[]
  /** Open-task count per prefix, drives the chip badge. */
  projectCounts: Record<string, number>
  onToggleProject: (prefix: string) => void
  onToggleArea: (area: TaskArea) => void
  /** P2-02 — no-op until favourites ship. */
  onToggleFav: (prefix: string) => void
  // ── MCPAT-069 new dimension handlers ──────────────────────────────────────
  onToggleType: (type: TaskType) => void
  onToggleStatus: (status: TaskStatus) => void
  onTogglePriority: (priority: TaskPriority) => void
  onToggleMilestone: (milestoneId: string) => void
  onToggleAttention: () => void
  onSetScheduled: (v: Filter['scheduled']) => void
  onSetCreatedWithin: (v: Filter['createdWithin']) => void
  onSetUpdatedWithin: (v: Filter['updatedWithin']) => void
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
  milestones,
  favorites,
  projectCounts,
  onToggleProject,
  onToggleArea,
  onToggleFav,
  onToggleType,
  onToggleStatus,
  onTogglePriority,
  onToggleMilestone,
  onToggleAttention,
  onSetScheduled,
  onSetCreatedWithin,
  onSetUpdatedWithin,
  onClear,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // "More filters" disclosure — session-only state (not persisted)
  const [moreOpen, setMoreOpen] = useState(false)
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
  const activeCount = activeFilterCount(filter)

  // Count of more-filters dimensions (for the disclosure badge)
  const moreDimCount =
    filter.types.length + filter.statuses.length + filter.priorities.length +
    filter.milestones.length + (filter.attention ? 1 : 0) +
    (filter.scheduled != null ? 1 : 0) +
    (filter.createdWithin != null ? 1 : 0) +
    (filter.updatedWithin != null ? 1 : 0)

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
            {/* Projects section */}
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

            {/* Areas section */}
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

            {/* More filters disclosure (MCPAT-069 B5) */}
            <div className="fp-more-disclosure">
              <button
                type="button"
                className="fp-more-toggle"
                onClick={() => setMoreOpen(o => !o)}
              >
                {moreOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>More filters</span>
                {moreDimCount > 0 && (
                  <span className="fp-more-badge">{moreDimCount}</span>
                )}
              </button>

              {moreOpen && (
                <div className="fp-more-body">
                  {/* Type + Status in two-column grid */}
                  <div className="fp-two-col">
                    <div>
                      <div className="fp-sec-label">Type</div>
                      <div className="fp-chip-group">
                        {ALL_TYPES.map(t => {
                          const sel = filter.types.includes(t)
                          return (
                            <button
                              key={t}
                              type="button"
                              className={`fp-area-chip fp-dim-chip ${sel ? 'sel' : ''}`}
                              onClick={() => onToggleType(t)}
                            >
                              {TYPE_LABEL[t]}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="fp-sec-label">Status</div>
                      <div className="fp-chip-group">
                        {ALL_STATUSES.map(s => {
                          const sel = filter.statuses.includes(s)
                          return (
                            <button
                              key={s}
                              type="button"
                              className={`fp-area-chip fp-dim-chip ${sel ? 'sel' : ''}`}
                              onClick={() => onToggleStatus(s)}
                            >
                              <span className={`fp-dot ${STATUS_DOT[s]}`} />
                              {STATUS_LABEL[s]}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Priority */}
                  <div className="fp-sec-label" style={{ marginTop: 8 }}>Priority</div>
                  <div className="fp-areas">
                    {ALL_PRIORITIES.map(p => {
                      const sel = filter.priorities.includes(p)
                      return (
                        <button
                          key={p}
                          type="button"
                          className={`fp-area-chip fp-dim-chip ${sel ? 'sel' : ''}`}
                          onClick={() => onTogglePriority(p)}
                        >
                          <span className={`fp-dot-text ${PRIORITY_COLOR[p]}`} />
                          {PRIORITY_LABEL[p]}
                        </button>
                      )
                    })}
                  </div>

                  {/* Milestone */}
                  {milestones.length > 0 && (
                    <>
                      <div className="fp-sec-label" style={{ marginTop: 8 }}>Milestone</div>
                      <div className="fp-chip-group fp-milestone-chips">
                        {milestones.map(ms => {
                          const sel = filter.milestones.includes(ms.id)
                          return (
                            <button
                              key={ms.id}
                              type="button"
                              className={`fp-area-chip fp-dim-chip ${sel ? 'sel' : ''}`}
                              onClick={() => onToggleMilestone(ms.id)}
                            >
                              {ms.title}
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                  {/* Allow filtering by persisted milestone ids not in the current list (B6 tolerance) */}
                  {filter.milestones.filter(id => !milestones.find(m => m.id === id)).map(id => (
                    <button
                      key={id}
                      type="button"
                      className="fp-area-chip fp-dim-chip sel"
                      onClick={() => onToggleMilestone(id)}
                    >
                      {id}
                    </button>
                  ))}

                  {/* Needs attention toggle */}
                  <div className="fp-sec-label" style={{ marginTop: 8 }}>Attention</div>
                  <div className="fp-areas">
                    <button
                      type="button"
                      className={`fp-area-chip fp-dim-chip ${filter.attention ? 'sel' : ''}`}
                      onClick={onToggleAttention}
                      style={filter.attention ? { borderColor: '#F59E0B', color: '#F59E0B' } : undefined}
                    >
                      Needs attention
                    </button>
                  </div>

                  {/* Scheduled date presets (radio-style: picking active clears it) */}
                  <div className="fp-sec-label" style={{ marginTop: 8 }}>Scheduled</div>
                  <div className="fp-areas">
                    {(['today', 'week', 'overdue', 'none'] as const).map(v => {
                      const SCHED_LABEL: Record<typeof v, string> = { today: 'Today', week: 'This week', overdue: 'Overdue', none: 'Unscheduled' }
                      const sel = filter.scheduled === v
                      return (
                        <button
                          key={v}
                          type="button"
                          className={`fp-area-chip fp-dim-chip ${sel ? 'sel' : ''}`}
                          onClick={() => onSetScheduled(sel ? null : v)}
                        >
                          {SCHED_LABEL[v]}
                        </button>
                      )
                    })}
                  </div>

                  {/* Created within */}
                  <div className="fp-sec-label" style={{ marginTop: 8 }}>Created</div>
                  <div className="fp-areas">
                    {(['24h', '7d', '30d'] as const).map(v => {
                      const WIN_LABEL: Record<typeof v, string> = { '24h': 'Last 24h', '7d': 'Last 7 days', '30d': 'Last 30 days' }
                      const sel = filter.createdWithin === v
                      return (
                        <button
                          key={v}
                          type="button"
                          className={`fp-area-chip fp-dim-chip ${sel ? 'sel' : ''}`}
                          onClick={() => onSetCreatedWithin(sel ? null : v)}
                        >
                          {WIN_LABEL[v]}
                        </button>
                      )
                    })}
                  </div>

                  {/* Updated within */}
                  <div className="fp-sec-label" style={{ marginTop: 8 }}>Updated</div>
                  <div className="fp-areas">
                    {(['24h', '7d', '30d'] as const).map(v => {
                      const WIN_LABEL: Record<typeof v, string> = { '24h': 'Last 24h', '7d': 'Last 7 days', '30d': 'Last 30 days' }
                      const sel = filter.updatedWithin === v
                      return (
                        <button
                          key={v}
                          type="button"
                          className={`fp-area-chip fp-dim-chip ${sel ? 'sel' : ''}`}
                          onClick={() => onSetUpdatedWithin(sel ? null : v)}
                        >
                          {WIN_LABEL[v]}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* active filter chips — projects */}
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
      {/* active filter chips — areas */}
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
      {/* active filter chips — types */}
      {filter.types.map(t => (
        <button
          key={`ft-${t}`}
          className="filter-chip"
          onClick={() => onToggleType(t)}
          type="button"
        >
          {TYPE_LABEL[t]}
          <X size={12} />
        </button>
      ))}
      {/* active filter chips — statuses */}
      {filter.statuses.map(s => (
        <button
          key={`fs-${s}`}
          className="filter-chip"
          onClick={() => onToggleStatus(s)}
          type="button"
        >
          <span className={`fp-dot ${STATUS_DOT[s]}`} />
          {STATUS_LABEL[s]}
          <X size={12} />
        </button>
      ))}
      {/* active filter chips — priorities */}
      {filter.priorities.map(p => (
        <button
          key={`fpr-${p}`}
          className="filter-chip"
          onClick={() => onTogglePriority(p)}
          type="button"
        >
          <span className={PRIORITY_COLOR[p]} style={{ fontSize: 10 }}>●</span>
          {PRIORITY_LABEL[p]}
          <X size={12} />
        </button>
      ))}
      {/* active filter chips — milestones */}
      {filter.milestones.map(id => {
        const ms = milestones.find(m => m.id === id)
        return (
          <button
            key={`fm-${id}`}
            className="filter-chip"
            onClick={() => onToggleMilestone(id)}
            type="button"
          >
            {ms ? ms.title : id}
            <X size={12} />
          </button>
        )
      })}
      {/* active filter chip — attention */}
      {filter.attention && (
        <button
          className="filter-chip"
          onClick={onToggleAttention}
          type="button"
        >
          Needs attention
          <X size={12} />
        </button>
      )}
      {/* active filter chip — scheduled */}
      {filter.scheduled != null && (
        <button
          className="filter-chip"
          onClick={() => onSetScheduled(null)}
          type="button"
        >
          {filter.scheduled === 'today' ? 'Today'
            : filter.scheduled === 'week' ? 'This week'
              : filter.scheduled === 'overdue' ? 'Overdue'
                : 'Unscheduled'}
          <X size={12} />
        </button>
      )}
      {/* active filter chip — createdWithin */}
      {filter.createdWithin != null && (
        <button
          className="filter-chip"
          onClick={() => onSetCreatedWithin(null)}
          type="button"
        >
          Created: {filter.createdWithin}
          <X size={12} />
        </button>
      )}
      {/* active filter chip — updatedWithin */}
      {filter.updatedWithin != null && (
        <button
          className="filter-chip"
          onClick={() => onSetUpdatedWithin(null)}
          type="button"
        >
          Updated: {filter.updatedWithin}
          <X size={12} />
        </button>
      )}

      {active && (
        <button className="filter-clear" onClick={onClear} type="button">
          Clear
        </button>
      )}
    </div>
  )
}
