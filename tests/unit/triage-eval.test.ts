/**
 * Unit tests for the triage agreement-check harness (MCPAT-082 AC2).
 * No real claude spawn — all LLM runners are injected.
 */
import { describe, it, expect } from 'vitest';
import { runTriageEval } from '../../src/triage/eval.js';
import type { EvalReport } from '../../src/triage/eval.js';
import { taskView } from '../../src/triage/llm-triage.js';
import type { Task } from '../../src/types/task.js';

const NOW = Date.parse('2026-06-07T12:00:00Z');

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id, title: `Task ${id}`, type: 'feature', status: 'todo', priority: 'medium',
    project: id.split('-')[0]!, tags: [], complexity: 1, why: 'test',
    created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
    last_activity: '2026-01-01T00:00:00Z', claimed_by: null, claimed_at: null,
    claim_ttl_hours: 4, transitions: [], git: { commits: [] }, body: '',
    file_path: `${id}.md`, scheduled_for: null, ...over,
  } as Task;
}

function makeRunner(verdicts: Record<string, string>): (prompt: string) => Promise<string> {
  return async (_prompt: string): Promise<string> => {
    const arr = Object.entries(verdicts).map(([id, verdict]) => ({
      id, verdict, confidence: 0.9, rationale: 'test',
    }));
    return JSON.stringify(arr);
  };
}

describe('runTriageEval — injected runners (AC2)', () => {
  it('returns agreementRate=1 for empty views', async () => {
    const report = await runTriageEval([], makeRunner({}), makeRunner({}));
    expect(report.total).toBe(0);
    expect(report.agreementRate).toBe(1);
    expect(report.verdicts).toHaveLength(0);
  });

  it('counts agreed verdicts correctly when both models agree', async () => {
    const views = [
      taskView(task('A-1'), NOW),
      taskView(task('A-2'), NOW),
    ];
    const runnerA = makeRunner({ 'A-1': 'done', 'A-2': 'still_relevant' });
    const runnerB = makeRunner({ 'A-1': 'done', 'A-2': 'still_relevant' });

    const report = await runTriageEval(views, runnerA, runnerB);
    expect(report.agreed).toBe(2);
    expect(report.disagreed).toBe(0);
    expect(report.agreementRate).toBe(1);
  });

  it('counts disagreements when models differ', async () => {
    const views = [
      taskView(task('B-1'), NOW),
      taskView(task('B-2'), NOW),
    ];
    const runnerA = makeRunner({ 'B-1': 'done', 'B-2': 'obsolete' });
    const runnerB = makeRunner({ 'B-1': 'still_relevant', 'B-2': 'obsolete' });

    const report = await runTriageEval(views, runnerA, runnerB);
    expect(report.agreed).toBe(1);
    expect(report.disagreed).toBe(1);
    expect(report.agreementRate).toBeCloseTo(0.5);
  });

  it('marks a task as disagreed when one model returns no verdict', async () => {
    const views = [taskView(task('C-1'), NOW)];
    const runnerA = makeRunner({ 'C-1': 'done' });
    const runnerB = makeRunner({}); // no verdict for C-1

    const report = await runTriageEval(views, runnerA, runnerB);
    expect(report.agreed).toBe(0);
    expect(report.disagreed).toBe(1);
    expect(report.agreementRate).toBe(0);

    const ev = report.verdicts[0]!;
    expect(ev.id).toBe('C-1');
    expect(ev.modelA).toBe('done');
    expect(ev.modelB).toBeUndefined();
    expect(ev.agree).toBe(false);
  });

  it('runs both runners concurrently (Promise.all)', async () => {
    const calls: string[] = [];

    const runnerA = async (_prompt: string): Promise<string> => {
      calls.push('A-start');
      await new Promise<void>(resolve => setImmediate(resolve));
      calls.push('A-end');
      return JSON.stringify([{ id: 'D-1', verdict: 'done', confidence: 0.9, rationale: 'r' }]);
    };
    const runnerB = async (_prompt: string): Promise<string> => {
      calls.push('B-start');
      await new Promise<void>(resolve => setImmediate(resolve));
      calls.push('B-end');
      return JSON.stringify([{ id: 'D-1', verdict: 'done', confidence: 0.8, rationale: 'r' }]);
    };

    const views = [taskView(task('D-1'), NOW)];
    const report = await runTriageEval(views, runnerA, runnerB);

    // Both runners started before either finished (concurrent dispatch)
    expect(calls.indexOf('A-start')).toBeLessThan(calls.indexOf('B-end'));
    expect(calls.indexOf('B-start')).toBeLessThan(calls.indexOf('A-end'));
    expect(report.agreed).toBe(1);
  });

  it('per-task breakdown includes id, modelA, modelB, agree fields', async () => {
    const views = [taskView(task('E-1'), NOW), taskView(task('E-2'), NOW)];
    const runnerA = makeRunner({ 'E-1': 'done', 'E-2': 'still_relevant' });
    const runnerB = makeRunner({ 'E-1': 'obsolete', 'E-2': 'still_relevant' });

    const report: EvalReport = await runTriageEval(views, runnerA, runnerB);
    expect(report.verdicts).toHaveLength(2);

    const e1 = report.verdicts.find(v => v.id === 'E-1')!;
    expect(e1.modelA).toBe('done');
    expect(e1.modelB).toBe('obsolete');
    expect(e1.agree).toBe(false);

    const e2 = report.verdicts.find(v => v.id === 'E-2')!;
    expect(e2.modelA).toBe('still_relevant');
    expect(e2.modelB).toBe('still_relevant');
    expect(e2.agree).toBe(true);
  });

  it('total equals views.length regardless of verdicts', async () => {
    const views = Array.from({ length: 5 }, (_, i) => taskView(task(`F-${i + 1}`), NOW));
    const runnerA = makeRunner({});
    const runnerB = makeRunner({});

    const report = await runTriageEval(views, runnerA, runnerB);
    expect(report.total).toBe(5);
    expect(report.agreed + report.disagreed).toBe(5);
  });
});
