import React, { useCallback, useState } from 'react'
import {
  FileText,
  Code2,
  Globe,
  Braces,
  File,
  Copy,
  ExternalLink,
  Files,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react'
import { useArtifacts } from '../hooks/useArtifacts'
import { markArtifactOpened, openArtifact } from '../api'
import { PrefixBadge } from '../components/atoms'
import { ViewHeader } from '../components/ViewHeader'
import type { ArtifactEntry, PanelState } from '../types'
import { type Filter, matchProjectArea, type Area } from '../lib/filter'

// ── Constants ────────────────────────────────────────────────────────────────

export const STALE_FRESH_MAX_DAYS = 7
export const STALE_MID_MAX_DAYS = 21

// ── Helpers ──────────────────────────────────────────────────────────────────

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p
}

function extOf(p: string): string {
  const name = basename(p)
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

// ── File-type icon + color map ───────────────────────────────────────────────

interface ExtConfig {
  Icon: LucideIcon
  className: string
}

const EXT_MAP: Record<string, ExtConfig> = {
  md:   { Icon: FileText, className: 'text-ink-2' },
  txt:  { Icon: FileText, className: 'text-ink-2' },
  ts:   { Icon: Code2,    className: 'text-status-blue' },
  tsx:  { Icon: Code2,    className: 'text-status-blue' },
  js:   { Icon: Code2,    className: 'text-status-blue' },
  jsx:  { Icon: Code2,    className: 'text-status-blue' },
  html: { Icon: Globe,    className: 'text-status-amber' },
  json: { Icon: Braces,   className: 'text-status-green' },
}

const DEFAULT_EXT_CONFIG: ExtConfig = { Icon: File, className: 'text-ink-muted' }

function getExtConfig(ext: string): ExtConfig {
  return EXT_MAP[ext] ?? DEFAULT_EXT_CONFIG
}

// ── Staleness helpers ─────────────────────────────────────────────────────────

export function staleBadgeClasses(staleDays: number): { bg: string; text: string } {
  if (staleDays <= STALE_FRESH_MAX_DAYS) {
    return { bg: 'bg-status-green/15', text: 'text-status-green' }
  }
  if (staleDays <= STALE_MID_MAX_DAYS) {
    return { bg: 'bg-status-amber/15', text: 'text-status-amber' }
  }
  return { bg: 'bg-status-red/15', text: 'text-status-red' }
}

function StaleBadge({ staleDays }: { staleDays: number }): React.JSX.Element {
  const { bg, text } = staleBadgeClasses(staleDays)
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-badge font-mono text-xs tabular-nums shrink-0 ${bg} ${text}`}
    >
      {staleDays}d
    </span>
  )
}

// ── Sort helper (exported for tests) ─────────────────────────────────────────

export function sortByStaleDesc(artifacts: ArtifactEntry[]): ArtifactEntry[] {
  return [...artifacts].sort((a, b) => b.staleDays - a.staleDays)
}

// ── ArtifactRow ───────────────────────────────────────────────────────────────

interface ArtifactRowProps {
  artifact: ArtifactEntry
  onOpenPanel: (panel: PanelState) => void
  onCopied: (filename: string) => void
  onOpenError: (msg: string) => void
}

function ArtifactRow({ artifact, onOpenPanel, onCopied, onOpenError }: ArtifactRowProps): React.JSX.Element {
  const [copiedFlash, setCopiedFlash] = useState(false)
  const name = basename(artifact.path)
  const ext = extOf(artifact.path)
  const { Icon, className: iconClass } = getExtConfig(ext)
  const isUnvisited = artifact.last_opened_at === null
  const isLinkedDoc = artifact.source === 'linked-doc'

  const handleCopy = useCallback((): void => {
    const doCopy = async (): Promise<void> => {
      // Guard: clipboard API may be unavailable in insecure contexts
      if (!navigator.clipboard) return
      try {
        await navigator.clipboard.writeText(artifact.path)
      } catch {
        return
      }

      // Show brief "Copied!" flash (~1.4s)
      setCopiedFlash(true)
      setTimeout(() => setCopiedFlash(false), 1400)

      // Notify parent for toast
      onCopied(name)

      // Best-effort opened POST — must not block copy or throw to caller
      try {
        await markArtifactOpened(artifact.path)
      } catch {
        // swallow — telemetry only
      }
    }
    void doCopy()
  }, [artifact.path, name, onCopied])

  const handleOpenTask = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation()
    if (artifact.task_id) {
      onOpenPanel({ mode: 'detail', taskId: artifact.task_id })
    }
  }, [artifact.task_id, onOpenPanel])

  const handleOpenInApp = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation()
    const doOpen = async (): Promise<void> => {
      try {
        await openArtifact(artifact.path)
        try { await markArtifactOpened(artifact.path) } catch { /* telemetry only */ }
      } catch (err) {
        onOpenError(err instanceof Error ? err.message : 'Failed to open file')
      }
    }
    void doOpen()
  }, [artifact.path, onOpenError])

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-3 last:border-b-0 hover:bg-surface-2 transition-colors duration-100 min-h-[40px]">
      {/* File-type icon colored by extension */}
      <Icon size={16} className={`shrink-0 ${iconClass}`} />

      {/* Filename + path */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-ink text-sm font-medium truncate">
            {name}
          </span>
          {isUnvisited && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full bg-status-amber shrink-0"
              title="Not yet viewed"
              aria-label="Not yet viewed"
            />
          )}
          {isLinkedDoc && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-badge text-xs font-medium bg-status-blue/15 text-status-blue shrink-0">
              linked
            </span>
          )}
        </div>
        <span
          title={artifact.path}
          className="text-ink-muted text-xs font-mono truncate block leading-snug"
        >
          {artifact.path}
        </span>
      </div>

      {/* Project prefix badge */}
      <PrefixBadge project={artifact.project} />

      {/* Staleness badge */}
      <StaleBadge staleDays={artifact.staleDays} />

      {/* Open-in-app button */}
      <button
        onClick={handleOpenInApp}
        className="shrink-0 p-1 rounded hover:bg-surface-3 text-ink-muted hover:text-ink transition-colors"
        title="Open in default app"
        aria-label="Open in default app"
      >
        <FolderOpen size={14} />
      </button>

      {/* Copy-path button */}
      <button
        onClick={handleCopy}
        className="shrink-0 p-1 rounded hover:bg-surface-3 text-ink-muted hover:text-ink transition-colors"
        title="Copy path to clipboard"
        aria-label="Copy path"
      >
        {copiedFlash ? (
          <span className="text-status-green text-xs font-medium px-0.5">Copied!</span>
        ) : (
          <Copy size={14} />
        )}
      </button>

      {/* Linked-task navigation button — only when task_id is set */}
      {artifact.task_id && (
        <button
          onClick={handleOpenTask}
          className="shrink-0 p-1 rounded hover:bg-surface-3 text-ink-muted hover:text-ink transition-colors"
          title={`Open task ${artifact.task_id}`}
          aria-label={`Open linked task ${artifact.task_id}`}
        >
          <ExternalLink size={14} />
        </button>
      )}
    </div>
  )
}

// ── ArtifactsView ─────────────────────────────────────────────────────────────

interface ArtifactsViewProps {
  filter: Filter
  areaMap?: Record<string, Area>
  onOpenPanel: (panel: PanelState) => void
}

export function ArtifactsView({ filter, areaMap = {}, onOpenPanel }: ArtifactsViewProps): React.JSX.Element {
  const { artifacts, isLoading } = useArtifacts()
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  const handleCopied = useCallback((filename: string): void => {
    setToastMsg(`Copied path · ${filename}`)
    setTimeout(() => setToastMsg(null), 2200)
  }, [])

  const handleOpenError = useCallback((msg: string): void => {
    setOpenError(msg)
    setTimeout(() => setOpenError(null), 3000)
  }, [])

  // Artifacts carry only a project (→ area). Non-task surface: filter by project + area ONLY so an
  // active task-level dimension (type/status/priority/date/attention) never blanks the list (MCPAT-069 fix).
  const filtered = artifacts.filter(a => matchProjectArea(filter, a.project, undefined, areaMap))

  // AC-2: explicit client-side sort by staleDays descending — never rely on API ordering
  const sorted = sortByStaleDesc(filtered)
  const unvisited = sorted.filter(a => a.last_opened_at === null).length

  return (
    <div className="">
      {/* Header */}
      <ViewHeader
        title="Artifacts"
        subtitle={
          !isLoading && sorted.length > 0
            ? `${sorted.length} files · ${unvisited} unvisited`
            : undefined
        }
      />

      {/* Copy toast notification */}
      {toastMsg && (
        <div className="mb-3 px-3 py-2 rounded-input bg-surface-2 border border-surface-3 text-ink-2 text-xs">
          {toastMsg}
        </div>
      )}

      {/* Open-error notification */}
      {openError && (
        <div className="mb-3 px-3 py-2 rounded-input bg-status-red/10 border border-status-red/20 text-status-red text-xs">
          {openError}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <p className="text-ink-muted text-sm">Loading…</p>
      )}

      {/* Empty state — AC-6 (distinguishes "no data" from "filtered to nothing") */}
      {!isLoading && sorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Files size={32} className="text-ink-faint mb-4" />
          {artifacts.length > 0 ? (
            <>
              <p className="text-ink-2 font-medium text-sm mb-1">No artifacts match this filter</p>
              <p className="text-ink-muted text-sm max-w-xs">Clear the filter to see all artifacts.</p>
            </>
          ) : (
            <>
              <p className="text-ink-2 font-medium text-sm mb-1">No artifacts yet</p>
              <p className="text-ink-muted text-sm max-w-xs mb-2">
                Artifacts appear here as agents write files or when tasks have linked docs (spec, plan, or touched files).
              </p>
            </>
          )}
        </div>
      )}

      {/* Artifact list */}
      {!isLoading && sorted.length > 0 && (
        <div className="rounded-card border border-surface-3 overflow-hidden bg-surface-1">
          {sorted.map(a => (
            <ArtifactRow
              key={a.path}
              artifact={a}
              onOpenPanel={onOpenPanel}
              onCopied={handleCopied}
              onOpenError={handleOpenError}
            />
          ))}
        </div>
      )}
    </div>
  )
}