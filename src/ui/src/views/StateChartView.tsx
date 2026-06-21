/**
 * StateChartView — visualises the advisor state log as a sparkline-style
 * arousal/valence chart over time.
 *
 * Data source: GET /api/advisor/state-log
 */
import React, { useState, useEffect } from 'react'

interface StateEntry {
  ts: string
  session_id?: string
  arousal: number
  valence: number
  mode: string
  triggers?: string[]
}

function fetchStateLog(limit: number): Promise<StateEntry[]> {
  return fetch(`/api/advisor/state-log?limit=${limit}`)
    .then(r => r.ok ? r.json() as Promise<StateEntry[]> : [])
    .catch(() => [])
}

export function StateChartView(): React.JSX.Element {
  const [entries, setEntries] = useState<StateEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStateLog(100).then(data => {
      setEntries(data)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return <div className="state-chart-view"><div className="state-chart-loading">Loading state history…</div></div>
  }

  if (entries.length === 0) {
    return (
      <div className="state-chart-view">
        <div className="state-chart-empty">No state history yet. Start a coaching session to build your chart.</div>
      </div>
    )
  }

  const maxPoints = 50
  const recent = entries.slice(-maxPoints)
  const chartH = 80
  const chartW = 400

  return (
    <div className="state-chart-view">
      <div className="state-chart-header">
        <span className="state-chart-title">Nervous System State</span>
        <span className="state-chart-subtitle">{entries.length} data points</span>
      </div>

      <svg
        className="state-chart-svg"
        viewBox={`0 0 ${chartW} ${chartH}`}
        preserveAspectRatio="none"
        aria-label="State chart"
        role="img"
      >
        {/* Arousal line (top = high) */}
        {recent.length > 1 && (
          <polyline
            className="state-chart-arousal"
            points={recent.map((e, i) => {
              const x = (i / (recent.length - 1)) * chartW
              const y = chartH - e.arousal * chartH
              return `${x},${y}`
            }).join(' ')}
          />
        )}
        {/* Valence line (top = positive) */}
        {recent.length > 1 && (
          <polyline
            className="state-chart-valence"
            points={recent.map((e, i) => {
              const x = (i / (recent.length - 1)) * chartW
              const y = chartH - ((e.valence + 1) / 2) * chartH
              return `${x},${y}`
            }).join(' ')}
          />
        )}
      </svg>

      <div className="state-chart-legend">
        <span className="state-chart-legend-arousal">Arousal</span>
        <span className="state-chart-legend-valence">Valence</span>
      </div>

      <div className="state-chart-table">
        {[...recent].reverse().slice(0, 10).map((e, i) => (
          <div key={i} className="state-chart-row">
            <span className="state-chart-row-ts">{e.ts.slice(0, 16).replace('T', ' ')}</span>
            <span className="state-chart-row-mode">{e.mode}</span>
            <span className="state-chart-row-arousal">{e.arousal.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
