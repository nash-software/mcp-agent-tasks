/**
 * CommandPalette — Raycast-style Cmd+K overlay.
 *
 * Controlled component: open/close state lives in App.tsx (P1-02).
 * App builds the command list via buildCommands() and passes it as `commands`.
 *
 * Motion: transform spring-in only (translateY + scale) — NEVER opacity-to-hidden.
 * Spec: P1-10 — epic §3 anti-pattern §9.
 */
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import { fuzzy, highlight } from '../lib/fuzzy'

// ─── Command model ────────────────────────────────────────────────────────────

export interface PaletteCommand {
  id: string
  /** Category label — used for grouping (first-seen order). */
  cat: string
  label: string
  /** Sub-label (e.g. task ID or project name). */
  sub?: string
  /** Lucide icon element, pre-rendered by caller. */
  icon?: React.ReactNode
  /** Keyboard hint (e.g. "⌘K"). */
  kbd?: string
  /** True while open but not yet wired (Phase-2 stubs). */
  disabled?: boolean
  /** Tooltip for disabled items. */
  disabledHint?: string
  run: () => void
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface RankedCommand extends PaletteCommand {
  _score: number
  _ranges: number[]
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  commands: PaletteCommand[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupByCategory(items: RankedCommand[]): { cat: string; items: RankedCommand[] }[] {
  const seen = new Map<string, RankedCommand[]>()
  for (const item of items) {
    const bucket = seen.get(item.cat)
    if (bucket) {
      bucket.push(item)
    } else {
      seen.set(item.cat, [item])
    }
  }
  return Array.from(seen.entries()).map(([cat, items]) => ({ cat, items }))
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [selIdx, setSelIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-focus and reset query on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelIdx(0)
      // nextTick so the element is mounted
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Fuzzy-filter + rank commands
  const filtered = useMemo((): RankedCommand[] => {
    const q = query.trim()
    if (!q) {
      // No query — show all in category order, score 0
      return commands.map(cmd => ({ ...cmd, _score: 0, _ranges: [] }))
    }
    const ranked: RankedCommand[] = []
    for (const cmd of commands) {
      const searchTarget = cmd.label + (cmd.sub ? ' ' + cmd.sub : '')
      const m = fuzzy(q, searchTarget)
      if (m) {
        ranked.push({ ...cmd, _score: m.score, _ranges: m.ranges })
      }
    }
    // Sort by descending score
    ranked.sort((a, b) => b._score - a._score)
    return ranked
  }, [query, commands])

  const groups = useMemo(() => groupByCategory(filtered), [filtered])

  // Flat list for keyboard nav
  const flatItems = useMemo(() => filtered, [filtered])

  // Clamp selection when list changes
  useEffect(() => {
    setSelIdx(prev => Math.min(prev, Math.max(0, flatItems.length - 1)))
  }, [flatItems.length])

  // Reset selection to 0 on query change
  useEffect(() => {
    setSelIdx(0)
  }, [query])

  // Scroll selected row into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${selIdx}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selIdx])

  // Palette-owned keyboard handler (capture phase, fires before global listener)
  useEffect(() => {
    if (!open) return

    function onKeyDown(e: KeyboardEvent): void {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelIdx(prev => Math.min(prev + 1, flatItems.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelIdx(prev => Math.max(prev - 1, 0))
          break
        case 'Enter': {
          e.preventDefault()
          const cmd = flatItems[selIdx]
          if (cmd && !cmd.disabled) {
            cmd.run()
            onClose()
          }
          break
        }
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    window.addEventListener('keydown', onKeyDown, true) // capture phase
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, flatItems, selIdx, onClose])

  const handleItemClick = useCallback((cmd: RankedCommand) => {
    if (cmd.disabled) return
    cmd.run()
    onClose()
  }, [onClose])

  const handleItemHover = useCallback((idx: number) => {
    setSelIdx(idx)
  }, [])

  if (!open) return null

  // Compute a running index across all groups for keyboard selection
  let rowIdx = 0

  return (
    <div
      className="cmdk-overlay fixed inset-0 z-50"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onMouseDown={(e) => {
        // Close on scrim click (not on card click)
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="cmdk bg-surface-1 border border-surface-3 rounded-drawer shadow-xl"
        style={{
          position: 'absolute',
          top: '14vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: '600px',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          animation: 'cmdkSpringIn 180ms cubic-bezier(0.16,1,0.3,1) both',
        }}
        onMouseDown={(e) => e.stopPropagation()} // Don't close when clicking inside
      >
        {/* Search input */}
        <div className="px-4 py-3 border-b border-surface-3 flex items-center gap-3 flex-shrink-0">
          <svg
            width="16" height="16" viewBox="0 0 16 16" fill="none"
            className="text-ink-muted flex-shrink-0"
          >
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-ink text-sm outline-none placeholder:text-ink-muted"
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="text-ink-faint text-xs font-mono bg-surface-2 px-1.5 py-0.5 rounded border border-surface-3">
            esc
          </kbd>
        </div>

        {/* Command list */}
        <div
          ref={listRef}
          className="overflow-y-auto flex-1 py-1"
        >
          {filtered.length === 0 && query.trim() !== '' ? (
            <div className="px-4 py-8 text-center text-ink-muted text-sm">
              No commands match &ldquo;{query}&rdquo;
            </div>
          ) : (
            groups.map(({ cat, items }) => {
              const groupStart = rowIdx
              rowIdx += items.length
              return (
                <div key={cat}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
                    {cat}
                  </div>
                  {items.map((cmd, i) => {
                    const absoluteIdx = groupStart + i
                    const isSel = absoluteIdx === selIdx
                    const q = query.trim()
                    const labelNode = q
                      ? highlight(cmd.label, cmd._ranges.filter(r => r < cmd.label.length))
                      : cmd.label

                    return (
                      <button
                        key={cmd.id}
                        data-idx={absoluteIdx}
                        className={[
                          'cmdk-row w-full flex items-center gap-3 px-3 py-2 text-left transition-colors duration-75',
                          isSel ? 'bg-surface-2' : 'hover:bg-surface-2',
                          cmd.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                        ].join(' ')}
                        onMouseEnter={() => handleItemHover(absoluteIdx)}
                        onClick={() => handleItemClick(cmd)}
                        disabled={cmd.disabled}
                        title={cmd.disabled ? (cmd.disabledHint ?? '') : undefined}
                        type="button"
                      >
                        {cmd.icon && (
                          <span className="text-ink-muted flex-shrink-0 w-4 h-4 flex items-center justify-center">
                            {cmd.icon}
                          </span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="text-sm text-ink [&_mark]:text-accent [&_mark]:font-semibold [&_mark]:bg-transparent">
                            {labelNode}
                          </span>
                          {cmd.sub && (
                            <span className="ml-2 text-xs text-ink-muted font-mono">{cmd.sub}</span>
                          )}
                        </span>
                        {cmd.kbd && (
                          <kbd className="text-ink-faint text-xs font-mono bg-surface-2 px-1.5 py-0.5 rounded border border-surface-3 flex-shrink-0">
                            {cmd.kbd}
                          </kbd>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="cmdk-foot px-4 py-2 border-t border-surface-3 flex items-center gap-4 text-ink-faint text-[11px] flex-shrink-0">
          <span><kbd className="font-mono">↑ ↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> run</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>

      {/* Spring-in keyframe */}
      <style>{`
        @keyframes cmdkSpringIn {
          from { transform: translateX(-50%) translateY(-8px) scale(0.98); }
          to   { transform: translateX(-50%) translateY(0)    scale(1);    }
        }
      `}</style>
    </div>
  )
}
