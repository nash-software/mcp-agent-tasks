/**
 * Platform detection helper.
 *
 * Used to show the correct modifier-key hint in UI surfaces (Nav, BrainDumpView, etc.).
 * Falls back to Ctrl for any non-Mac platform (Windows, Linux, Android, etc.).
 */

/** True when running on macOS / iOS (navigator.platform is the most reliable signal available in the browser). */
export const isMac: boolean =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/**
 * The primary modifier key symbol for the current platform:
 *   macOS / iOS → '⌘'
 *   Windows / Linux / other → 'Ctrl'
 */
export const MOD: string = isMac ? '⌘' : 'Ctrl'
