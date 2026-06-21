import React, { useState } from 'react'

interface Props {
  counterpoint: string
  tests: string[]
  onDismiss: () => void
}

export function ChallengeCard({ counterpoint, tests, onDismiss }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="challenge-card" role="region" aria-label="Challenger perspective">
      <div className="challenge-card-header">
        <span className="challenge-card-label">Challenger</span>
        <button
          className="challenge-card-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss challenger"
          title="Dismiss"
        >
          ×
        </button>
      </div>
      <p className="challenge-card-counterpoint">{counterpoint}</p>
      {tests.length > 0 && (
        <div className="challenge-card-tests">
          <button
            className="challenge-card-toggle"
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide' : 'Show'} tests ({tests.length})
          </button>
          {expanded && (
            <ul className="challenge-card-test-list">
              {tests.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
