/**
 * SortControl — compact sort dropdown for Life OS (MCPAT-069 Phase C).
 *
 * Mirrors the `filter-btn` style. Shows "Sort: <Key> ↑/↓". Clicking opens a small menu of the
 * 7 sort keys. Clicking the active key toggles the direction. Outside-click closes (same
 * mousedown pattern as FilterBar). Placed next to FilterBar in the filter-bar row.
 */
import React, { useState, useEffect, useRef } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { type SortKey, type SortDir, SORT_KEY_LABEL } from '../lib/sort'

const SORT_KEYS: SortKey[] = ['priority', 'created', 'updated', 'scheduled', 'title', 'complexity', 'estimate']

interface Props {
  sort: { key: SortKey; dir: SortDir }
  onChange: (key: SortKey, dir: SortDir) => void
}

function dirArrow(dir: SortDir): string {
  return dir === 'asc' ? '↑' : '↓'
}

export function SortControl({ sort, onChange }: Props): React.JSX.Element {
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

  const handleKeySelect = (key: SortKey): void => {
    if (key === sort.key) {
      // Toggle direction
      onChange(key, sort.dir === 'asc' ? 'desc' : 'asc')
    } else {
      // New key — default to asc (priority defaults to asc = critical-first, which is most useful)
      onChange(key, 'asc')
    }
    setOpen(false)
  }

  return (
    <div className="sort-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`filter-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Sort tasks"
      >
        <ArrowUpDown size={13} />
        Sort: {SORT_KEY_LABEL[sort.key]} {dirArrow(sort.dir)}
      </button>

      {open && (
        <div className="sort-pop">
          {SORT_KEYS.map(key => {
            const isActive = key === sort.key
            return (
              <button
                key={key}
                type="button"
                className={`sort-pop-row ${isActive ? 'active' : ''}`}
                onClick={() => handleKeySelect(key)}
              >
                <span className="sort-pop-label">{SORT_KEY_LABEL[key]}</span>
                {isActive && (
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
