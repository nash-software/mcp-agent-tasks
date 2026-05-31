import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Plus, Expand, Mic, MicOff, Check, Loader2 } from 'lucide-react'
import { quickCapture, fetchProjects } from '../api'
import { useVoiceTranscribe } from '../hooks/useVoiceTranscribe'

interface Props {
  /** Called with the current text when Shift+Enter or expand icon is clicked (P2-03 affordance). */
  onExpand: (text: string) => void
  /** Called by App to register the focus function so Ctrl+Space can target this input. */
  registerFocus: (fn: () => void) => void
  /** Active project (single selected filter) — threaded to quickCapture as a routing bias (P5-06). */
  activeProject?: string
}

export function CaptureOverlay({ onExpand, registerFocus, activeProject }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [retryHint, setRetryHint] = useState(false)
  const [flash, setFlash] = useState(false)
  const [acSelIdx, setAcSelIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  // Register focus callback with parent (App -> useGlobalKeyboard)
  useEffect(() => {
    registerFocus(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [registerFocus])

  // Fetch project list for #prefix autocomplete
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 5 * 60 * 1000,
  })

  // Autocomplete: match #token at the end of the input value
  const acMatches = useMemo(() => {
    const m = text.match(/#(\w*)$/)
    if (!m) return null
    const q = m[1].toLowerCase()
    return projects.filter(p => p.prefix.toLowerCase().includes(q))
  }, [text, projects])

  // Reset autocomplete selection when matches change
  useEffect(() => {
    setAcSelIdx(0)
  }, [acMatches?.length])

  // TanStack mutation for quick capture
  const captureMutation = useMutation({
    // Thread the active project prefix as a routing-bias context (P5-06); #PREFIX still wins server-side.
    mutationFn: (t: string) => quickCapture(t, activeProject),
    onSuccess: () => {
      setText('')
      setRetryHint(false)
      setFlash(true)
      setTimeout(() => setFlash(false), 600)
      void queryClient.invalidateQueries({ queryKey: ['today'] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: () => {
      setRetryHint(true)
    },
  })

  const handleSubmit = useCallback((): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    setRetryHint(false)
    captureMutation.mutate(trimmed)
  }, [text, captureMutation])

  const pickProject = useCallback((prefix: string): void => {
    setText(prev => prev.replace(/#\w*$/, `#${prefix} `))
    inputRef.current?.focus()
  }, [])

  const handleExpand = useCallback((): void => {
    onExpand(text)
    setText('')
  }, [text, onExpand])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      // Shift+Enter -> Brain Dump handoff (P2-03 affordance)
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        handleExpand()
        return
      }

      // Autocomplete navigation
      if (acMatches && acMatches.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setAcSelIdx(s => Math.min(s + 1, acMatches.length - 1))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setAcSelIdx(s => Math.max(s - 1, 0))
          return
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && text.match(/#\w*$/))) {
          e.preventDefault()
          const selected = acMatches[acSelIdx]
          if (selected) pickProject(selected.prefix)
          return
        }
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      }
    },
    [acMatches, acSelIdx, text, handleExpand, handleSubmit, pickProject],
  )

  // Voice transcribe - append result to the input
  const handleTranscript = useCallback((transcript: string): void => {
    setText(prev => prev ? `${prev} ${transcript}` : transcript)
    inputRef.current?.focus()
  }, [])

  const voice = useVoiceTranscribe(handleTranscript)

  const handleMicClick = useCallback((): void => {
    if (voice.state === 'idle') {
      void voice.startRecording()
    } else if (voice.state === 'recording') {
      voice.stopRecording()
    }
  }, [voice])

  return (
    <header className="capture-bar">
      {/* Brand block - aligns with left nav width */}
      <div className="capture-brand">
        <div className="logo" aria-hidden="true" />
        <span className="name">
          Life<span>OS</span>
        </span>
      </div>

      {/* Input row */}
      <div className="capture-input-wrap">
        <span className="lead" aria-hidden="true">
          <Plus size={15} />
        </span>

        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={e => {
            setText(e.target.value)
            setRetryHint(false)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Capture anything — Enter to save · ⇧Enter for Brain Dump · #project"
          className="capture-input"
          maxLength={2000}
          aria-label="Quick capture"
          autoComplete="off"
        />

        {flash && (
          <span className="capture-flash" aria-live="polite">
            <Check size={14} />
            Captured
          </span>
        )}

        {retryHint && !flash && (
          <span className="capture-error" aria-live="polite">
            couldn't save — Enter to retry
          </span>
        )}

        {voice.error && !flash && !retryHint && (
          <span className="capture-error" aria-live="polite">
            {voice.error}
          </span>
        )}

        {!flash && !retryHint && !voice.error && (
          <span className="capture-hint">
            <kbd>Ctrl</kbd>
            <kbd>Space</kbd>
          </span>
        )}

        <button
          className="expand-btn"
          onClick={handleExpand}
          title="Open in Brain Dump (⇧Enter)"
          aria-label="Open in Brain Dump"
          type="button"
        >
          <Expand size={15} />
        </button>

        <button
          className={`mic-btn${voice.state === 'recording' ? ' recording' : ''}`}
          onClick={handleMicClick}
          title="Voice capture"
          aria-label={voice.state === 'recording' ? 'Stop recording' : 'Voice capture'}
          type="button"
          disabled={voice.state === 'transcribing'}
        >
          {voice.state === 'transcribing' ? (
            <Loader2 size={15} className="animate-spin" />
          ) : voice.state === 'recording' ? (
            <MicOff size={15} />
          ) : (
            <Mic size={15} />
          )}
        </button>

        {acMatches && acMatches.length > 0 && (
          <div className="capture-ac" role="listbox">
            {acMatches.map((p, i) => (
              <div
                key={p.prefix}
                className={`ac-row${i === acSelIdx ? ' sel' : ''}`}
                role="option"
                aria-selected={i === acSelIdx}
                onMouseEnter={() => setAcSelIdx(i)}
                onClick={() => pickProject(p.prefix)}
              >
                <span className="ac-prefix">#{p.prefix}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  )
}
