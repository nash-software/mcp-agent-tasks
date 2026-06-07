/**
 * TriageView (MCPAT-077) — in-app wrapper for the triage engine.
 *
 * On mount: a fast Tier-0 (git) preview. "Run AI sweep" adds Tier-2 LLM reasoning
 * over the backlog (dry-run); "Apply" transitions the resolved tasks and exposes a
 * one-click Undo. Tasks the engine couldn't decide land in the "Needs your call" queue.
 */
import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Undo2, Check, ArrowRight, Loader2, AlertTriangle } from 'lucide-react'
import { ViewHeader } from '../components/ViewHeader'
import {
  fetchTriagePreview, runTriageSweep, undoTriageRun,
  type TriageReport, type TriageDecision, type TriageSkip,
} from '../api'
import type { PanelState } from '../types'

interface Props {
  onOpenPanel: (panel: PanelState) => void
}

const ESCALATION_REASONS = new Set(['llm-keep', 'llm-unsure', 'llm-error'])

/** Human label for an escalation skip reason. */
function reasonLabel(reason: string): string {
  switch (reason) {
    case 'llm-keep': return 'keep'
    case 'llm-unsure': return 'unsure'
    case 'llm-error': return 'no verdict'
    default: return reason
  }
}

function DecisionRow({ d, onOpen }: { d: TriageDecision; onOpen: (id: string) => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="w-full flex items-start gap-3 text-left px-3 py-2 rounded-input hover:bg-surface-2 transition-colors"
      onClick={() => onOpen(d.taskId)}
    >
      <span className="mt-0.5 text-status-green shrink-0"><Check size={14} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-ink">{d.taskId}</span>
          <span className="text-ink-faint text-xs">{d.fromStatus} → done</span>
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded-badge"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            {d.tier === 0 ? 'git' : 'AI'}{d.confidence !== undefined ? ` ${Math.round(d.confidence * 100)}%` : ''}
          </span>
        </div>
        <p className="text-ink-muted text-xs mt-0.5 leading-snug">{d.detail}</p>
      </div>
    </button>
  )
}

function EscalationRow({ s, onOpen }: { s: TriageSkip; onOpen: (id: string) => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="w-full flex items-start gap-3 text-left px-3 py-2 rounded-input hover:bg-surface-2 transition-colors group"
      onClick={() => onOpen(s.taskId)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-ink">{s.taskId}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-badge bg-surface-2 text-ink-muted">
            {reasonLabel(s.reason)}
          </span>
        </div>
        <p className="text-ink-muted text-xs mt-0.5 leading-snug">{s.detail}</p>
      </div>
      <span className="mt-0.5 text-ink-faint group-hover:text-ink-muted shrink-0"><ArrowRight size={14} /></span>
    </button>
  )
}

export function TriageView({ onOpenPanel }: Props): React.JSX.Element {
  const qc = useQueryClient()
  const [report, setReport] = useState<TriageReport | null>(null)
  const [runId, setRunId] = useState<string | null>(null)

  const preview = useQuery({ queryKey: ['triage', 'preview'], queryFn: fetchTriagePreview, refetchOnWindowFocus: false })
  const data = report ?? preview.data ?? null

  const sweep = useMutation({
    mutationFn: (opts: { apply: boolean }) => runTriageSweep({ llm: true, apply: opts.apply }),
    onSuccess: (r) => {
      setReport(r)
      setRunId(r.runId ?? null)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['today'] })
    },
  })

  const undo = useMutation({
    mutationFn: (id: string) => undoTriageRun(id),
    onSuccess: () => {
      setRunId(null)
      setReport(null)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void preview.refetch()
    },
  })

  const open = (id: string): void => onOpenPanel({ mode: 'detail', taskId: id })
  const busy = sweep.isPending || undo.isPending

  const subtitle = 'Auto-resolve completed & stale tasks'

  if (preview.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <ViewHeader title="Triage" subtitle={subtitle} />
        <div className="bg-surface-1 rounded-lg p-4 animate-pulse space-y-2">
          <div className="h-4 bg-surface-2 rounded w-56" />
          <div className="h-3 bg-surface-2 rounded w-40" />
        </div>
      </div>
    )
  }

  if (preview.error && !data) {
    return (
      <div className="flex flex-col gap-4">
        <ViewHeader title="Triage" subtitle={subtitle} />
        <p className="text-status-red text-sm">Failed to load triage preview: {(preview.error as Error).message}</p>
      </div>
    )
  }

  const decisions = data?.decisions ?? []
  const escalations = (data?.skips ?? []).filter(s => ESCALATION_REASONS.has(s.reason))
  const resolved = decisions.length
  const applied = data?.applied
  const ranAI = report !== null

  return (
    <div className="flex flex-col gap-4">
      <ViewHeader title="Triage" subtitle={subtitle} />

      {/* Summary + controls */}
      <div className="bg-surface-1 rounded-lg p-4 space-y-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-ink font-semibold" style={{ fontSize: 15 }}>
            {applied !== undefined
              ? `Resolved ${applied} of ${data?.totalOpen ?? 0} open`
              : `Would resolve ${resolved} of ${data?.totalOpen ?? 0} open`}
          </span>
          <span className="text-ink-faint text-xs font-mono tabular-nums">
            git {data?.tier0Count ?? 0} · AI {data?.tier2Count ?? 0} · needs you {escalations.length}
          </span>
        </div>

        {/* Per-project chips */}
        {data && data.projects.filter(p => p.open > 0).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.projects.filter(p => p.open > 0).map(p => (
              <span key={p.prefix} className="text-xs font-mono px-2 py-0.5 rounded-badge bg-surface-2 text-ink-muted">
                {p.prefix} <span className="text-ink-faint">{p.resolved}/{p.open}</span>
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn-sm-primary"
            disabled={busy}
            onClick={() => sweep.mutate({ apply: false })}
          >
            {sweep.isPending && !sweep.variables?.apply ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {ranAI ? 'Re-run AI sweep' : 'Run AI sweep'}
          </button>

          <button
            type="button"
            className="btn-sm"
            disabled={busy || resolved === 0}
            onClick={() => sweep.mutate({ apply: true })}
            title="Apply all resolutions and write an audit log you can undo"
          >
            {sweep.isPending && sweep.variables?.apply ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Apply {resolved > 0 ? `(${resolved})` : ''}
          </button>

          {runId && applied !== undefined && (
            <button type="button" className="btn-sm-ghost" disabled={busy} onClick={() => undo.mutate(runId)}>
              {undo.isPending ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
              Undo
            </button>
          )}
        </div>

        {sweep.isPending && (
          <p className="text-ink-muted text-xs flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            Reasoning over your backlog — this can take a few minutes.
          </p>
        )}
        {sweep.error && <p className="text-status-red text-xs">Sweep failed: {(sweep.error as Error).message}</p>}
        {undo.error && <p className="text-status-red text-xs">Undo failed: {(undo.error as Error).message}</p>}
        {applied !== undefined && data?.failed ? (
          <p className="text-status-amber text-xs flex items-center gap-1.5">
            <AlertTriangle size={12} /> {data.failed} transition(s) failed — see server logs.
          </p>
        ) : null}
        {!ranAI && (
          <p className="text-ink-faint text-xs">
            Showing git-only resolutions. Run the AI sweep to reason over the {data?.totalOpen ?? 0} open tasks.
          </p>
        )}
      </div>

      {/* Decisions */}
      {decisions.length > 0 && (
        <div className="bg-surface-1 rounded-lg p-3">
          <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-wide px-2 mb-1">
            {applied !== undefined ? 'Resolved' : 'Will resolve'} · {decisions.length}
          </h2>
          <div className="space-y-0.5">
            {decisions.map(d => <DecisionRow key={d.taskId} d={d} onOpen={open} />)}
          </div>
        </div>
      )}

      {/* Needs your call */}
      {escalations.length > 0 && (
        <div className="bg-surface-1 rounded-lg p-3">
          <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-wide px-2 mb-1">
            Needs your call · {escalations.length}
          </h2>
          <div className="space-y-0.5">
            {escalations.map(s => <EscalationRow key={s.taskId} s={s} onOpen={open} />)}
          </div>
        </div>
      )}

      {decisions.length === 0 && escalations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-ink-muted text-sm">Nothing to resolve right now.</p>
          <p className="text-ink-faint text-xs">Run the AI sweep to reason over stale tasks.</p>
        </div>
      )}
    </div>
  )
}
