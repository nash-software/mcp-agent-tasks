import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// P1-02: InboxView was deleted — folded into auto-triage in P2-04b.
// These tests confirm the deletion is complete and App.tsx no longer references it.
describe('InboxView removed (P1-02)', () => {
  it('InboxView.tsx no longer exists in views directory', () => {
    const filePath = path.join(process.cwd(), 'src', 'ui', 'src', 'views', 'InboxView.tsx');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('App.tsx does not import InboxView', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'App.tsx'),
      'utf-8',
    );
    expect(source).not.toContain('InboxView');
  });

  it('App.tsx does not reference the inbox ViewId', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'App.tsx'),
      'utf-8',
    );
    expect(source).not.toContain("'inbox'");
  });
});
