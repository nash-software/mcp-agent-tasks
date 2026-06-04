import { useCallback, useRef } from 'react'

export type CaptureMode = 'infer' | 'task' | 'note'

export interface CaptureOverlayState {
  registerFocus: (fn: (mode?: CaptureMode) => void) => void
  focusCapture: (mode?: CaptureMode) => void
}

export function useCaptureOverlay(): CaptureOverlayState {
  const focusFnRef = useRef<((mode?: CaptureMode) => void) | null>(null)

  const registerFocus = useCallback((fn: (mode?: CaptureMode) => void): void => {
    focusFnRef.current = fn
  }, [])

  const focusCapture = useCallback((mode?: CaptureMode): void => {
    focusFnRef.current?.(mode)
  }, [])

  return { registerFocus, focusCapture }
}
