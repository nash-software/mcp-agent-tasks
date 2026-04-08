import { describe, it, expect } from 'vitest';
import { isValidTransition, VALID_TRANSITIONS } from '../../src/types/transitions.js';
import type { TaskStatus, TaskType, Priority } from '../../src/types/task.js';
import { McpTasksError } from '../../src/types/errors.js';

describe('VALID_TRANSITIONS', () => {
  it('todo can transition to in_progress and blocked', () => {
    expect(VALID_TRANSITIONS.todo).toContain('in_progress');
    expect(VALID_TRANSITIONS.todo).toContain('blocked');
  });

  it('in_progress can transition to done, blocked, or todo', () => {
    expect(VALID_TRANSITIONS.in_progress).toContain('done');
    expect(VALID_TRANSITIONS.in_progress).toContain('blocked');
    expect(VALID_TRANSITIONS.in_progress).toContain('todo');
  });

  it('done can only go back to in_progress', () => {
    expect(VALID_TRANSITIONS.done).toEqual(['in_progress']);
  });

  it('archived has no valid transitions', () => {
    expect(VALID_TRANSITIONS.archived).toEqual([]);
  });
});

describe('isValidTransition', () => {
  it('returns true for valid transitions', () => {
    expect(isValidTransition('todo', 'in_progress')).toBe(true);
    expect(isValidTransition('in_progress', 'done')).toBe(true);
    expect(isValidTransition('done', 'in_progress')).toBe(true);
    expect(isValidTransition('blocked', 'todo')).toBe(true);
  });

  it('returns false for invalid transitions', () => {
    expect(isValidTransition('todo', 'done')).toBe(false);
    expect(isValidTransition('archived', 'todo')).toBe(false);
    expect(isValidTransition('done', 'todo')).toBe(false);
  });
});

describe('McpTasksError', () => {
  it('carries error code and message', () => {
    const err = new McpTasksError('TASK_NOT_FOUND', 'Task HERALD-999 not found');
    expect(err.code).toBe('TASK_NOT_FOUND');
    expect(err.message).toBe('Task HERALD-999 not found');
    expect(err.name).toBe('McpTasksError');
    expect(err).toBeInstanceOf(Error);
  });

  it('supports all error codes', () => {
    const codes = [
      'TASK_NOT_FOUND',
      'PROJECT_NOT_FOUND',
      'INVALID_TRANSITION',
      'CLAIM_CONFLICT',
      'CIRCULAR_DEPENDENCY',
      'MAX_DEPTH_EXCEEDED',
      'INVALID_FIELD',
      'SCHEMA_MISMATCH',
    ] as const;

    for (const code of codes) {
      const err = new McpTasksError(code, 'test');
      expect(err.code).toBe(code);
    }
  });
});

describe('Type contracts (compile-time only)', () => {
  it('TaskStatus union is correct', () => {
    const statuses: TaskStatus[] = ['todo', 'in_progress', 'done', 'blocked', 'archived'];
    expect(statuses).toHaveLength(5);
  });

  it('TaskType union is correct', () => {
    const types: TaskType[] = ['feature', 'bug', 'chore', 'spike', 'refactor'];
    expect(types).toHaveLength(5);
  });

  it('Priority union is correct', () => {
    const priorities: Priority[] = ['critical', 'high', 'medium', 'low'];
    expect(priorities).toHaveLength(4);
  });
});
