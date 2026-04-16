import path from 'node:path';

/**
 * Normalize a path that may be a Git Bash-style Unix path on Windows
 * (e.g. /c/code/conductor → C:\code\conductor).
 * On non-Windows or already-Windows paths, returns path.resolve(p) directly.
 */
export function resolvePath(p: string): string {
  if (process.platform === 'win32') {
    // /X/rest → X:\rest
    const match = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
    if (match) {
      const drive = match[1].toUpperCase();
      const rest = (match[2] ?? '/').replace(/\//g, '\\');
      return path.resolve(`${drive}:${rest}`);
    }
  }
  return path.resolve(p);
}
