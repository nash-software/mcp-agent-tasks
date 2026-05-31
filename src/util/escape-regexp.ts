/**
 * Escape a string for safe interpolation into a `new RegExp(...)`. Project prefixes and task IDs are
 * normally `[A-Z0-9-]`, but a misconfigured prefix containing a regex metacharacter would otherwise
 * alter matching behaviour — escape defensively (MCPAT-060 codex F4).
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
