import React, { useState, useRef, useCallback } from 'react'
import { useBrainDump } from '../hooks/useBrainDump'
import { CandidateCard } from '../components/CandidateCard'
import type { BrainDumpCandidate } from '../hooks/useBrainDump'

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
    <div className="flex items-center gap-2">
      {state === 'idle' && (
        <button
          onClick={startRecording}
          className="w-8 h-8 rounded-full bg-violet-700 hover:bg-violet-600 flex items-center justify-center text-white text-sm transition-colors"
          title="Record voice (appends to text)"
          type="button"
        >
          🎙
        </button>
      )}
      {state === 'recording' && (
        <button
          onClick={stopRecording}
          className="w-8 h-8 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-white text-xs transition-colors animate-pulse"
          title="Stop recording"
          type="button"
        >
          ⏹
        </button>
      )}
      {state === 'transcribing' && (
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <span className="text-xs text-slate-500">
        {state === 'idle' && 'Voice'}
        {state === 'recording' && 'Recording…'}
        {state === 'transcribing' && 'Transcribing…'}
      </span>
      {error && <span className="text-xs text-red-400">{error}</span>}
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
}

export function BrainDumpView({ projects }: Props): React.JSX.Element {
  const [dump, setDump] = useState('')
  const [cards, setCards] = useState<CardState[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [createdCount, setCreatedCount] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { parseMutation, commitMutation, dispatchMutation } = useBrainDump()

  const handleTranscript = useCallback((text: string) => {
    setDump(prev => prev ? prev + ' ' + text : text)
  }, [])

  const handleSubmit = useCallback(() => {
    if (!dump.trim() || parseMutation.isPending) return
    setParseError(null)
    setCards([])
    setCreatedCount(null)
    parseMutation.mutate(dump.trim(), {
      onSuccess: (result) => {
        if (result.error && result.candidates.length === 0) {
          setParseError(result.error)
          return
        }
        setCards(result.candidates.map(c => ({
          candidate: c,
          committed: false,
          dispatched: false,
          acrOffline: false,
        })))
      },
      onError: (err) => {
        setParseError(err instanceof Error ? err.message : 'Request failed')
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
          setCards(prev => prev.map((c, i) => i === index ? { ...c, committed: true } : c))
        }
      },
    })
  }, [commitMutation])

  const handleDispatch = useCallback((index: number, candidate: BrainDumpCandidate) => {
    dispatchMutation.mutate(
      { title: candidate.title, detail: candidate.why ?? candidate.area },
      {
        onSuccess: (result) => {
          setCards(prev => prev.map((c, i) =>
            i === index
              ? { ...c, dispatched: true, acrOffline: Boolean(result.error) }
              : c,
          ))
        },
      },
    )
  }, [dispatchMutation])

  const handleRemove = useCallback((index: number) => {
    setCards(prev => prev.filter((_, i) => i !== index))
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
            setCards(prev => prev.map((c, i) =>
              committedIndexes.has(i) ? { ...c, committed: true } : c,
            ))
            setCreatedCount(result.created.length)
          }
        },
      },
    )
  }, [cards, commitMutation])

  const pendingCount = cards.filter(c => !c.committed && !c.dispatched).length

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">Brain Dump</h2>
        <p className="text-xs text-slate-500">
          Dump your thoughts — tasks, ideas, anything. Press Ctrl+Enter to parse.
        </p>
      </div>

      <div className="space-y-2">
        <textarea
          ref={textareaRef}
          value={dump}
          onChange={(e) => setDump(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={5}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-slate-200
            placeholder-slate-500 focus:outline-none focus:border-violet-500 resize-y"
          placeholder="Brain dump here — tasks, ideas, anything. Press Cmd/Ctrl+Enter to process."
          disabled={parseMutation.isPending}
        />

        <div className="flex items-center justify-between gap-3">
          <VoiceButton onTranscript={handleTranscript} />
          <button
            onClick={handleSubmit}
            disabled={!dump.trim() || parseMutation.isPending}
            className="px-4 py-1.5 text-sm font-medium rounded bg-violet-700 text-white hover:bg-violet-600
              disabled:opacity-50 transition-colors flex items-center gap-2"
            type="button"
          >
            {parseMutation.isPending && (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {parseMutation.isPending ? 'Parsing your dump…' : 'Parse'}
          </button>
        </div>
      </div>

      {/* Error state */}
      {parseError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
          {parseError}
        </div>
      )}

      {/* Created confirmation */}
      {createdCount !== null && createdCount > 0 && cards.every(c => c.committed || c.dispatched) && (
        <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg px-4 py-3 text-sm text-emerald-300">
          {createdCount} task{createdCount !== 1 ? 's' : ''} created.
        </div>
      )}

      {/* Candidates */}
      {cards.length > 0 && (
        <div className="space-y-3">
          {pendingCount > 1 && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400">{cards.length} candidate{cards.length !== 1 ? 's' : ''}</span>
              <button
                onClick={handleCreateAll}
                disabled={commitMutation.isPending}
                className="px-3 py-1 text-xs font-medium rounded bg-emerald-800 text-emerald-200
                  hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                type="button"
              >
                Create all tasks
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
              acrOffline={c.acrOffline}
            />
          ))}
        </div>
      )}
    </div>
  )
}
