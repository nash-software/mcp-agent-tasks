import { useEffect } from 'react'
import { NAV } from '../lib/nav'
import type { ViewId, PanelState } from '../types'
import type { CaptureMode } from './useCaptureOverlay'

interface KeyboardHandlers {
  setView: (v: ViewId) => void
  setPanel: (p: PanelState | null) => void
  setSel: (id: string | null) => void
  setCmdkOpen: (open: boolean) => void
  setFocusMode: (fm: boolean) => void
  moveSelection: (dir: 'up' | 'down') => void
  markDone: () => void
  cyclePriority: () => void
  toggleCommitted: () => void
}

interface KeyboardDeps {
  view: ViewId
  selectedTaskId: string | null
  panel: PanelState | null
  focusMode: boolean
  cmdkOpen: boolean
  visibleIds: string[]
  focusCapture: (mode?: CaptureMode) => void
  handlers: KeyboardHandlers
}

export function useGlobalKeyboard(deps: KeyboardDeps): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // 1. Always-global: Ctrl+Space and Cmd/Ctrl+K fire even while typing
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault()
        deps.focusCapture()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        deps.handlers.setCmdkOpen(!deps.cmdkOpen)
        return
      }
      // 2. Palette-open guard: palette owns its own keys
      if (deps.cmdkOpen) return

      // 3. Typing guard: only Esc passes through
      const el = document.activeElement as HTMLElement | null
      const isTyping = el && (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable
      )
      if (isTyping) {
        if (e.key === 'Escape') el.blur()
        return
      }

      // 4. View + global keys
      if (e.key === '.') {
        deps.handlers.setFocusMode(!deps.focusMode)
        return
      }
      if (e.key === 'Escape') {
        if (deps.panel) deps.handlers.setPanel(null)
        else if (deps.focusMode) deps.handlers.setFocusMode(false)
        return
      }
      const num = parseInt(e.key, 10)
      if (!isNaN(num) && num >= 1 && num <= 7 && !e.metaKey && !e.ctrlKey) {
        const item = NAV[num - 1]
        if (item) {
          deps.handlers.setView(item.id)
          deps.handlers.setPanel(null)
        }
        return
      }

      // 5. Today-only keys
      if (deps.view !== 'today') return
      switch (e.key) {
        case 'j': case 'J': case 'ArrowDown':
          e.preventDefault()
          deps.handlers.moveSelection('down')
          break
        case 'k': case 'K': case 'ArrowUp':
          e.preventDefault()
          deps.handlers.moveSelection('up')
          break
        case ' ':
          e.preventDefault()
          if (deps.selectedTaskId)
            deps.handlers.setPanel({ mode: 'peek', taskId: deps.selectedTaskId })
          break
        case 'Enter':
          e.preventDefault()
          if (deps.selectedTaskId)
            deps.handlers.setPanel({ mode: 'detail', taskId: deps.selectedTaskId })
          break
        case 'd': case 'D': deps.handlers.markDone(); break
        case 'p': case 'P': deps.handlers.cyclePriority(); break
        case 't': case 'T': deps.handlers.toggleCommitted(); break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    deps.view, deps.selectedTaskId, deps.panel, deps.focusMode,
    deps.cmdkOpen, deps.visibleIds, deps.focusCapture, deps.handlers,
  ])
}
