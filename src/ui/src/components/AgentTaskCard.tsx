/**
 * AgentTaskCard — renders a single triaged task in the Hermes queue.
 * Bucket badge + left-border accent via data-bucket, project badge, area dot,
 * robot-glyph rationale, and bucket-specific action buttons.
 * Port from design_handoff_life_os/reference/agent.jsx (AgentTaskCard + RunningCard).
 */
import React from 'react'
import {
  Lock,
  Zap,
  FlaskConical,
  Repeat,
  Hand,
  Server,
  Check,
  X,
  Bot,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import type { Task } from '../types'
import type { Triage, Bucket } from '../lib/triage'
import { BUCKETS } from '../lib/triage'
import { PrefixBadge, AreaDot } from './atoms'

// ── Bucket icon lookup (matches BUCKETS iconName) ─────────────────────────
const BUCKET_ICON: Record<Bucket, LucideIcon> = {
  signoff:     Lock,
  automatable: Zap,
  research:    FlaskConical,
  recurring:   Repeat,
  manual:      Hand,
}

// ── Left-border accent colour per bucket (inline style) ──────────────────
const BUCKET_BORDER: Record<Bucket, string> = {
  signoff:     '#F59E0B',  // status-amber
  automatable: '#22C55E',  // status-green
  research:    'var(--accent, #0070F3)',
  recurring:   '#3B82F6',  // status-blue
  manual:      '#71717A',  // ink-muted
}

// ── Props ─────────────────────────────────────────────────────────────────
export interface AgentTaskCardProps {
  task: Task
  tri: Triage
  onAction: (action: string, task: Task, tri: Triage) => void
  onOpen: (task: Task) => void
  onUnschedule: (task: Task) => void
  acrOffline?: boolean
}

export function AgentTaskCard({
  task,
  tri,
  onAction,
  onOpen,
  onUnschedule,
  acrOffline = false,
}: AgentTaskCardProps): React.JSX.Element {
  const bucket = tri.bucket
  const meta = BUCKETS[bucket]
  const BucketIcon = BUCKET_ICON[bucket]

  return (
    <div
      className="rounded-card bg-surface-1 border border-surface-3 p-3 flex flex-col gap-2"
      data-bucket={bucket}
      style={{ borderLeft: `3px solid ${BUCKET_BORDER[bucket]}` }}
    >
      {/* Head: bucket badge + project + area + unschedule button */}
      <div className="flex items-center gap-2 min-w-0">
        <span className={`flex items-center gap-1 text-xs font-medium shrink-0 ${meta.colorClass}`}>
          <BucketIcon size={12} />
          {meta.label}
        </span>
        {task.project && <PrefixBadge project={task.project} />}
        {task.area && <AreaDot area={task.area} />}
        <span className="flex-1" />
        <button
          className="shrink-0 text-ink-muted hover:text-ink transition-colors"
          title="Remove from agent queue"
          onClick={() => { onUnschedule(task) }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Title */}
      <div
        className="text-sm font-medium text-ink cursor-pointer hover:text-accent transition-colors leading-snug"
        onClick={() => { onOpen(task) }}
      >
        {task.title}
      </div>

      {/* Rationale — robot glyph prefix */}
      <div className="flex items-start gap-1.5 text-xs text-ink-muted leading-relaxed">
        <Bot size={12} className="shrink-0 mt-0.5 text-ink-muted" />
        <span>{tri.rationale}</span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap mt-0.5">
        {bucket === 'automatable' && tri.skill && (
          <>
            <button
              className="btn-sm-primary flex items-center gap-1"
              onClick={() => { onAction('run', task, tri) }}
              disabled={tri.skill.engine === 'acr' && acrOffline}
              title={tri.skill.engine === 'acr' && acrOffline ? 'ACR offline' : undefined}
            >
              {tri.skill.engine === 'acr'
                ? <Server size={12} />
                : tri.skill.engine === 'n8n'
                ? <Repeat size={12} />
                : <Zap size={12} />}
              {tri.skill.engine === 'acr'
                ? 'Run on ACR'
                : tri.skill.engine === 'n8n'
                ? 'Run via n8n'
                : `Run ${tri.skill.name}`}
            </button>
            <span className="flex items-center gap-1 text-xs text-ink-muted px-1.5 py-0.5 rounded-badge bg-surface-2">
              <Zap size={10} />
              {tri.skill.name} · {tri.skill.runs} runs
            </span>
          </>
        )}

        {bucket === 'research' && (
          <>
            <button
              className="btn-sm-primary flex items-center gap-1"
              onClick={() => { onAction('research', task, tri) }}
            >
              <FlaskConical size={12} />
              Research automation
            </button>
            {tri.acr && (
              <button
                className="btn-sm flex items-center gap-1"
                onClick={() => { onAction('acr', task, tri) }}
                disabled={acrOffline}
                title={acrOffline ? 'ACR offline' : 'Hand straight to ACR to execute once'}
              >
                <Server size={12} />
                → ACR
              </button>
            )}
          </>
        )}

        {bucket === 'recurring' && (
          <>
            <button
              className="btn-sm flex items-center gap-1"
              onClick={() => { onAction('schedule', task, tri) }}
            >
              <Repeat size={12} />
              Put on a schedule
            </button>
            {tri.acr ? (
              <button
                className="btn-sm-ghost flex items-center gap-1"
                onClick={() => { onAction('acr', task, tri) }}
                disabled={acrOffline}
                title={acrOffline ? 'ACR offline' : undefined}
              >
                <Server size={12} />
                Run once on ACR
              </button>
            ) : (
              <button
                className="btn-sm-ghost flex items-center gap-1"
                onClick={() => { onAction('assist', task, tri) }}
              >
                Run once
              </button>
            )}
          </>
        )}

        {bucket === 'signoff' && (
          <>
            <button
              className="btn-sm-primary flex items-center gap-1"
              onClick={() => { onAction('approve', task, tri) }}
              disabled={acrOffline}
              title={acrOffline ? 'ACR offline' : undefined}
            >
              <Check size={12} />
              Approve &amp; dispatch
            </button>
            <button
              className="btn-sm-ghost flex items-center gap-1"
              onClick={() => { onOpen(task) }}
            >
              Open
            </button>
          </>
        )}

        {bucket === 'manual' && (
          <>
            <button
              className="btn-sm-ghost flex items-center gap-1"
              onClick={() => { onAction('assist', task, tri) }}
            >
              <WandSparkles size={12} />
              Draft a first pass
            </button>
            {tri.acr && (
              <button
                className="btn-sm flex items-center gap-1"
                onClick={() => { onAction('acr', task, tri) }}
                disabled={acrOffline}
                title={acrOffline ? 'ACR offline' : 'Software work — hand it to ACR'}
              >
                <Server size={12} />
                Put on ACR
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── RunningCard — task actively being worked on ────────────────────────────
interface RunningCardProps {
  task: Task
}

export function RunningCard({ task }: RunningCardProps): React.JSX.Element {
  const viaAcr = (task as Task & { _via?: string })._via === 'ACR'
  return (
    <div className="rounded-card bg-surface-1 border border-surface-3 border-l-[3px] p-3 flex flex-col gap-2"
      style={{ borderLeftColor: '#3B82F6' }}>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-status-blue">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-status-blue animate-pulse" />
          {viaAcr ? 'Running on ACR' : 'Hermes working'}
        </span>
        {task.project && <PrefixBadge project={task.project} />}
      </div>
      <div className="text-sm font-medium text-ink">{task.title}</div>
      <div className="font-mono text-xs text-ink-muted">
        {viaAcr
          ? `$ acr run — job · streaming…`
          : `hermes · working…`}
      </div>
    </div>
  )
}
