/**
 * UpdateButton.tsx — Dev-tray build trigger button.
 *
 * Renders ONLY when devTray === true (from /api/version).
 * Click → POST /api/dev/update; shows "Building…" spinner.
 * On failure, shows returned log in a dismissible panel.
 * On success: nothing — the version poller detects the new buildId and surfaces ReloadToast.
 */

import React, { useState } from 'react'
import { postDevUpdate, type DevUpdateResponse } from '../lib/version'

interface Props {
  /** When false (or undefined), this component renders nothing. */
  devTray: boolean
}

type UpdateState =
  | { phase: 'idle' }
  | { phase: 'building' }
  | { phase: 'failed'; log: string }

export function UpdateButton({ devTray }: Props): React.JSX.Element | null {
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle' })

  if (!devTray) return null

  async function handleUpdate(): Promise<void> {
    setUpdateState({ phase: 'building' })
    try {
      const result: DevUpdateResponse = await postDevUpdate()
      if (result.ok) {
        // Server restarts; poller will detect new buildId and surface the Reload toast.
        setUpdateState({ phase: 'idle' })
      } else {
        setUpdateState({ phase: 'failed', log: result.log })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setUpdateState({ phase: 'failed', log: message })
    }
  }

  function dismissFailure(): void {
    setUpdateState({ phase: 'idle' })
  }

  return (
    <>
      <button
        onClick={() => void handleUpdate()}
        disabled={updateState.phase === 'building'}
        aria-label={updateState.phase === 'building' ? 'Building…' : 'Trigger dev build and update'}
        className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium bg-indigo-900 text-violet-300 hover:bg-indigo-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {updateState.phase === 'building' ? (
          <>
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-violet-400 border-t-transparent"
              aria-hidden="true"
            />
            Building…
          </>
        ) : (
          'Update'
        )}
      </button>
      {updateState.phase === 'failed' && (
        <div
          role="alert"
          className="fixed top-14 right-4 z-40 max-w-sm rounded-lg bg-red-950 border border-red-800 px-4 py-3 shadow-lg"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-red-300 mb-1">Build failed</p>
              <pre className="text-xs text-red-400 whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto">
                {updateState.log}
              </pre>
            </div>
            <button
              onClick={dismissFailure}
              aria-label="Dismiss build failure"
              className="mt-0.5 text-red-500 hover:text-red-300 text-sm font-medium transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  )
}
