import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Header stats wiring', () => {
  it('Header.tsx imports and uses useStats', () => {
    const root = process.cwd();
    const headerSource = fs.readFileSync(
      path.join(root, 'src', 'ui', 'src', 'components', 'Header.tsx'),
      'utf-8',
    );

    expect(headerSource).toContain('useStats');
  });

  // P1-02: inbox tab removed from Header.tsx (InboxView deleted, folded into P2-04b auto-triage)
  it('Header.tsx does not include an inbox tab', () => {
    const root = process.cwd();
    const headerSource = fs.readFileSync(
      path.join(root, 'src', 'ui', 'src', 'components', 'Header.tsx'),
      'utf-8',
    );

    expect(headerSource).not.toContain("'inbox'");
  });
});
