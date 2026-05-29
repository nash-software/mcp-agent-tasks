import { useCallback, useRef } from 'react'

export interface CaptureOverlayState {
  registerFocus: (fn: () => void) => void
  focus: () => void
}

export function useCaptureOverlay(): CaptureOverlayState {
  const focusFnRef = useRef<(() => void) | null>(null)

  const registerFocus = useCallback((fn: () => void): void => {
    focusFnRef.current = fn
  }, [])

  const focus = useCallback((): void => {
    focusFnRef.current?.()
  }, [])

  return { registerFocus, focus }
}
