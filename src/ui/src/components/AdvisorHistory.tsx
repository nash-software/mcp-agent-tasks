/**
 * AdvisorHistory.tsx — Session history panel for the Advisor right rail.
 * Replaces LiveFeedSection when view === 'advisor'.
 * List view → click row → detail view (read-only transcript).
 */
import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { fetchAdvisorSessions, fetchAdvisorSession, type AdvisorSession } from '../api'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtRelDate(iso: string): string {
  const now = new Date()
  const d = new Date(iso)
  const todayStr = now.toISOString().slice(0, 10)
  const dStr = d.toISOString().slice(0, 10)
  if (dStr === todayStr) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dStr === yesterday.toISOString().slice(0, 10)) return 'Yesterday'
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  return `${diffDays} days ago`
}

function sessionTitle(s: AdvisorSession): string {
  if (s.summary) return s.summary
  const firstUser = s.full_log.find(m => m.role === 'user')
  if (firstUser) return firstUser.content.slice(0, 60) + (firstUser.content.length > 60 ? '…' : '')
  return 'Conversation'
}

const MODE_LABELS: Record<string, string> = { pm: 'PM', chairman: 'Chairman', coach: 'Coach' }

// ── List view ──────────────────────────────────────────────────────────────

function SessionRow({ s, onClick }: { s: AdvisorSession; onClick: () => void }): React.JSX.Element {
  return (
    <button className="adv-hist-row" onClick={onClick}>
      <div className="adv-hist-row-main">
        <span className={`adv-hist-chip mode-${s.mode}`}>{MODE_LABELS[s.mode] ?? s.mode}</span>
        <span className="adv-hist-title">{sessionTitle(s)}</span>
      </div>
      <span className="adv-hist-date">{fmtRelDate(s.started_at)}</span>
    </button>
  )
}

// ── Detail view ────────────────────────────────────────────────────────────

function SessionDetail({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [pathStatus, setPathStatus] = useState<'idle' | 'ok' | 'fail'>('idle')

  const { data: session, isLoading } = useQuery({
    queryKey: ['advisor-session', id],
    queryFn: () => fetchAdvisorSession(id),
    staleTime: 60_000,
  })

  if (isLoading || !session) {
    return <div className="adv-hist-detail-loading">Loading…</div>
  }

  async function handleCopyTranscript(): Promise<void> {
    const text = (session?.full_log ?? [])
      .map(m => `${m.role === 'user' ? 'User' : 'Advisor'}: ${m.content}`)
      .join('\n---\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('ok')
      setTimeout(() => setCopyStatus('idle'), 2000)
    } catch {
      setCopyStatus('fail')
      setTimeout(() => setCopyStatus('idle'), 2000)
    }
  }

  async function handleCopyPath(): Promise<void> {
    try {
      await navigator.clipboard.writeText('~/.mcp-tasks/advisor-sessions/sessions.jsonl')
      setPathStatus('ok')
      setTimeout(() => setPathStatus('idle'), 2000)
    } catch {
      setPathStatus('fail')
      setTimeout(() => setPathStatus('idle'), 2000)
    }
  }

  const copyLabel = copyStatus === 'ok' ? 'Copied!' : copyStatus === 'fail' ? 'Failed' : 'Copy transcript'
  const pathLabel = pathStatus === 'ok' ? 'Copied!' : pathStatus === 'fail' ? 'Failed' : 'Copy path'

  return (
    <div className="adv-hist-detail">
      <div className="adv-hist-detail-head">
        <button className="adv-hist-back" onClick={onBack} aria-label="Back to history">
          <ArrowLeft size={14} />
        </button>
        <span className={`adv-hist-chip mode-${session.mode}`}>{MODE_LABELS[session.mode] ?? session.mode}</span>
        <span className="adv-hist-detail-date">{fmtRelDate(session.started_at)}</span>
      </div>

      <div className="adv-hist-transcript">
        {session.full_log.length === 0 ? (
          <div className="adv-hist-unavail">Transcript unavailable</div>
        ) : (
          session.full_log.map((m, i) => (
            <div key={i} className={`adv-msg ${m.role}`}>
              <div className="adv-bubble">{m.content}</div>
            </div>
          ))
        )}
      </div>

      <div className="adv-hist-detail-foot">
        <button className="adv-hist-foot-btn" onClick={() => void handleCopyTranscript()}>
          {copyLabel}
        </button>
        <button className="adv-hist-foot-btn" onClick={() => void handleCopyPath()}>
          {pathLabel}
        </button>
      </div>
    </div>
  )
}

// ── AdvisorHistory (exported) ──────────────────────────────────────────────

interface Props {
  onSelectSession?: (id: string) => void
}

export function AdvisorHistory({ onSelectSession }: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['advisor-sessions'],
    queryFn: () => fetchAdvisorSessions(20),
    staleTime: 30_000,
  })

  if (selectedId !== null) {
    return (
      <SessionDetail
        id={selectedId}
        onBack={() => setSelectedId(null)}
      />
    )
  }

  return (
    <div className="adv-hist">
      <div className="adv-hist-head">
        <span className="section-label">Past conversations</span>
      </div>
      {isLoading ? (
        <div className="adv-hist-empty">Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="adv-hist-empty">
          No past conversations yet — start chatting with the Advisor.
        </div>
      ) : (
        <div className="adv-hist-list">
          {sessions.map(s => (
            <SessionRow
              key={s.id}
              s={s}
              onClick={() => {
                setSelectedId(s.id)
                onSelectSession?.(s.id)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
