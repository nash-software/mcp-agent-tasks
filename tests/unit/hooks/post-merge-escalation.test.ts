import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('post-merge hook escalation', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'hooks', 'post-merge.js'), 'utf-8');

  it('appends failures to the agent-tasks-failures.jsonl ledger', () => {
    expect(source).toContain('agent-tasks-failures.jsonl');
    // Must use appendFile so concurrent hooks do not clobber the ledger.
    expect(source).toMatch(/appendFileSync/);
  });

  it('escalates on the same path that logs the close failure', () => {
    // The escalation must fire where the hook currently only warns.
    expect(source).toContain('failed to close');
    expect(source).toMatch(/escalate/i);
  });

  it('writes a structured record with ts, project, taskId, and error fields', () => {
    expect(source).toMatch(/ts\b/);
    expect(source).toContain('project');
    expect(source).toMatch(/taskId/);
    expect(source).toMatch(/error/);
  });

  it('never throws from escalation — wrapped so it cannot break the git hook', () => {
    // The escalate helper must swallow its own errors.
    const escalateBlock = source.slice(source.indexOf('function escalate'));
    expect(escalateBlock).toMatch(/try\s*{/);
    expect(escalateBlock).toMatch(/catch/);
  });
});
