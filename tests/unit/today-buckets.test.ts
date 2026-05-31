/**
 * Behavioral tests for isCommittedBucket — Today bucket exclusivity (P5-09 AC2).
 * Proves a draft scheduled-for-today is excluded from "Committed Today" so it renders only under
 * "Needs your call", preventing a single id from highlighting in two sections.
 */
import { describe, it, expect } from 'vitest';
import { isCommittedBucket } from '../../src/ui/src/lib/today-buckets';
import type { Task, TaskStatus } from '../../src/ui/src/types';

function task(status: TaskStatus): Task {
  return { id: `T-${status}`, title: status, status, priority: 'medium' } as Task;
}

describe('isCommittedBucket', () => {
  it('excludes drafts (they belong in "Needs your call")', () => {
    expect(isCommittedBucket(task('draft'))).toBe(false);
  });

  it('excludes the in_progress hero (rendered on its own)', () => {
    expect(isCommittedBucket(task('in_progress'))).toBe(false);
  });

  it('includes actionable committed statuses', () => {
    expect(isCommittedBucket(task('todo'))).toBe(true);
    expect(isCommittedBucket(task('blocked'))).toBe(true);
    expect(isCommittedBucket(task('done'))).toBe(true);
  });

  it('a draft scheduled today filters out of the committed list', () => {
    const scheduled: Task[] = [task('todo'), task('draft'), task('in_progress')];
    const committed = scheduled.filter(isCommittedBucket);
    expect(committed.map(t => t.status)).toEqual(['todo']);
  });
});
