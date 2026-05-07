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

  it('Header.tsx includes an inbox tab', () => {
    const root = process.cwd();
    const headerSource = fs.readFileSync(
      path.join(root, 'src', 'ui', 'src', 'components', 'Header.tsx'),
      'utf-8',
    );

    expect(headerSource).toContain("'inbox'");
  });
});
