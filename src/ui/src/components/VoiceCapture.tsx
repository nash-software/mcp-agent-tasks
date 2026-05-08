import React, { useState, useRef, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { transcribeAudio, createDraftTask } from '../api'

type RecordingState = 'idle' | 'recording' | 'transcribing'

interface Props {
  project: string
}

export function VoiceCapture({ project }: Props): React.JSX.Element {
  const [state, setState] = useState<RecordingState>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const queryClient = useQueryClient()

  const createTask = useMutation({
    mutationFn: createDraftTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      setTranscript('')
    },
  })

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
          const text = await transcribeAudio(blob, 'recording.webm')
          setTranscript(text)
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
        setError('Microphone access denied. Please allow mic access and try again.')
      } else {
        setError(err instanceof Error ? err.message : 'Could not access microphone')
      }
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const handleSubmit = useCallback(() => {
    if (!transcript.trim()) return
    createTask.mutate({ title: transcript.trim(), project })
  }, [transcript, project, createTask])

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-3">
        {state === 'idle' && (
          <button
            onClick={startRecording}
            className="w-10 h-10 rounded-full bg-violet-600 hover:bg-violet-500 flex items-center justify-center text-white text-lg transition-colors"
            title="Record voice note"
          >
            🎙
          </button>
        )}
        {state === 'recording' && (
          <button
            onClick={stopRecording}
            className="w-10 h-10 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center text-white text-sm transition-colors animate-pulse"
            title="Stop recording"
          >
            ⏹
          </button>
        )}
        {state === 'transcribing' && (
          <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <span className="text-sm text-slate-400">
          {state === 'idle' && 'Tap to capture a task by voice'}
          {state === 'recording' && 'Recording... tap to stop'}
          {state === 'transcribing' && 'Transcribing...'}
        </span>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {transcript && (
        <div className="space-y-2">
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 resize-none focus:outline-none focus:border-violet-500"
            rows={2}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setTranscript('')}
              className="px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
            >
              Discard
            </button>
            <button
              onClick={handleSubmit}
              disabled={createTask.isPending || !transcript.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded bg-emerald-800 text-emerald-200 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {createTask.isPending ? 'Creating...' : 'Create Draft Task'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
