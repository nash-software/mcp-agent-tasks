/**
 * EntityTimeline — shows typed semantic entities (beliefs, fears, values, commitments)
 * as a timeline, grouped by type and sorted by last_surfaced / source_session.
 *
 * Data source: GET /api/advisor/entities?type=belief|fear|value|commitment
 */
import React, { useState, useEffect } from 'react'
import type { BeliefRecord, FearRecord, ValueRecord, CommitmentRecord } from '../lib/advisor.js'

type EntityType = 'belief' | 'fear' | 'value' | 'commitment'

type AnyEntity = BeliefRecord | FearRecord | ValueRecord | CommitmentRecord

function fetchEntities(type: EntityType): Promise<AnyEntity[]> {
  return fetch(`/api/advisor/entities?type=${type}`)
    .then(r => r.ok ? r.json() as Promise<AnyEntity[]> : [])
    .catch(() => [])
}

const ENTITY_TYPES: EntityType[] = ['belief', 'fear', 'value', 'commitment']

const ENTITY_LABELS: Record<EntityType, string> = {
  belief: 'Beliefs',
  fear: 'Fears',
  value: 'Values',
  commitment: 'Commitments',
}

export function EntityTimeline(): React.JSX.Element {
  const [activeType, setActiveType] = useState<EntityType>('belief')
  const [entities, setEntities] = useState<AnyEntity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchEntities(activeType).then(data => {
      setEntities(data)
      setLoading(false)
    })
  }, [activeType])

  return (
    <div className="entity-timeline">
      <div className="entity-timeline-header">
        <span className="entity-timeline-title">Entity Timeline</span>
      </div>

      <div className="entity-timeline-tabs" role="tablist">
        {ENTITY_TYPES.map(type => (
          <button
            key={type}
            className={`entity-timeline-tab ${activeType === type ? 'active' : ''}`}
            role="tab"
            aria-selected={activeType === type}
            onClick={() => setActiveType(type)}
          >
            {ENTITY_LABELS[type]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="entity-timeline-loading">Loading…</div>
      ) : entities.length === 0 ? (
        <div className="entity-timeline-empty">
          No {ENTITY_LABELS[activeType].toLowerCase()} yet. Complete a coaching session to surface them.
        </div>
      ) : (
        <div className="entity-timeline-list">
          {entities.map((entity, i) => (
            <EntityCard key={i} entity={entity} type={activeType} />
          ))}
        </div>
      )}
    </div>
  )
}

interface EntityCardProps {
  entity: AnyEntity
  type: EntityType
}

function EntityCard({ entity, type }: EntityCardProps): React.JSX.Element {
  const belief = type === 'belief' ? entity as BeliefRecord : null
  const fear = type === 'fear' ? entity as FearRecord : null
  const value = type === 'value' ? entity as ValueRecord : null
  const commitment = type === 'commitment' ? entity as CommitmentRecord : null

  return (
    <div className={`entity-card entity-card--${type} ${belief?.reconciliation ? 'entity-card--reconciled' : ''}`}>
      {belief && (
        <>
          <div className="entity-card-statement">{belief.statement}</div>
          {belief.reconciliation && (
            <div className="entity-card-reconciled-badge">Softening</div>
          )}
          <div className="entity-card-meta">
            Surfaced {belief.surfaced_count}× · {belief.status}
          </div>
        </>
      )}
      {fear && (
        <>
          <div className="entity-card-statement">{fear.name}</div>
          {fear.body_location && <div className="entity-card-meta">Body: {fear.body_location}</div>}
          <div className="entity-card-meta">{fear.sessions.length} session{fear.sessions.length !== 1 ? 's' : ''}</div>
        </>
      )}
      {value && (
        <>
          <div className="entity-card-statement">{value.value}</div>
          <div className="entity-card-meta">Confidence: {(value.confidence * 100).toFixed(0)}%</div>
        </>
      )}
      {commitment && (
        <>
          <div className="entity-card-statement">{commitment.improvement_goal}</div>
          {commitment.hidden_commitment && (
            <div className="entity-card-meta">Hidden: {commitment.hidden_commitment}</div>
          )}
        </>
      )}
    </div>
  )
}
