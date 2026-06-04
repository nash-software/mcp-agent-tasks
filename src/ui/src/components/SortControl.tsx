/**
 * SortControl — compact sort dropdown for Life OS (MCPAT-069 Phase C).
 *
 * Mirrors the `filter-btn` style. Shows "Sort: <Key> ↑/↓". Clicking opens a small menu of the
 * 7 sort keys. Clicking the active key toggles the direction. Outside-click closes (same
 * mousedown pattern as FilterBar). Placed next to FilterBar in the filter-bar row.
 *
 * MCPAT-070 Phase C: added `keys` and `todayMode` props.
 *   keys       — overrides the displayed sort key list (defaults to the 7 board keys).
 *   todayMode  — when true, renders the Today-style button (↕ Sort: <bold> ⌄, no dir arrows,
 *                active row shows ✓ checkmark). Board usage is 100% unchanged.
 */
import React, { useState, useEffect, useRef } from 'react'
import { ArrowUpDown, ChevronDown } from 'lucide-react'
import { type SortKey, type SortDir, SORT_KEY_LABEL, type TodaySortKey, TODAY_SORT_KEY_LABEL } from '../lib/sort'

const SORT_KEYS: SortKey[] = ['priority', 'created', 'updated', 'scheduled', 'title', 'complexity', 'estimate']

interface Props {
  sort: { key: SortKey; dir: SortDir }
  onChange: (key: SortKey, dir: SortDir) => void
  /** Override displayed keys (e.g. Today toolbar passes TodaySortKey values). Defaults to 7 board keys. */
  keys?: readonly string[]
  /** When true, renders Today-style button (bold label, ⌄ chevron, ✓ active indicator). */
  todayMode?: boolean
}

function dirArrow(dir: SortDir): string {
  return dir === 'asc' ? '↑' : '↓'
}

/** Combined label lookup: board SortKey labels + Today-specific labels, fallback to key string. */
function labelFor(k: string): string {
  return (SORT_KEY_LABEL as Record<string, string>)[k]
    ?? (TODAY_SORT_KEY_LABEL as Record<string, string>)[k as TodaySortKey]
    ?? k
}

export function SortControl({ sort, onChange, keys, todayMode = false }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const displayKeys: readonly string[] = keys ?? SORT_KEYS

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const handleKeySelect = (key: string): void => {
    if (todayMode) {
      // Today mode: direction is fixed by taskCmp — always pass 'asc' (direction is ignored by caller)
      onChange(key as SortKey, 'asc')
    } else if (key === sort.key) {
      // Board mode: toggle direction on active key
      onChange(key as SortKey, sort.dir === 'asc' ? 'desc' : 'asc')
    } else {
      // Board mode: new key — default to asc
      onChange(key as SortKey, 'asc')
    }
    setOpen(false)
  }

  const activeLabel = labelFor(sort.key)

  return (
    <div className="sort-anchor" ref={anchorRef}>
      {todayMode ? (
        <button
          type="button"
          className={`filter-btn ${open ? 'on' : ''}`}
          onClick={() => setOpen(o => !o)}
          title="Sort tasks"
        >
          <ArrowUpDown size={13} />
          Sort: <b>{activeLabel}</b>
          <ChevronDown size={11} style={{ marginLeft: 2 }} />
        </button>
      ) : (
        <button
          type="button"
          className={`filter-btn ${open ? 'on' : ''}`}
          onClick={() => setOpen(o => !o)}
          title="Sort tasks"
        >
          <ArrowUpDown size={13} />
          Sort: {SORT_KEY_LABEL[sort.key]} {dirArrow(sort.dir)}
        </button>
      )}

      {open && (
        <div className="sort-pop">
          {displayKeys.map(key => {
            const isActive = key === sort.key
            return (
              <button
                key={key}
                type="button"
                className={`sort-pop-row ${isActive ? 'active' : ''}`}
                onClick={() => handleKeySelect(key)}
              >
                <span className="sort-pop-label">{labelFor(key)}</span>
                {isActive && todayMode && (
                  <span className="sort-pop-dir">✓</span>
                )}
                {isActive && !todayMode && (
                  <span className="sort-pop-dir">{dirArrow(sort.dir)}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
