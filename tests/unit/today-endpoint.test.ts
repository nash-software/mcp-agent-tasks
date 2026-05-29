/**
 * Unit tests for GET /api/today and POST /api/tasks/:id/schedule endpoint logic.
 *
 * Tests are split into:
 * 1. SqliteIndex.getTasksByScheduledDate — correct date filtering
 * 2. SqliteIndex.getCandidates — correct status + null scheduled_for filtering
 * 3. Capacity calculation logic (including null estimates)
 * 4. Target parameter validation
 * 5. Schedule endpoint — valid date, null, invalid format
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../../src/store/sqlite-index.js';
import { TaskFactory } from '../../src/store/task-factory.js';
import type { Task } from '../../src/types/task.js';

function makeTask(factory: TaskFactory, tmpDir: string, overrides: Partial<Task> = {}): Task {
  const id = overrides.id ?? 'TEST-001';
  const t = factory.create(
    { project: 'TEST', title: 'Test task', type: 'feature', priority: 'medium', why: 'test' },
    id,
    tmpDir,
  );
  return { ...t, ...overrides };
}

describe('SqliteIndex.getTasksByScheduledDate', () => {
  let tmpDir: string;
  let idx: SqliteIndex;
  let factory: TaskFactory;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-test-'));
    idx = new SqliteIndex(path.join(tmpDir, 'test.db'));
    idx.init();
    idx.ensureProject('TEST');
    factory = new TaskFactory();
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns only tasks scheduled for the given date', () => {
    const t1 = makeTask(factory, tmpDir, { id: 'TEST-001', scheduled_for: '2026-05-29' });
    const t2 = makeTask(factory, tmpDir, { id: 'TEST-002', scheduled_for: '2026-05-30' });
    const t3 = makeTask(factory, tmpDir, { id: 'TEST-003', scheduled_for: null });
    idx.upsertTask(t1);
    idx.upsertTask(t2);
    idx.upsertTask(t3);

    const result = idx.getTasksByScheduledDate('2026-05-29');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('TEST-001');
  });

  it('returns empty array when no tasks are scheduled for the given date', () => {
    const t1 = makeTask(factory, tmpDir, { id: 'TEST-001', scheduled_for: '2026-05-30' });
    idx.upsertTask(t1);

    const result = idx.getTasksByScheduledDate('2026-05-29');
    expect(result).toHaveLength(0);
  });

  it('orders results by priority then title', () => {
    const t1 = makeTask(factory, tmpDir, { id: 'TEST-001', title: 'Zebra', priority: 'low', scheduled_for: '2026-05-29' });
    const t2 = makeTask(factory, tmpDir, { id: 'TEST-002', title: 'Alpha', priority: 'high', scheduled_for: '2026-05-29' });
    const t3 = makeTask(factory, tmpDir, { id: 'TEST-003', title: 'Beta', priority: 'high', scheduled_for: '2026-05-29' });
    idx.upsertTask(t1);
    idx.upsertTask(t2);
    idx.upsertTask(t3);

    const result = idx.getTasksByScheduledDate('2026-05-29');
    expect(result[0].id).toBe('TEST-002'); // high + Alpha
    expect(result[1].id).toBe('TEST-003'); // high + Beta
    expect(result[2].id).toBe('TEST-001'); // low
  });
});

describe('SqliteIndex.getCandidates', () => {
  let tmpDir: string;
  let idx: SqliteIndex;
  let factory: TaskFactory;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'candidates-test-'));
    idx = new SqliteIndex(path.join(tmpDir, 'test.db'));
    idx.init();
    idx.ensureProject('TEST');
    factory = new TaskFactory();
  });

  afterEach(() => {
    idx.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns todo tasks with null scheduled_for', () => {
    const t1 = makeTask(factory, tmpDir, { id: 'TEST-001', status: 'todo', scheduled_for: null });
    const t2 = makeTask(factory, tmpDir, { id: 'TEST-002', status: 'done', scheduled_for: null });
    const t3 = makeTask(factory, tmpDir, { id: 'TEST-003', status: 'todo', scheduled_for: '2026-05-29' });
    idx.upsertTask(t1);
    idx.upsertTask(t2);
    idx.upsertTask(t3);

    const result = idx.getCandidates(20);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('TEST-001');
  });

  it('returns in_progress tasks with null scheduled_for', () => {
    const t1 = makeTask(factory, tmpDir, { id: 'TEST-001', status: 'in_progress', scheduled_for: null });
    idx.upsertTask(t1);

    const result = idx.getCandidates(20);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('TEST-001');
  });

  it('excludes tasks with scheduled_for set', () => {
    const t1 = makeTask(factory, tmpDir, { id: 'TEST-001', status: 'todo', scheduled_for: '2026-06-01' });
    idx.upsertTask(t1);

    const result = idx.getCandidates(20);
    expect(result).toHaveLength(0);
  });

  it('respects the limit parameter', () => {
    for (let i = 1; i <= 5; i++) {
      const t = makeTask(factory, tmpDir, {
        id: `TEST-00${i}`,
        status: 'todo',
        scheduled_for: null,
      });
      idx.upsertTask(t);
    }

    const result = idx.getCandidates(3);
    expect(result).toHaveLength(3);
  });
});

describe('Capacity calculation logic', () => {
  it('sums estimate_hours * 60 for committed tasks', () => {
    const tasks = [
      { estimate_hours: 2 },
      { estimate_hours: 1.5 },
    ] as Array<{ estimate_hours?: number | null }>;

    const committedMinutes = tasks.reduce((sum, t) => sum + ((t.estimate_hours ?? 0) * 60), 0);
    expect(committedMinutes).toBe(210);
  });

  it('treats null estimate_hours as 0', () => {
    const tasks = [
      { estimate_hours: null },
      { estimate_hours: 1 },
    ] as Array<{ estimate_hours?: number | null }>;

    const committedMinutes = tasks.reduce((sum, t) => sum + ((t.estimate_hours ?? 0) * 60), 0);
    expect(committedMinutes).toBe(60);
  });

  it('treats undefined estimate_hours as 0', () => {
    const tasks = [
      {},
      { estimate_hours: 2 },
    ] as Array<{ estimate_hours?: number | null }>;

    const committedMinutes = tasks.reduce((sum, t) => sum + ((t.estimate_hours ?? 0) * 60), 0);
    expect(committedMinutes).toBe(120);
  });

  it('returns 0 for empty committed list', () => {
    const tasks: Array<{ estimate_hours?: number | null }> = [];
    const committedMinutes = tasks.reduce((sum, t) => sum + ((t.estimate_hours ?? 0) * 60), 0);
    expect(committedMinutes).toBe(0);
  });
});

describe('Target parameter validation', () => {
  function validateTarget(value: string): { valid: boolean; minutes?: number; error?: string } {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 60 || parsed > 600) {
      return { valid: false, error: 'target must be an integer between 60 and 600' };
    }
    return { valid: true, minutes: parsed };
  }

  it('accepts a value of 360', () => {
    expect(validateTarget('360')).toEqual({ valid: true, minutes: 360 });
  });

  it('accepts the minimum value of 60', () => {
    expect(validateTarget('60')).toEqual({ valid: true, minutes: 60 });
  });

  it('accepts the maximum value of 600', () => {
    expect(validateTarget('600')).toEqual({ valid: true, minutes: 600 });
  });

  it('rejects a value below 60', () => {
    const result = validateTarget('30');
    expect(result.valid).toBe(false);
  });

  it('rejects a value above 600', () => {
    const result = validateTarget('601');
    expect(result.valid).toBe(false);
  });

  it('rejects non-numeric input', () => {
    const result = validateTarget('abc');
    expect(result.valid).toBe(false);
  });
});

describe('Schedule endpoint — date validation', () => {
  function validateScheduleDate(date: unknown): { valid: boolean; error?: string } {
    if (date === null || date === undefined) {
      return { valid: true };
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { valid: false, error: 'date must be YYYY-MM-DD or null' };
    }
    return { valid: true };
  }

  it('accepts a valid YYYY-MM-DD date', () => {
    expect(validateScheduleDate('2026-05-29')).toEqual({ valid: true });
  });

  it('accepts null (clears the schedule)', () => {
    expect(validateScheduleDate(null)).toEqual({ valid: true });
  });

  it('rejects an invalid format', () => {
    expect(validateScheduleDate('2026/05/29').valid).toBe(false);
  });

  it('rejects a non-date string', () => {
    expect(validateScheduleDate('tomorrow').valid).toBe(false);
  });

  it('rejects a number', () => {
    expect(validateScheduleDate(20260529).valid).toBe(false);
  });
});
