/**
 * ProjectsModal — settings cog → manage projects (MCPAT-063).
 *
 * Two sections:
 * 1. List of existing projects with inline name editing (PATCH /api/projects/:prefix).
 * 2. Add-project form: prefix + name + FolderBrowser (GET /api/fs/list) + storage → POST.
 *
 * Mirrors NewTaskModal shell exactly: fixed inset-0 z-50 backdrop, w-[440px] surface-1 panel,
 * header + close, error alert badge, fieldClass inputs, footer buttons, return null when !open.
 */
import React, { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createProject, updateProject, listDir, type ProjectEntry } from '../api'

interface Props {
  open: boolean
  onClose: () => void
  projects: ProjectEntry[]
}

// ── FolderBrowser sub-component ──────────────────────────────────────────────

interface FolderBrowserProps {
  selectedPath: string
  onSelect: (p: string) => void
}

function FolderBrowser({ selectedPath, onSelect }: FolderBrowserProps): React.JSX.Element {
  // browsePath = null means "show roots"
  const [browsePath, setBrowsePath] = useState<string | undefined>(undefined)

  const { data, isLoading, error } = useQuery({
    queryKey: ['fs-list', browsePath],
    queryFn: () => listDir(browsePath),
    staleTime: 0,
  })

  const fieldClass = 'w-full text-sm text-ink bg-surface-2 border border-surface-3 rounded px-2 py-1.5 outline-none focus:border-accent'

  // Build breadcrumbs from browsePath
  const crumbs: { label: string; path: string | undefined }[] = [{ label: 'Roots', path: undefined }]
  if (browsePath) {
    const sep = browsePath.includes('\\') ? '\\' : '/'
    const parts = browsePath.split(sep).filter(Boolean)
    // For Windows paths like C:\Users\foo, parts = ['C:', 'Users', 'foo']
    // For Unix paths like /home/foo, parts = ['home', 'foo']
    let accumulated = ''
    for (const part of parts) {
      if (accumulated === '' && browsePath.startsWith('/')) {
        accumulated = '/' + part
      } else if (accumulated === '') {
        accumulated = part + sep
      } else {
        accumulated = accumulated + sep + part
      }
      crumbs.push({ label: part || sep, path: accumulated })
    }
  }

  function navigateUp(): void {
    if (!browsePath) return
    const parent = browsePath.replace(/[/\\][^/\\]+[/\\]?$/, '')
    setBrowsePath(parent.length > 0 && parent !== browsePath ? parent : undefined)
  }

  function handleDirClick(dir: string): void {
    const sep = browsePath
      ? (browsePath.includes('\\') ? '\\' : '/')
      : (dir.includes(':') ? '\\' : '/')
    const next = browsePath ? browsePath.replace(/[/\\]?$/, sep) + dir : dir
    setBrowsePath(next)
    onSelect(next)
  }

  return (
    <div className="border border-surface-3 rounded bg-surface-2 text-sm">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-surface-3 flex-wrap">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-ink-faint text-xs">/</span>}
            <button
              type="button"
              onClick={() => { setBrowsePath(c.path); if (c.path) onSelect(c.path) }}
              className="text-xs text-accent hover:underline"
            >
              {c.label}
            </button>
          </React.Fragment>
        ))}
        {browsePath && (
          <button
            type="button"
            onClick={navigateUp}
            className="ml-auto text-xs text-ink-muted hover:text-ink px-1"
            title="Up one level"
          >
            ↑
          </button>
        )}
      </div>

      {/* Directory listing */}
      <div className="max-h-40 overflow-y-auto">
        {isLoading && <div className="px-3 py-2 text-xs text-ink-muted">Loading…</div>}
        {error && <div className="px-3 py-2 text-xs text-status-red">{String(error)}</div>}
        {!isLoading && !error && data && data.dirs.length === 0 && (
          <div className="px-3 py-2 text-xs text-ink-faint">(no sub-directories)</div>
        )}
        {!isLoading && !error && data?.dirs.map(dir => {
          const sep = browsePath
            ? (browsePath.includes('\\') ? '\\' : '/')
            : (dir.includes(':') ? '\\' : '/')
          const full = browsePath ? browsePath.replace(/[/\\]?$/, sep) + dir : dir
          const isSelected = selectedPath === full
          return (
            <button
              key={dir}
              type="button"
              onClick={() => handleDirClick(dir)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                isSelected
                  ? 'bg-accent/20 text-accent'
                  : 'text-ink-muted hover:bg-surface-3 hover:text-ink'
              }`}
            >
              {dir}
            </button>
          )
        })}
      </div>

      {/* Selected path display */}
      {selectedPath && (
        <div className="px-2 py-1.5 border-t border-surface-3">
          <input
            type="text"
            readOnly
            value={selectedPath}
            className={`${fieldClass} text-xs font-mono`}
            aria-label="Selected folder path"
          />
        </div>
      )}
    </div>
  )
}

// ── InlineNameEditor ──────────────────────────────────────────────────────────

interface InlineNameEditorProps {
  prefix: string
  initialName: string | undefined
  onSaved: () => void
}

function InlineNameEditor({ prefix, initialName, onSaved }: InlineNameEditorProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const [name, setName] = useState(initialName ?? '')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const mut = useMutation({
    mutationFn: (n: string) => updateProject(prefix, { name: n }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      setErrorMsg(null)
      onSaved()
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    },
  })

  function save(): void {
    const trimmed = name.trim()
    mut.mutate(trimmed)
  }

  const fieldClass = 'text-sm text-ink bg-surface-2 border border-surface-3 rounded px-2 py-1 outline-none focus:border-accent'

  return (
    <div className="flex flex-col gap-1 flex-1">
      <input
        type="text"
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save() }}
        className={`${fieldClass} w-full`}
        aria-label={`Name for project ${prefix}`}
        placeholder="Display name…"
      />
      {errorMsg && (
        <div role="alert" className="text-[10px] text-status-red">{errorMsg}</div>
      )}
    </div>
  )
}

// ── ProjectsModal ─────────────────────────────────────────────────────────────

export function ProjectsModal({ open, onClose, projects }: Props): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const prefixRef = useRef<HTMLInputElement>(null)

  const [prefix, setPrefix] = useState('')
  const [name, setName] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [storage, setStorage] = useState<'global' | 'local'>('global')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPrefix(''); setName(''); setFolderPath(''); setStorage('global'); setErrorMsg(null)
      setTimeout(() => prefixRef.current?.focus(), 0)
    }
  }, [open])

  const addMutation = useMutation({
    mutationFn: (fields: { prefix: string; path: string; name?: string; storage: 'global' | 'local' }) =>
      createProject(fields),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      setPrefix(''); setName(''); setFolderPath(''); setStorage('global'); setErrorMsg(null)
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    },
  })

  if (!open) return null

  const canAdd = prefix.trim().length > 0 && folderPath.trim().length > 0 && !addMutation.isPending

  function handleAdd(): void {
    setErrorMsg(null)
    const trimmedPrefix = prefix.trim().toUpperCase()
    const trimmedPath = folderPath.trim()
    if (!trimmedPrefix) { setErrorMsg('Prefix is required.'); return }
    if (!trimmedPath) { setErrorMsg('Folder path is required — use the browser to select a directory.'); return }
    addMutation.mutate({
      prefix: trimmedPrefix,
      path: trimmedPath,
      ...(name.trim() ? { name: name.trim() } : {}),
      storage,
    })
  }

  const fieldClass = 'w-full text-sm text-ink bg-surface-2 border border-surface-3 rounded px-2 py-1.5 outline-none focus:border-accent'
  const labelClass = 'block text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-1'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Manage projects"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div
        className="w-[440px] max-w-[92vw] bg-surface-1 border border-surface-3 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-3 flex-shrink-0">
          <h2 className="text-sm font-semibold text-ink">Manage projects</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink text-lg leading-none" aria-label="Close">×</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">
          {/* Error banner */}
          {errorMsg && (
            <div role="alert" className="mx-4 mt-3 px-3 py-2 rounded text-xs text-status-red bg-status-red/10 border border-status-red/20">
              {errorMsg}
            </div>
          )}

          {/* Existing projects list */}
          <div className="px-4 pt-4 pb-3">
            <div className={`${labelClass} mb-2`}>Existing projects</div>
            {projects.length === 0 ? (
              <div className="text-xs text-ink-faint py-2">(no projects configured)</div>
            ) : (
              <div className="flex flex-col gap-2">
                {projects.map(proj => (
                  <div key={proj.prefix} className="flex items-start gap-2 bg-surface-2 rounded px-3 py-2">
                    <span className="font-mono text-xs text-ink pt-1.5 w-16 flex-shrink-0">{proj.prefix}</span>
                    <InlineNameEditor
                      prefix={proj.prefix}
                      initialName={proj.name}
                      onSaved={() => { /* already invalidates */ }}
                    />
                    <span className="text-[10px] text-ink-faint pt-1.5 truncate max-w-[120px] flex-shrink-0" title={proj.path}>{proj.path}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="mx-4 border-t border-surface-3" />

          {/* Add project form */}
          <div className="px-4 py-4 space-y-3">
            <div className={`${labelClass} mb-2`}>Add project</div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className={labelClass}>Prefix</label>
                <input
                  ref={prefixRef}
                  type="text"
                  value={prefix}
                  maxLength={20}
                  onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                  className={`${fieldClass} font-mono`}
                  placeholder="PROJ"
                  aria-label="Project prefix"
                />
              </div>
              <div className="flex-1">
                <label className={labelClass}>Name (optional)</label>
                <input
                  type="text"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  className={fieldClass}
                  placeholder="My Project"
                  aria-label="Project name"
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Folder</label>
              <FolderBrowser selectedPath={folderPath} onSelect={setFolderPath} />
            </div>

            <div>
              <label className={labelClass}>Storage</label>
              <select
                value={storage}
                onChange={(e) => setStorage(e.target.value as 'global' | 'local')}
                className={fieldClass}
                aria-label="Storage mode"
              >
                <option value="global">Global (~/.mcp-tasks)</option>
                <option value="local">Local (project directory)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface-3 flex-shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs font-medium bg-surface-2 text-ink-2 hover:bg-surface-3 transition-colors">
            Close
          </button>
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              canAdd ? 'bg-accent/20 text-accent hover:bg-accent/30' : 'bg-surface-2 text-ink-faint opacity-50 cursor-not-allowed'
            }`}
          >
            {addMutation.isPending ? 'Adding…' : 'Add project'}
          </button>
        </div>
      </div>
    </div>
  )
}
