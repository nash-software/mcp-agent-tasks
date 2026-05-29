import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useBrainDump } from '../hooks/useBrainDump'
import { CandidateCard } from '../components/CandidateCard'
import { useAcrStatus } from '../hooks/useAcrStatus'
import type { BrainDumpCandidate } from '../hooks/useBrainDump'

// Abort timeout in milliseconds for the parse request
const PARSE_TIMEOUT_MS = 60_000

// Inline voice capture for brain dump — appends transcript instead of creating a task
function VoiceButton({ onTranscript }: { onTranscript: (text: string) => void }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setState('transcribing')
        try {
          const form = new FormData()
          form.append('file', blob, 'recording.webm')
          const res = await fetch('/api/transcribe', { method: 'POST', body: form })
          if (!res.ok) throw new Error('Transcription failed')
          const data = await res.json() as { text: string }
          onTranscript(data.text)
          setState('idle')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Transcription failed')
          setState('idle')
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setState('recording')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Microphone access denied.')
      } else {
        setError(err instanceof Error ? err.message : 'Could not access microphone')
      }
    }
  }, [onTranscript])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  return (
    <div className="flex flex-col items-end gap-1">
      {state === 'idle' && (
        <button
          onClick={startRecording}
          className="w-8 h-8 rounded-full bg-surface-2 hover:bg-surface-3 border border-surface-3 flex items-center justify-center text-ink-muted hover:text-ink transition-colors"
          title="Record voice (appends to text)"
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </button>
      )}
      {state === 'recording' && (
        <button
          onClick={stopRecording}
          className="w-8 h-8 rounded-full bg-status-red/20 border border-status-red/40 flex items-center justify-center text-status-red transition-colors animate-pulse"
          title="Stop recording"
          type="button"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
        </button>
      )}
      {state === 'transcribing' && (
        <div className="w-8 h-8 rounded-full bg-surface-2 border border-surface-3 flex items-center justify-center">
          <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {error && (
        <span className="text-xs text-status-red text-right max-w-[120px] leading-tight">{error}</span>
      )}
    </div>
  )
}

interface CardState {
  candidate: BrainDumpCandidate
  committed: boolean
  dispatched: boolean
  acrOffline: boolean
}

interface Props {
  projects: string[]
  /** Optional prefill text (P2-03 entry point). Prefills the textarea and focuses it on each new handoff. */
  initialText?: string
  /**
   * Nonce for the current handoff (P2-03). Keying the prefill effect on the nonce (rather than on
   * the text value) means two consecutive handoffs of identical text still re-trigger correctly (AC 5).
   * Must be provided together with initialText; ignored when initialText is undefined/empty.
   */
  seedNonce?: number
  /**
   * Called by BrainDumpView immediately after it has consumed the seed (P2-03 AC 4 — consume-once
   * contract). App clears its brainDumpSeed state in response so revisiting the view does not
   * re-apply stale text.
   */
  onSeedConsumed?: () => void
}

export function BrainDumpView({ projects, initialText, seedNonce, onSeedConsumed }: Props): React.JSX.Element {
  const [dump, setDump] = useState(initialText ?? '')
  const [cards, setCards] = useState<CardState[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [createdCount, setCreatedCount] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const { parseMutation, commitMutation, dispatchMutation } = useBrainDump()
  const { data: acrStatus } = useAcrStatus()
  const acrOffline = acrStatus?.offline ?? false

  // P2-03 entry point: key on seedNonce so identical text handed off twice still re-triggers (AC 5).
  // Calls onSeedConsumed() immediately after applying — consume-once contract (AC 4).
  useEffect(() => {
    if (seedNonce == null || initialText == null || initialText === '') return
    setDump(initialText)
    setCards([])
    setParseError(null)
    setCreatedCount(null)
    // Move caret to end after React flushes the value
    setTimeout(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    }, 0)
    onSeedConsumed?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional nonce key; re-triggers on new nonce only
  }, [seedNonce])

  const handleTranscript = useCallback((text: string) => {
    setDump(prev => prev ? prev + ' ' + text : text)
  }, [])

  const phase: 'input' | 'processing' | 'review' | 'done' = (() => {
    if (parseMutation.isPending) return 'processing'
    if (createdCount !== null && cards.length > 0 && cards.every(c => c.committed || c.dispatched)) return 'done'
    if (createdCount !== null && cards.length === 0) return 'done'
    if (cards.length > 0) return 'review'
    return 'input'
  })()

  const handleSubmit = useCallback(() => {
    if (!dump.trim() || parseMutation.isPending) return
    setParseError(null)
    setCards([])
    setCreatedCount(null)

    // Create a new AbortController for the 60s timeout
    const controller = new AbortController()
    abortRef.current = controller
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, PARSE_TIMEOUT_MS)

    parseMutation.mutate(dump.trim(), {
      onSuccess: (result) => {
        clearTimeout(timeoutId)
        if (result.candidates.length === 0) {
          // parse failure — text preserved by not clearing dump
          setParseError('Couldn\'t parse this — here\'s your text back.')
          return
        }
        setCards(result.candidates.map(c => ({
          candidate: c,
          committed: false,
          dispatched: false,
          acrOffline: false,
        })))
      },
      onError: () => {
        clearTimeout(timeoutId)
        setParseError('Couldn\'t parse this — here\'s your text back.')
      },
    })
  }, [dump, parseMutation])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const handleCommit = useCallback((index: number, candidate: BrainDumpCandidate) => {
    commitMutation.mutate([candidate], {
      onSuccess: (result) => {
        if (result.created.length > 0) {
          setCards(prev => {
            const next = prev.map((c, i) => i === index ? { ...c, committed: true } : c)
            const allDone = next.every(c => c.committed || c.dispatched)
            if (allDone) {
              setCreatedCount(prev.filter(c => c.committed).length + 1)
            }
            return next
          })
        }
      },
    })
  }, [commitMutation])

  const handleDispatch = useCallback((index: number, candidate: BrainDumpCandidate) => {
    dispatchMutation.mutate(
      { title: candidate.title, detail: candidate.why ?? candidate.area },
      {
        onSuccess: (result) => {
          setCards(prev => {
            const next = prev.map((c, i) =>
              i === index
                ? { ...c, dispatched: true, acrOffline: Boolean(result.error) }
                : c,
            )
            const allDone = next.every(c => c.committed || c.dispatched)
            if (allDone) {
              setCreatedCount(prev.filter(c => c.committed).length)
            }
            return next
          })
        },
      },
    )
  }, [dispatchMutation])

  const handleRemove = useCallback((index: number) => {
    setCards(prev => {
      const next = prev.filter((_, i) => i !== index)
      if (next.length === 0) {
        // All removed — treat as done with whatever was committed
        setCreatedCount(prev.filter(c => c.committed).length)
      }
      return next
    })
  }, [])

  const handleCreateAll = useCallback(() => {
    const pending = cards
      .map((c, i) => ({ candidate: c.candidate, index: i }))
      .filter(({ index }) => !cards[index].committed && !cards[index].dispatched)

    if (pending.length === 0) return

    commitMutation.mutate(
      pending.map(p => p.candidate),
      {
        onSuccess: (result) => {
          if (result.created.length > 0) {
            const committedIndexes = new Set(pending.slice(0, result.created.length).map(p => p.index))
            setCards(prev => {
              const next = prev.map((c, i) =>
                committedIndexes.has(i) ? { ...c, committed: true } : c,
              )
              setCreatedCount(next.filter(c => c.committed).length)
              return next
            })
          }
        },
      },
    )
  }, [cards, commitMutation])

  const handleDumpAgain = useCallback(() => {
    setDump('')
    setCards([])
    setParseError(null)
    setCreatedCount(null)
    parseMutation.reset()
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [parseMutation])

  const pendingCount = cards.filter(c => !c.committed && !c.dispatched).length

  const charCount = dump.length
  const lineCount = dump ? dump.split('\n').length : 0
  const estimatedTaskCount = dump.trim()
    ? Math.max(1, dump.split(/\n+/).filter(l => l.trim()).length)
    : 0

  // Done state
  if (phase === 'done') {
    const n = createdCount ?? 0
    return (
      <div className="p-6 max-w-3xl">
        <div className="rounded-card bg-surface-1 border border-surface-3 p-8 flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-status-green/15 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-status-green">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <div className="space-y-1">
            <p className="text-ink font-medium">
              {n} task{n !== 1 ? 's' : ''} created
            </p>
            <p className="text-ink-muted text-sm">They&apos;re in your inbox and ready to commit to today.</p>
          </div>
          <button
            onClick={handleDumpAgain}
            className="mt-2 px-5 py-2 rounded-input bg-surface-2 hover:bg-surface-3 text-ink text-sm font-medium transition-colors border border-surface-3"
            type="button"
          >
            Dump again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* Header */}
      <div className="space-y-0.5">
        <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Brain Dump</h2>
      </div>

      {/* Input + processing area */}
      {(phase === 'input' || phase === 'processing') && (
        <div className="space-y-3">
          {/* Textarea wrapper with mic top-right */}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={dump}
              onChange={(e) => setDump(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={8}
              className="w-full bg-surface-1 border border-surface-3 rounded-card px-4 py-3 pr-14 text-sm text-ink
                placeholder-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30
                resize-y disabled:opacity-60 transition-colors"
              placeholder="Write anything. Tasks, ideas, worries, plans. ⌘+Enter to process."
              disabled={parseMutation.isPending}
            />
            {/* Mic button — top right, absolute inside wrapper */}
            <div className="absolute top-3 right-3">
              <VoiceButton onTranscript={handleTranscript} />
            </div>
            {/* Char/line counter — bottom left */}
            <span className="absolute bottom-3 left-4 text-xs text-ink-faint font-mono tabular-nums pointer-events-none">
              {charCount > 0 ? `${charCount} chars · ${lineCount} line${lineCount !== 1 ? 's' : ''}` : ''}
            </span>
          </div>

          {/* Processing inline message */}
          {parseMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
              <span>Parsing {estimatedTaskCount} task{estimatedTaskCount !== 1 ? 's' : ''} from your dump…</span>
            </div>
          )}

          {/* Parse failure message */}
          {parseError && (
            <div className="rounded-input bg-status-red/10 border border-status-red/30 px-4 py-3 text-sm text-status-red">
              {parseError}
            </div>
          )}

          {/* Process CTA row */}
          <div className="flex items-center justify-end">
            <button
              onClick={handleSubmit}
              disabled={!dump.trim() || parseMutation.isPending}
              className="px-4 py-2 text-sm font-medium rounded-input bg-accent hover:bg-accent-hover text-white
                disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              type="button"
            >
              Process
              <kbd className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded font-sans leading-none">⌘↵</kbd>
            </button>
          </div>
        </div>
      )}

      {/* Candidate review list */}
      {phase === 'review' && (
        <div className="space-y-3">
          {/* Bulk action bar */}
          {pendingCount > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-muted">
                {cards.length} candidate{cards.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={handleCreateAll}
                disabled={commitMutation.isPending}
                className="px-3 py-1.5 text-xs font-medium rounded-input bg-status-green/15 text-status-green
                  hover:bg-status-green/25 border border-status-green/30
                  disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                type="button"
              >
                Create all {pendingCount}
              </button>
            </div>
          )}

          {cards.map((c, i) => (
            <CandidateCard
              key={i}
              candidate={c.candidate}
              projects={projects.length > 0 ? projects : ['GEN']}
              onCommit={(updated) => handleCommit(i, updated)}
              onDispatch={(updated) => handleDispatch(i, updated)}
              onRemove={() => handleRemove(i)}
              committed={c.committed}
              dispatched={c.dispatched}
              acrOffline={c.dispatched ? c.acrOffline : acrOffline}
              autoFocus={i === 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}
