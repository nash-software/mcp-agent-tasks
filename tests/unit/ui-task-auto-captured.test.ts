import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('UI Task type includes auto_captured', () => {
  it('Task interface has auto_captured field', () => {
    const root = process.cwd();
    const uiSource = fs.readFileSync(
      path.join(root, 'src', 'ui', 'src', 'types.ts'),
      'utf-8',
    );

    expect(uiSource).toContain('auto_captured');
  });
});
