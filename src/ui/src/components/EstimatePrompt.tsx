/**
 * EstimatePrompt — lightweight inline estimate input shown when committing a task to Today.
 *
 * Spec: P4-04 (AC 1, 2, 3)
 * - Quick chips: 30m / 1h / 2h / 4h → estimate_hours values 0.5 / 1 / 2 / 4
 * - Free numeric input (hours, positive)
 * - Skip button: commits without setting estimate
 *
 * Design tokens: surface-1 card, surface-2 inputs/chips, accent for confirm,
 * text-ink / text-ink-muted for type hierarchy. No modal — inline popover only.
 */
import React, { useState, useRef, useEffect } from 'react'
import { Clock, X } from 'lucide-react'

export interface EstimatePromptProps {
  taskTitle: string
  /** Called when user confirms an estimate (value in hours). */
  onConfirm: (estimateHours: number) => void
  /** Called when user skips (commits without estimate). */
  onSkip: () => void
  /** Called when user dismisses without any action. */
  onDismiss: () => void
}

interface Chip {
  label: string
  hours: number
}

const CHIPS: Chip[] = [
  { label: '30m', hours: 0.5 },
  { label: '1h',  hours: 1   },
  { label: '2h',  hours: 2   },
  { label: '4h',  hours: 4   },
]

/** Maximum sensible estimate (24h per day) */
const MAX_ESTIMATE_HOURS = 24

function parseHours(raw: string): number | null {
  const v = parseFloat(raw)
  if (!isFinite(v) || v <= 0 || v > MAX_ESTIMATE_HOURS) return null
  return v
}

export function EstimatePrompt({
  taskTitle,
  onConfirm,
  onSkip,
  onDismiss,
}: EstimatePromptProps): React.JSX.Element {
  const [custom, setCustom] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Focus the container so keyboard navigation works
  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  function handleChipClick(hours: number): void {
    setSelected(hours)
    setCustom('')
    setError(null)
  }

  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>): void {
    setCustom(e.target.value.replace(/[^0-9.]/g, ''))
    setSelected(null)
    setError(null)
  }

  function handleConfirm(): void {
    let hours: number | null = null

    if (selected !== null) {
      hours = selected
    } else if (custom.trim() !== '') {
      hours = parseHours(custom.trim())
      if (hours === null) {
        setError('Enter a number between 0.1 and 24')
        return
      }
    }

    if (hours === null) {
      // Nothing selected — treat as skip
      onSkip()
      return
    }

    onConfirm(hours)
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
    }
  }

  const hasValue = selected !== null || custom.trim() !== ''

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="rounded-card bg-surface-1 border border-surface-3 p-3 space-y-3 shadow-none outline-none"
      role="dialog"
      aria-label="Set time estimate"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Clock size={12} className="text-ink-muted flex-shrink-0" />
          <span className="text-xs text-ink-muted truncate">
            How long will <span className="text-ink font-medium">{taskTitle}</span> take?
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      </div>

      {/* Quick chips */}
      <div className="flex items-center gap-1.5" role="group" aria-label="Quick estimates">
        {CHIPS.map(chip => (
          <button
            key={chip.label}
            type="button"
            onClick={() => handleChipClick(chip.hours)}
            aria-pressed={selected === chip.hours}
            className={[
              'px-2 py-1 rounded text-xs font-mono font-medium transition-colors',
              selected === chip.hours
                ? 'bg-accent text-white'
                : 'bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink',
            ].join(' ')}
          >
            {chip.label}
          </button>
        ))}

        {/* Divider */}
        <span className="text-surface-3 text-xs select-none">|</span>

        {/* Custom input */}
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            placeholder="e.g. 1.5"
            value={custom}
            onChange={handleCustomChange}
            className={[
              'w-16 h-6 px-1.5 rounded text-xs font-mono bg-surface-2 border outline-none',
              'text-ink placeholder-ink-faint transition-colors',
              error
                ? 'border-status-red'
                : 'border-surface-3 focus:border-accent',
            ].join(' ')}
            aria-label="Custom hours"
            aria-invalid={error !== null}
          />
          <span className="text-xs text-ink-muted">h</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-status-red" role="alert">{error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-ink-muted hover:text-ink-2 transition-colors underline decoration-dotted decoration-ink-muted/50"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className={[
            'px-3 py-1 rounded text-xs font-medium transition-colors',
            hasValue
              ? 'bg-accent text-white hover:bg-accent-hover'
              : 'bg-surface-2 text-ink-muted cursor-default',
          ].join(' ')}
        >
          {hasValue ? 'Commit' : 'Commit anyway'}
        </button>
      </div>
    </div>
  )
}
