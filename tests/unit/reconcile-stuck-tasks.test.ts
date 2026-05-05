import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('reconcile-stuck-tasks script', () => {
  it('getMergedPRs requests url field so matchedPR.url is populated', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'reconcile-stuck-tasks.js');
    const source = fs.readFileSync(scriptPath, 'utf-8');
    // Without 'url' in --json fields, matchedPR.url is always undefined → --pr-url ""
    expect(source).toMatch(/--json.*url/);
  });

  it('uses --pr-number flag when calling link-pr (not a positional arg)', () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'reconcile-stuck-tasks.js');
    const source = fs.readFileSync(scriptPath, 'utf-8');
    // The CLI requires --pr-number, --pr-url, --pr-state for link-pr
    // Passing the PR number as a positional arg silently fails
    expect(source).toContain('--pr-number');
    expect(source).toContain('--pr-state');
    expect(source).toContain('--pr-url');
  });
});
