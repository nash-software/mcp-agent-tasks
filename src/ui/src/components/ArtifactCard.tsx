import React, { useState } from 'react'
import type { Artifact } from '../lib/advisor.js'

interface Props {
  artifact: Artifact
}

export function ArtifactCard({ artifact }: Props): React.JSX.Element {
  const [showHistory, setShowHistory] = useState(false)
  const latestVersion = artifact.versions[artifact.versions.length - 1]

  return (
    <div className="artifact-card">
      <div className="artifact-card-header">
        <div className="artifact-card-meta">
          <span className="artifact-card-kind">{artifact.kind.replace(/_/g, ' ')}</span>
          <span className="artifact-card-title">{artifact.title}</span>
        </div>
        {artifact.versions.length > 1 && (
          <button
            className="artifact-card-history-btn"
            onClick={() => setShowHistory(h => !h)}
            aria-expanded={showHistory}
            title="Version history"
          >
            v{artifact.versions.length}
          </button>
        )}
      </div>

      {latestVersion && (
        <div className="artifact-card-body">
          <pre className="artifact-card-content">{latestVersion.body}</pre>
        </div>
      )}

      {showHistory && artifact.versions.length > 1 && (
        <div className="artifact-card-history">
          <div className="artifact-card-history-label">Version history</div>
          {[...artifact.versions].reverse().map((v, i) => (
            <div key={i} className="artifact-card-version">
              <span className="artifact-card-version-ts">{v.ts.slice(0, 10)}</span>
              <pre className="artifact-card-version-body">{v.body.slice(0, 200)}{v.body.length > 200 ? '…' : ''}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
