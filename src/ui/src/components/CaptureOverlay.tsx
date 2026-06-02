import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Plus, Expand, Mic, MicOff, Check, Loader2, StickyNote, ListTodo, Sparkles } from 'lucide-react'
import { quickCapture, inferCapture, captureNote, fetchProjects } from '../api'
import type { InferResult } from '../api'
import { useVoiceTranscribe } from '../hooks/useVoiceTranscribe'

type CaptureMode = 'infer' | 'task' | 'note'
const CONFIDENCE_THRESHOLD = 0.7

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
  const [noteFlash, setNoteFlash] = useState(false)
  const [acSelIdx, setAcSelIdx] = useState(0)
  const [mode, setMode] = useState<CaptureMode>('infer')
  const [nudge, setNudge] = useState<InferResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  // Ctrl+Shift+N = force Note mode, Ctrl+Shift+T = force Task mode
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const isMac = /mac/i.test(navigator.userAgent)
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && e.shiftKey && e.key === 'N') {
        e.preventDefault()
        setMode('note')
        setNudge(null)
        inputRef.current?.focus()
      } else if (mod && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        setMode('task')
        setNudge(null)
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

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

  // TanStack mutation for quick capture (task mode)
  const captureMutation = useMutation({
    // Thread the active project prefix as a routing-bias context (P5-06); #PREFIX still wins server-side.
    mutationFn: (t: string) => quickCapture(t, activeProject),
    onSuccess: () => {
      setText('')
      setRetryHint(false)
      setNudge(null)
      setFlash(true)
      setTimeout(() => setFlash(false), 600)
      void queryClient.invalidateQueries({ queryKey: ['today'] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: () => {
      setRetryHint(true)
    },
  })

  // Mutation for note capture
  const noteMutation = useMutation({
    mutationFn: (t: string) => captureNote(t, activeProject),
    onSuccess: () => {
      setText('')
      setRetryHint(false)
      setNudge(null)
      setNoteFlash(true)
      setTimeout(() => setNoteFlash(false), 1500)
      void queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
    onError: () => {
      setRetryHint(true)
    },
  })

  const executeCapture = useCallback((asMode: 'task' | 'note', trimmed: string): void => {
    if (asMode === 'note') {
      noteMutation.mutate(trimmed)
    } else {
      captureMutation.mutate(trimmed)
    }
  }, [captureMutation, noteMutation])

  const handleSubmit = useCallback((): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    setRetryHint(false)

    if (mode === 'task') {
      executeCapture('task', trimmed)
      return
    }
    if (mode === 'note') {
      executeCapture('note', trimmed)
      return
    }

    // Infer mode: call classification endpoint
    void (async () => {
      try {
        const result = await inferCapture(trimmed, activeProject)
        if (result.confidence >= CONFIDENCE_THRESHOLD) {
          setNudge(null)
          executeCapture(result.intent, trimmed)
        } else {
          setNudge(result)
        }
      } catch {
        // Fallback: route as task
        executeCapture('task', trimmed)
      }
    })()
  }, [text, mode, activeProject, executeCapture])

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

  const isBusy = captureMutation.isPending || noteMutation.isPending

  return (
    <header className="capture-bar">
      {/* Brand block - aligns with left nav width */}
      <div className="capture-brand">
        <div className="logo" aria-hidden="true" />
        <span className="name">
          Life<span>OS</span>
        </span>
      </div>

      {/* Mode selector pill */}
      <div className="capture-mode-pills" role="group" aria-label="Capture mode">
        {(['infer', 'task', 'note'] as const).map(m => (
          <button
            key={m}
            type="button"
            className={`mode-pill${mode === m ? ' active' : ''}`}
            onClick={() => { setMode(m); setNudge(null); inputRef.current?.focus() }}
            aria-pressed={mode === m}
          >
            {m === 'infer' && <Sparkles size={11} />}
            {m === 'task' && <ListTodo size={11} />}
            {m === 'note' && <StickyNote size={11} />}
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
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
            setNudge(null)
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === 'note'
              ? 'Capture a thought or idea — Enter to save as Note'
              : mode === 'task'
              ? 'Capture a task — Enter to save · #project'
              : 'Capture anything — Enter to save · ⇧Enter for Brain Dump · #project'
          }
          className="capture-input"
          maxLength={mode === 'note' ? 10000 : 2000}
          aria-label="Quick capture"
          autoComplete="off"
        />

        {nudge && !isBusy && (
          <div className="capture-nudge" aria-live="polite">
            <span>Looks like a <strong>{nudge.intent}</strong> — keep or switch?</span>
            <button
              type="button"
              className="nudge-btn primary"
              onClick={() => { const t = text.trim(); setNudge(null); executeCapture(nudge.intent, t) }}
            >
              Save as {nudge.intent}
            </button>
            <button
              type="button"
              className="nudge-btn"
              onClick={() => {
                const t = text.trim()
                const flip = nudge.intent === 'task' ? 'note' : 'task'
                setNudge(null)
                executeCapture(flip, t)
              }}
            >
              Save as {nudge.intent === 'task' ? 'note' : 'task'}
            </button>
          </div>
        )}

        {flash && (
          <span className="capture-flash" aria-live="polite">
            <Check size={14} />
            Captured
          </span>
        )}

        {noteFlash && !flash && (
          <span className="capture-flash note-flash" aria-live="polite">
            <Check size={14} />
            Note saved
          </span>
        )}

        {retryHint && !flash && !noteFlash && (
          <span className="capture-error" aria-live="polite">
            couldn't save — Enter to retry
          </span>
        )}

        {voice.error && !flash && !noteFlash && !retryHint && (
          <span className="capture-error" aria-live="polite">
            {voice.error}
          </span>
        )}

        {!flash && !noteFlash && !retryHint && !voice.error && !nudge && (
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
