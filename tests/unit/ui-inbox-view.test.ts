import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('InboxView exists and is wired', () => {
  it('InboxView.tsx exists in views directory', () => {
    const filePath = path.join(process.cwd(), 'src', 'ui', 'src', 'views', 'InboxView.tsx');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('InboxView.tsx fetches draft tasks', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'views', 'InboxView.tsx'),
      'utf-8',
    );
    expect(source).toContain("'draft'");
    expect(source).toContain('fetchTasks');
  });

  it('App.tsx renders InboxView for inbox tab', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'App.tsx'),
      'utf-8',
    );
    expect(source).toContain('InboxView');
    expect(source).toContain("'inbox'");
  });

  it('InboxView.tsx has a promote action', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'ui', 'src', 'views', 'InboxView.tsx'),
      'utf-8',
    );
    expect(source).toContain('promote');
    expect(source).toContain('/promote');
  });
});
