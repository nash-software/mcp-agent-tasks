/**
 * ViewHeader — consistent view chrome for every view.
 * AC 11: title (19px/600/-0.02em), optional subtitle (ink-2), optional right meta.
 */
import React from 'react'

interface ViewHeaderProps {
  title: string
  /** Subtitle or secondary descriptor, rendered in ink-2. */
  subtitle?: string
  /** Right-aligned meta element (date, count, toggle, etc.). */
  right?: React.ReactNode
}

export function ViewHeader({ title, subtitle, right }: ViewHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div className="flex items-baseline gap-2.5 min-w-0">
        <h1
          className="font-semibold text-ink shrink-0"
          style={{ fontSize: 19, letterSpacing: '-0.02em' }}
        >
          {title}
        </h1>
        {subtitle && (
          <span className="text-sm text-ink-2 truncate">{subtitle}</span>
        )}
      </div>
      {right != null && (
        <div className="flex items-center gap-2 shrink-0 text-xs text-ink-muted font-mono tabular-nums">
          {right}
        </div>
      )}
    </div>
  )
}
