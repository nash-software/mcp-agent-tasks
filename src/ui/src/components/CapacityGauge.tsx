/**
 * CapacityGauge — daily capacity bar with inline-editable target.
 *
 * AC #4: Bar fill = min(pct,1)*100%; fill+label colour follow zone:
 *   green ≤ 0.80, amber 0.80–1.0, red > 1.0
 * AC #5: Clicking the target turns it into a number input.
 *   Enter/blur persists; Escape reverts. Invalid/≤0 reverts.
 *   Persisted to localStorage('lifeos-target').
 */
import React, { useState, useRef } from 'react'
import { fmtHM } from '../lib/format'

interface CapacityGaugeProps {
  /** Minutes already committed (sum of estimate_hours * 60, excluding done/cancelled) */
  committedMinutes: number
  /** Daily target in minutes */
  targetMinutes: number
  /** Called when user changes the target — persist to localStorage + update state */
  onTargetChange: (newTargetMinutes: number) => void
  /**
   * P4-04: Number of committed (non-done/cancelled) tasks with no estimate_hours.
   * When > 0, shows an "N unestimated" hint so the user knows the gauge undercounts.
   */
  unestimatedCount?: number
}

type Zone = 'green' | 'amber' | 'red'

function getZone(pct: number): Zone {
  if (pct > 1.0) return 'red'
  if (pct >= 0.8) return 'amber'
  return 'green'
}

const ZONE_COLOR: Record<Zone, string> = {
  green: 'text-status-green',
  amber: 'text-status-amber',
  red:   'text-status-red',
}

const ZONE_BAR_COLOR: Record<Zone, string> = {
  green: 'bg-status-green',
  amber: 'bg-status-amber',
  red:   'bg-status-red',
}

export function CapacityGauge({
  committedMinutes,
  targetMinutes,
  onTargetChange,
  unestimatedCount = 0,
}: CapacityGaugeProps): React.JSX.Element {
  const pct = targetMinutes > 0 ? committedMinutes / targetMinutes : 0
  const clamped = Math.min(pct, 1)
  const zone = getZone(pct)
  const colorClass = ZONE_COLOR[zone]
  const barColorClass = ZONE_BAR_COLOR[zone]

  // Inline edit state for target
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  const committedHours = committedMinutes / 60
  const targetHours = targetMinutes / 60

  function startEdit(): void {
    setDraft(String(Math.round(targetHours * 10) / 10)) // one decimal
    setEditing(true)
    // Focus happens via autoFocus on input
  }

  function commitEdit(): void {
    const v = parseFloat(draft)
    if (!isNaN(v) && v > 0) {
      onTargetChange(Math.round(v * 60)) // convert hours → minutes
    }
    setEditing(false)
  }

  function cancelEdit(): void {
    setEditing(false)
  }

  const deltaMinutes = committedMinutes - targetMinutes

  return (
    <div className="space-y-1.5">
      {/* Label row */}
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-ink-muted uppercase tracking-wide font-medium">Capacity</span>

        {/* "4h 45m / 6h committed" */}
        <span className={`text-sm font-mono tabular-nums ${colorClass}`}>
          {fmtHM(committedHours)}
          <span className="text-ink-muted mx-1">/</span>
          {editing ? (
            <input
              ref={inputRef}
              autoFocus
              className="w-14 bg-surface-2 border border-accent rounded px-1 text-ink font-mono text-sm outline-none tabular-nums"
              value={draft}
              onChange={e => setDraft(e.target.value.replace(/[^0-9.]/g, ''))}
              onBlur={commitEdit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
                if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
              }}
            />
          ) : (
            <span
              className="cursor-pointer underline decoration-dotted decoration-ink-muted/50 hover:decoration-ink-2 transition-colors"
              title="Click to edit daily target"
              onClick={startEdit}
            >
              {fmtHM(targetHours)}
            </span>
          )}
          <span className="text-ink-muted ml-1 text-xs">committed</span>
        </span>
      </div>

      {/* Bar */}
      <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColorClass}`}
          style={{ width: `${Math.round(clamped * 100)}%` }}
        />
      </div>

      {/* Over-target warning */}
      {pct > 1 && (
        <p className="text-xs text-status-red">
          Over target by {fmtHM(deltaMinutes / 60)} — consider deferring something.
        </p>
      )}

      {/* P4-04: Unestimated hint — shown when committed tasks lack estimate_hours */}
      {unestimatedCount > 0 && (
        <p className="text-xs text-ink-muted">
          {unestimatedCount} unestimated
          <span className="text-ink-faint"> — gauge may undercount</span>
        </p>
      )}
    </div>
  )
}
