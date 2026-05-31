/**
 * MCPAT-063 — path-sandbox predicate for GET /api/fs/list. Cross-platform via path.resolve, so we build
 * roots with path.resolve too (these become C:\... on Windows, /... on POSIX).
 */
import { describe, it, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { isPathWithinRoots } from '../../src/fs-sandbox.js';

const root = resolve('/srv/code');
const home = resolve('/home/user');
const roots = [root, home];

describe('isPathWithinRoots', () => {
  it('accepts a root itself', () => {
    expect(isPathWithinRoots(root, roots)).toBe(true);
  });

  it('accepts a descendant of a root', () => {
    expect(isPathWithinRoots(join(root, 'my-project'), roots)).toBe(true);
    expect(isPathWithinRoots(join(home, '.mcp-tasks', 'tasks'), roots)).toBe(true);
  });

  it('rejects a path outside all roots', () => {
    expect(isPathWithinRoots(resolve('/etc'), roots)).toBe(false);
    expect(isPathWithinRoots(resolve('/var/secret'), roots)).toBe(false);
  });

  it('rejects a prefix look-alike (boundary-checked, not naive startsWith)', () => {
    // /srv/code-evil must NOT count as inside /srv/code
    expect(isPathWithinRoots(resolve('/srv/code-evil'), roots)).toBe(false);
    expect(isPathWithinRoots(resolve('/srv/code-evil/x'), roots)).toBe(false);
  });

  it('rejects non-absolute targets', () => {
    expect(isPathWithinRoots('relative/path', roots)).toBe(false);
    expect(isPathWithinRoots('', roots)).toBe(false);
  });

  it('resolves .. before checking — traversal that climbs out is rejected', () => {
    expect(isPathWithinRoots(join(root, '..', '..', 'etc'), roots)).toBe(false);
  });

  it('resolves .. that stays inside — still accepted', () => {
    expect(isPathWithinRoots(join(root, 'a', '..', 'b'), roots)).toBe(true);
  });

  it('returns false when roots is empty', () => {
    expect(isPathWithinRoots(root, [])).toBe(false);
  });
});
