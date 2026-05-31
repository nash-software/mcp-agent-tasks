/**
 * Path-sandbox predicate for the directory-browser endpoint (GET /api/fs/list, MCPAT-063).
 *
 * Pure + platform-aware so it is unit-testable without a server. The HTTP layer resolves the requested
 * path with realpathSync (to defeat symlink escapes) BEFORE calling this — this function then enforces
 * that the resolved target is one of the allowed roots or nested inside one.
 */
import { isAbsolute, resolve, sep } from 'node:path';

/**
 * True iff `target` is one of `roots`, or a descendant of one. Rejects:
 *  - non-absolute targets (`..`, relative) → false
 *  - prefix look-alikes: `/home/user-evil` is NOT inside `/home/user` (boundary-checked with the separator)
 */
export function isPathWithinRoots(target: string, roots: readonly string[]): boolean {
  if (!target || !isAbsolute(target)) return false;
  // NTFS is case-insensitive — fold case on Windows so C:\Code and c:\code match (avoids spurious 403).
  const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const t = fold(resolve(target));
  return roots.some((root) => {
    if (!root || !isAbsolute(root)) return false;
    const r = fold(resolve(root));
    if (t === r) return true;
    return t.startsWith(r.endsWith(sep) ? r : r + sep);
  });
}
