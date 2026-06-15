import type { TaskPriority } from '../types'

/**
 * Priority rank — lower number = higher priority.
 * Used for sorting committed + candidate lists.
 */
export const PRI_RANK: Record<TaskPriority, number> = {
  critical: 0,
  high:     1,
  medium:   2,
  low:      3,
}

/**
 * Format estimate hours into a human-readable string.
 * e.g. 1.5 → "1h 30m", 0.5 → "30m", 2 → "2h"
 */
export function fmtEst(hours: number | null | undefined): string | null {
  if (hours == null) return null
  const m = Math.round(hours * 60)
  if (m < 60) return `${m}m`
  const hh = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${hh}h ${mm}m` : `${hh}h`
}

/**
 * Format hours into "Xh Ym" form (always shows a unit).
 * Used for capacity gauge labels.
 */
export function fmtHM(hours: number): string {
  const m = Math.round(hours * 60)
  const hh = Math.floor(m / 60)
  const mm = m % 60
  if (hh && mm) return `${hh}h ${mm}m`
  if (hh) return `${hh}h`
  return `${mm}m`
}

/**
 * Format elapsed milliseconds as "H:MM:SS" (or "M:SS" under an hour).
 * e.g. 3661000ms → "1:01:01", 65000ms → "1:05"
 */
export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/**
 * Format an ISO-8601 date string as a human-readable relative time.
 * e.g. "just now", "5m ago", "2h ago", "3d ago"
 */
export function fmtAgo(isoDate: string): string {
  const diffMs = Date.now() - Date.parse(isoDate)
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

/**
 * Get the local YYYY-MM-DD date string (matches how server computes "today").
 */
export function localToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}
