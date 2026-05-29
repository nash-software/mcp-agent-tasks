import { useState, useRef, useCallback } from 'react'
import { transcribeAudio } from '../api'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

export interface UseVoiceTranscribeResult {
  state: VoiceState
  error: string | null
  startRecording: () => Promise<void>
  stopRecording: () => void
}

/**
 * Reusable hook encapsulating the MediaRecorder -> transcribeAudio state machine.
 * Extracted from VoiceCapture.tsx for use in CaptureOverlay.
 *
 * @param onTranscript - called with the final transcript text on success
 */
export function useVoiceTranscribe(
  onTranscript: (text: string) => void,
): UseVoiceTranscribeResult {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async (): Promise<void> => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setState('transcribing')
        try {
          const text = await transcribeAudio(blob, 'recording.webm')
          setState('idle')
          onTranscript(text)
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
  }, [onTranscript])

  const stopRecording = useCallback((): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  return { state, error, startRecording, stopRecording }
}
