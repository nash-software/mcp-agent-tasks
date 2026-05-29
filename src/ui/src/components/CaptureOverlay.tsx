import React, { useState, useEffect, useRef, useCallback } from 'react'
import { quickCapture, fetchConfig } from '../api'

interface Props {
  onClose: () => void
  onCaptured?: () => void
}

export function CaptureOverlay({ onClose, onCaptured }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [projectPrefixes, setProjectPrefixes] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Fetch project prefixes once for #prefix autocomplete
  useEffect(() => {
    fetchConfig()
      .then(cfg => setProjectPrefixes(cfg.projectPrefixes ?? []))
      .catch(() => {})
  }, [])

  // Determine autocomplete matches when text starts with #
  const prefixQuery = text.startsWith('#') ? text.slice(1).split(' ')[0].toUpperCase() : ''
  const suggestions = prefixQuery
    ? projectPrefixes.filter(p => p.startsWith(prefixQuery) && p !== prefixQuery)
    : []

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setError(null)
    try {
      await quickCapture(trimmed)
      setText('')
      onCaptured?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed — try again')
    }
  }, [text, onClose, onCaptured])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleSubmit()
      }
      // Escape is handled at document level via useCaptureOverlay
    },
    [handleSubmit],
  )

  const applySuggestion = useCallback(
    (prefix: string) => {
      setText(`#${prefix} `)
      inputRef.current?.focus()
    },
    [],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={handleBackdropClick}
    >
      {/* Panel */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-slate-400 font-medium tracking-wide uppercase">
            Quick Capture
          </span>
          <span className="text-xs text-slate-500">→ GEN inbox</span>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => { setText(e.target.value); setError(null) }}
          onKeyDown={handleKeyDown}
          placeholder="What's on your mind? (#PREFIX to route directly)"
          className="w-full bg-slate-800 text-slate-100 placeholder-slate-500 border border-slate-600 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          maxLength={2000}
        />

        {/* #prefix autocomplete suggestions */}
        {suggestions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {suggestions.map(p => (
              <button
                key={p}
                onClick={() => applySuggestion(p)}
                className="px-2 py-0.5 text-xs rounded bg-slate-700 text-indigo-300 hover:bg-slate-600 transition-colors"
              >
                #{p}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="mt-2 text-xs text-red-400">{error}</p>
        )}

        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>Enter to capture · Esc or click outside to close</span>
          <span>{text.length}/2000</span>
        </div>
      </div>
    </div>
  )
}

export function CaptureToast(): React.JSX.Element {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 1800)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      className="fixed bottom-6 right-6 z-[60] px-4 py-2 rounded-lg bg-emerald-700 text-emerald-100 text-sm font-medium shadow-lg transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0, pointerEvents: 'none' }}
    >
      Captured ✓
    </div>
  )
}
