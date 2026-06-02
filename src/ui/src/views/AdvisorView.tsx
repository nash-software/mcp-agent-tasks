import React, { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lightbulb, RefreshCw, AlertCircle } from 'lucide-react'
import { ViewHeader } from '../components/ViewHeader'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Citation {
  type: 'note' | 'task'
  id: string
  snippet: string
}

interface Recommendation {
  rank: number
  action: string
  reasoning: string
  citations: Citation[]
}

interface AdvisorResponse {
  recommendations: Recommendation[]
  generated_at: string
  error?: 'UNAVAILABLE'
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchAdvisorQuery(project?: string): Promise<AdvisorResponse> {
  try {
    const res = await fetch('/api/advisor/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project }),
    })
    if (!res.ok) return { recommendations: [], generated_at: new Date().toISOString(), error: 'UNAVAILABLE' }
    return res.json() as Promise<AdvisorResponse>
  } catch {
    return { recommendations: [], generated_at: new Date().toISOString(), error: 'UNAVAILABLE' }
  }
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard(): React.JSX.Element {
  return (
    <div className="advisor-card skeleton" aria-hidden="true">
      <div className="skeleton-rank" />
      <div className="skeleton-body">
        <div className="skeleton-line w-3/4" />
        <div className="skeleton-line w-1/2 mt-1" />
      </div>
    </div>
  )
}

// ── RecommendationCard ────────────────────────────────────────────────────────

function RecommendationCard({ rec }: { rec: Recommendation }): React.JSX.Element {
  return (
    <div className="advisor-card">
      <span className="advisor-rank">{rec.rank}</span>
      <div className="advisor-content">
        <p className="advisor-action">{rec.action}</p>
        <p className="advisor-reasoning">{rec.reasoning}</p>
        {rec.citations.length > 0 && (
          <div className="advisor-citations">
            {rec.citations.map((c, i) => (
              <span key={i} className={`advisor-citation ${c.type}`} title={c.snippet}>
                {c.type === 'note' ? '📝' : '✓'} {c.id}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── AdvisorView ───────────────────────────────────────────────────────────────

export function AdvisorView(): React.JSX.Element {
  const queryClient = useQueryClient()

  const advisorQuery = useQuery({
    queryKey: ['advisor'],
    queryFn: () => fetchAdvisorQuery(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['advisor'] })
  }, [queryClient])

  const data = advisorQuery.data
  const isLoading = advisorQuery.isLoading
  const isUnavailable = data?.error === 'UNAVAILABLE' || advisorQuery.isError
  const hasRecommendations = (data?.recommendations.length ?? 0) > 0

  return (
    <div className="advisor-view">
      <ViewHeader
        title="Advisor"
        right={
          <button
            type="button"
            className="btn-icon"
            onClick={handleRefresh}
            disabled={isLoading}
            aria-label="Refresh advisor"
            title="Refresh"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {/* Loading state */}
      {isLoading && (
        <div className="advisor-cards">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Offline / error state */}
      {!isLoading && isUnavailable && (
        <div className="advisor-unavailable">
          <AlertCircle size={24} className="text-ink-faint" />
          <p className="text-ink-muted text-sm mt-2">
            Advisor unavailable — brain may be offline or claude CLI not found.
          </p>
          {data?.generated_at && (
            <p className="text-ink-faint text-xs mt-1">Last updated: {data.generated_at}</p>
          )}
          <button
            type="button"
            className="btn-sm mt-3"
            onClick={handleRefresh}
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isUnavailable && !hasRecommendations && (
        <div className="advisor-empty">
          <Lightbulb size={32} className="text-ink-faint" />
          <p className="text-ink-muted text-sm mt-2">
            Add some notes and tasks to get personalised advice.
          </p>
        </div>
      )}

      {/* Recommendations */}
      {!isLoading && hasRecommendations && (
        <div className="advisor-cards">
          {data!.recommendations.map(rec => (
            <RecommendationCard key={rec.rank} rec={rec} />
          ))}
        </div>
      )}
    </div>
  )
}
