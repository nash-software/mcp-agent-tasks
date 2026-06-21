import React from 'react'
import { ArtifactCard } from './ArtifactCard.js'
import type { Artifact } from '../lib/advisor.js'

interface Props {
  artifacts: Artifact[]
  loading?: boolean
}

export function ArtifactsSection({ artifacts, loading = false }: Props): React.JSX.Element | null {
  if (loading) {
    return (
      <div className="artifacts-section">
        <div className="artifacts-section-header">
          <span className="artifacts-section-title">Living Artifacts</span>
        </div>
        <div className="artifacts-section-loading">Loading…</div>
      </div>
    )
  }

  if (artifacts.length === 0) return null

  return (
    <div className="artifacts-section">
      <div className="artifacts-section-header">
        <span className="artifacts-section-title">Living Artifacts</span>
        <span className="artifacts-section-count">{artifacts.length}</span>
      </div>
      <div className="artifacts-section-list">
        {artifacts.map(artifact => (
          <ArtifactCard key={artifact.id} artifact={artifact} />
        ))}
      </div>
    </div>
  )
}
