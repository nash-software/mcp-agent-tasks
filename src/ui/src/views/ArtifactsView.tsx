import React, { useCallback } from 'react'
import { useArtifacts } from '../hooks/useArtifacts'
import { markArtifactOpened } from '../api'
import type { ArtifactEntry } from '../types'

function basename(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p
}

function staleBadge(days: number): React.JSX.Element {
  if (days < 7) {
    return (
      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-900 text-emerald-300">
        {days}d
      </span>
    )
  }
  if (days <= 21) {
    return (
      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-900 text-amber-300">
        {days}d
      </span>
    )
  }
  return (
    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-900 text-red-300">
      {days}d
    </span>
  )
}

interface ArtifactRowProps {
  artifact: ArtifactEntry
  onCopied: (path: string) => void
}

function ArtifactRow({ artifact, onCopied }: ArtifactRowProps): React.JSX.Element {
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(artifact.path)
      onCopied(artifact.path)
      // Mark as opened after copy
      await markArtifactOpened(artifact.path)
    } catch {
      // clipboard may be unavailable in some contexts
    }
  }, [artifact.path, onCopied])

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 hover:bg-slate-900 transition-colors">
      <div className="flex-1 min-w-0">
        <span
          title={artifact.path}
          className="text-slate-200 text-sm font-medium truncate block"
        >
          {basename(artifact.path)}
        </span>
        <span className="text-slate-500 text-xs truncate block">{artifact.path}</span>
      </div>

      <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-900 text-indigo-300 shrink-0">
        {artifact.project}
      </span>

      {staleBadge(artifact.staleDays)}

      {artifact.task_id && (
        <span className="text-xs text-slate-400 shrink-0">
          {artifact.task_id}
        </span>
      )}

      <button
        onClick={() => { void handleCopy() }}
        className="px-2 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 shrink-0 transition-colors"
        title="Copy path to clipboard"
      >
        Copy path
      </button>
    </div>
  )
}

export function ArtifactsView(): React.JSX.Element {
  const { artifacts, isLoading } = useArtifacts()
  const [copiedPath, setCopiedPath] = React.useState<string | null>(null)

  const handleCopied = useCallback((p: string) => {
    setCopiedPath(p)
    setTimeout(() => setCopiedPath(null), 1800)
  }, [])

  const unvisited = artifacts.filter(a => a.last_opened_at === null).length

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-slate-100 font-semibold text-lg">Artifacts</h2>
        {!isLoading && artifacts.length > 0 && (
          <span className="text-slate-400 text-sm">
            {artifacts.length} from the last 30 days &mdash;{' '}
            <span className="text-amber-400">{unvisited} unvisited</span>
          </span>
        )}
      </div>

      {copiedPath && (
        <div className="mb-3 px-3 py-2 rounded bg-emerald-900 text-emerald-300 text-xs">
          Copied: {copiedPath}
        </div>
      )}

      {isLoading && (
        <p className="text-slate-500 text-sm">Loading artifacts...</p>
      )}

      {!isLoading && artifacts.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <p className="text-base mb-1">No artifacts tracked yet</p>
          <p className="text-sm">Artifacts appear here when Claude creates files for you.</p>
        </div>
      )}

      {!isLoading && artifacts.length > 0 && (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 bg-slate-800 text-xs text-slate-400 font-medium">
            <span className="flex-1">File</span>
            <span>Project</span>
            <span>Age</span>
            <span>Task</span>
            <span>Action</span>
          </div>
          {artifacts.map(a => (
            <ArtifactRow key={a.path} artifact={a} onCopied={handleCopied} />
          ))}
        </div>
      )}
    </div>
  )
}
