/**
 * ReloadToast.tsx — Non-blocking "New build ready · Reload" banner.
 *
 * Shown when the version poller detects a buildId change.
 * Clicking anywhere on the toast calls window.location.reload().
 * No auto-refresh — the user must click to reload.
 */

import React from 'react'

interface Props {
  visible: boolean
}

export function ReloadToast({ visible }: Props): React.JSX.Element | null {
  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg bg-slate-800 border border-indigo-700 px-4 py-3 shadow-lg"
    >
      <span className="text-sm text-slate-200">
        New build ready
      </span>
      <button
        onClick={() => window.location.reload()}
        className="text-sm font-semibold text-violet-400 hover:text-violet-300 transition-colors"
        aria-label="Reload to apply new build"
      >
        Reload
      </button>
    </div>
  )
}
