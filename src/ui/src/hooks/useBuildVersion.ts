/**
 * useBuildVersion.ts — React hook that polls /api/version every 5s while the tab is visible.
 *
 * - On first load, fetches once to establish the loaded baseline buildId.
 * - Pauses the interval when document.visibilityState !== 'visible'.
 * - Immediately polls on tab re-focus (visibilitychange → visible).
 * - Exposes { updateAvailable, devTray, loadedBuildId, latestBuildId }.
 * - Network errors during polling are silently swallowed (server may be restarting).
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  fetchVersion,
  hasBuildChanged,
  type BuildVersionState,
  INITIAL_BUILD_VERSION_STATE,
  POLL_INTERVAL_MS,
} from '../lib/version'

export function useBuildVersion(): BuildVersionState {
  const [state, setState] = useState<BuildVersionState>(INITIAL_BUILD_VERSION_STATE)

  // Stable ref for the loaded baseline so it isn't included in effect deps.
  const loadedBuildIdRef = useRef<string>('')
  const initialised = useRef(false)

  const poll = useCallback(async (): Promise<void> => {
    if (document.visibilityState !== 'visible') return
    try {
      const { buildId, devTray } = await fetchVersion()
      if (!initialised.current) {
        // First fetch — capture loaded baseline (never changes for this page load)
        loadedBuildIdRef.current = buildId
        initialised.current = true
        setState({
          updateAvailable: false,
          devTray,
          loadedBuildId: buildId,
          latestBuildId: buildId,
        })
      } else {
        const loadedBuildId = loadedBuildIdRef.current
        setState(prev => ({
          ...prev,
          devTray,
          latestBuildId: buildId,
          updateAvailable: hasBuildChanged(loadedBuildId, buildId),
        }))
      }
    } catch {
      // Network errors (server restarting after update) are silently ignored —
      // the next poll interval will retry.
    }
  }, [])

  useEffect(() => {
    // Fire immediately on mount.
    void poll()

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void poll()
      }
    }, POLL_INTERVAL_MS)

    function handleVisibilityChange(): void {
      if (document.visibilityState === 'visible') {
        // Immediately poll on tab re-focus so we don't wait up to 5s.
        void poll()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return (): void => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [poll])

  return state
}
