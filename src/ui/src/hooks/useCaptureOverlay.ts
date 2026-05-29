import { useState, useEffect, useCallback } from 'react'

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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // Ctrl+Space opens/closes the overlay
      if (e.ctrlKey && e.code === 'Space') {
        const target = e.target as HTMLElement
        // Skip if focus is in an editable element
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return
        }
        e.preventDefault()
        toggle()
      }
      // Escape closes it
      if (e.code === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  return { isOpen, open, close, toggle }
}
