import { useState, useCallback } from 'react'

export interface CaptureOverlayState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export function useCaptureOverlay(): CaptureOverlayState {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen(v => !v), [])

  // Keyboard handler moved to useGlobalKeyboard (P1-02)

  return { isOpen, open, close, toggle }
}
