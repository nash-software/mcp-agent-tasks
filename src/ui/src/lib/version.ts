/**
 * version.ts — Build version types, pure comparison logic, and API helpers.
 *
 * NO React import — this module is pure and unit-testable in isolation.
 * The React hook lives in src/ui/src/hooks/useBuildVersion.ts.
 *
 * Deliverables:
 *  - VersionResponse / DevUpdateResponse types
 *  - hasBuildChanged(): pure comparison (unit-testable, no side effects)
 *  - fetchVersion(): fetch /api/version
 *  - postDevUpdate(): POST /api/dev/update
 */

// ─── API response shapes ────────────────────────────────────────────────────

export interface VersionResponse {
  buildId: string
  devTray: boolean
}

export interface DevUpdateSuccess {
  ok: true
  buildId: string
}

export interface DevUpdateFailure {
  ok: false
  log: string
}

export type DevUpdateResponse = DevUpdateSuccess | DevUpdateFailure

// ─── Pure comparison (unit-testable) ───────────────────────────────────────

/**
 * Returns true when the latest build differs from the loaded baseline.
 * Both arguments must be non-empty strings.
 */
export function hasBuildChanged(loadedBuildId: string, latestBuildId: string): boolean {
  return loadedBuildId !== latestBuildId
}

// ─── Fetch helpers ──────────────────────────────────────────────────────────

/**
 * Fetch the current build version from the server.
 * Never cached — always reflects the running build.
 */
export async function fetchVersion(): Promise<VersionResponse> {
  const res = await fetch('/api/version', { cache: 'no-store' })
  if (!res.ok) throw new Error(`GET /api/version failed: ${res.status}`)
  return res.json() as Promise<VersionResponse>
}

/**
 * Trigger a dev-tray build+restart cycle.
 * Only available when the server is running under the tray (devTray: true).
 */
export async function postDevUpdate(): Promise<DevUpdateResponse> {
  const res = await fetch('/api/dev/update', { method: 'POST' })
  if (!res.ok) throw new Error(`POST /api/dev/update failed: ${res.status}`)
  return res.json() as Promise<DevUpdateResponse>
}

// ─── Hook state type (shared between version.ts and useBuildVersion.ts) ────

export interface BuildVersionState {
  updateAvailable: boolean
  devTray: boolean
  loadedBuildId: string
  latestBuildId: string
}

export const INITIAL_BUILD_VERSION_STATE: BuildVersionState = {
  updateAvailable: false,
  devTray: false,
  loadedBuildId: '',
  latestBuildId: '',
}

export const POLL_INTERVAL_MS = 5_000
