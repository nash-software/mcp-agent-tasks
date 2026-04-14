import { describe, it, expect } from 'vitest';
import { isValidTransition, VALID_TRANSITIONS } from '../../src/types/transitions.js';
import type { TaskStatus, TaskType, Priority, Task, TaskReference, Milestone, CaptureEvent } from '../../src/types/task.js';
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

  it('TaskType union is correct — includes plan', () => {
    const types: TaskType[] = ['feature', 'bug', 'chore', 'spike', 'refactor', 'spec', 'plan'];
    expect(types).toHaveLength(7);
    expect(types).toContain('plan');
  });

  it('Priority union is correct', () => {
    const priorities: Priority[] = ['critical', 'high', 'medium', 'low'];
    expect(priorities).toHaveLength(4);
  });
});

describe('New optional fields on Task (compile-time + runtime)', () => {
  it('Task allows milestone, estimate_hours, plan_file, auto_captured, labels, references', () => {
    const now = new Date().toISOString();
    const refs: TaskReference[] = [{ type: 'closes', id: 'TEST-002' }];
    const task: Task = {
      schema_version: 1,
      id: 'TEST-001',
      title: 'New fields test',
      type: 'plan',
      status: 'todo',
      priority: 'medium',
      project: 'TEST',
      tags: ['alpha'],
      complexity: 1,
      complexity_manual: false,
      why: 'Testing new fields',
      created: now,
      updated: now,
      last_activity: now,
      claimed_by: null,
      claimed_at: null,
      claim_ttl_hours: 4,
      parent: null,
      children: [],
      dependencies: [],
      subtasks: [],
      git: { commits: [] },
      transitions: [],
      files: [],
      body: '',
      file_path: '/tmp/TEST-001.md',
      // new optional fields
      milestone: 'v2.0',
      estimate_hours: 8,
      plan_file: 'scratchpads/auth-plan.md',
      auto_captured: true,
      labels: ['alpha', 'beta'],
      references: refs,
    };

    expect(task.milestone).toBe('v2.0');
    expect(task.estimate_hours).toBe(8);
    expect(task.plan_file).toBe('scratchpads/auth-plan.md');
    expect(task.auto_captured).toBe(true);
    expect(task.labels).toEqual(['alpha', 'beta']);
    expect(task.references).toEqual(refs);
    expect(task.type).toBe('plan');
  });

  it('TaskReference has correct shape', () => {
    const ref: TaskReference = { type: 'blocks', id: 'PROJ-042' };
    expect(ref.type).toBe('blocks');
    expect(ref.id).toBe('PROJ-042');
  });

  it('Milestone has correct shape', () => {
    const m: Milestone = {
      id: 'v2.0',
      title: 'v2.0 Release',
      status: 'open',
      created: new Date().toISOString(),
    };
    expect(m.id).toBe('v2.0');
    expect(m.status).toBe('open');
  });

  it('CaptureEvent has correct shape', () => {
    const evt: CaptureEvent = {
      tool: 'Write',
      file_path: 'scratchpads/auth-plan.md',
      project: 'TEST',
      inferred_type: 'plan',
      branch: 'feat/TEST-001-auth',
      at: new Date().toISOString(),
    };
    expect(evt.tool).toBe('Write');
    expect(evt.inferred_type).toBe('plan');
  });
});
