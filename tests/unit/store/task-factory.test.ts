import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { TaskFactory, humanizeSlug } from '../../../src/store/task-factory.js';
import type { TaskCreateInput } from '../../../src/types/tools.js';
import type { CaptureEvent } from '../../../src/types/task.js';

function makeInput(overrides: Partial<TaskCreateInput> = {}): TaskCreateInput {
  return {
    project: 'PREFIX',
    title: 'Test task',
    type: 'feature',
    priority: 'medium',
    why: 'For testing.',
    ...overrides,
  };
}

describe('TaskFactory', () => {
  const factory = new TaskFactory();
  // Use OS-appropriate tmpdir so path.join works correctly on all platforms
  const TASKS_DIR = path.join(os.tmpdir(), 'tasks');

  describe('formatId()', () => {
    it('pads number=1 to PREFIX-001', () => {
      expect(factory.formatId('PREFIX', 1)).toBe('PREFIX-001');
    });

    it('pads number=42 to PREFIX-042', () => {
      expect(factory.formatId('PREFIX', 42)).toBe('PREFIX-042');
    });

    it('pads number=999 to PREFIX-999', () => {
      expect(factory.formatId('PREFIX', 999)).toBe('PREFIX-999');
    });

    it('does not pad number=1000: PREFIX-1000', () => {
      expect(factory.formatId('PREFIX', 1000)).toBe('PREFIX-1000');
    });

    it('does not pad number=9999: PREFIX-9999', () => {
      expect(factory.formatId('PREFIX', 9999)).toBe('PREFIX-9999');
    });
  });

  describe('create()', () => {
    it('sets schema_version to 1', () => {
      const task = factory.create(makeInput(), 'PREFIX-001', TASKS_DIR);
      expect(task.schema_version).toBe(1);
    });

    it('sets status to todo', () => {
      const task = factory.create(makeInput(), 'PREFIX-001', TASKS_DIR);
      expect(task.status).toBe('todo');
    });

    it('sets all timestamps to the same ISO-8601 value', () => {
      const task = factory.create(makeInput(), 'PREFIX-001', TASKS_DIR);
      expect(task.created).toBe(task.updated);
      expect(task.updated).toBe(task.last_activity);
      // Should be valid ISO-8601
      expect(() => new Date(task.created)).not.toThrow();
    });

    it('sets claimed_by=null, claimed_at=null', () => {
      const task = factory.create(makeInput(), 'PREFIX-001', TASKS_DIR);
      expect(task.claimed_by).toBeNull();
      expect(task.claimed_at).toBeNull();
    });

    it('generates file_path from tasksDir and id', () => {
      const task = factory.create(makeInput(), 'PREFIX-042', TASKS_DIR);
      expect(task.file_path).toContain('PREFIX-042.md');
      // Normalize separators so test passes on Windows and Unix
      expect(task.file_path.replace(/\\/g, '/')).toContain(TASKS_DIR.replace(/\\/g, '/'));
    });

    it('complexity: 0 deps → 1 (schema minimum)', () => {
      const task = factory.create(makeInput({ dependencies: [] }), 'PREFIX-001', TASKS_DIR);
      expect(task.complexity).toBe(1);
    });

    it('complexity: 3 deps → 3', () => {
      const task = factory.create(
        makeInput({ dependencies: ['A', 'B', 'C'] }),
        'PREFIX-001',
        TASKS_DIR,
      );
      expect(task.complexity).toBe(3);
    });

    it('complexity: 10 deps → 10 (capped)', () => {
      const deps = Array.from({ length: 15 }, (_, i) => `DEP-${i}`);
      const task = factory.create(makeInput({ dependencies: deps }), 'PREFIX-001', TASKS_DIR);
      expect(task.complexity).toBe(10);
    });

    it('stores tags, dependencies, files from input', () => {
      const task = factory.create(
        makeInput({ tags: ['tag1'], dependencies: ['DEP-001'], files: ['src/foo.ts'] }),
        'PREFIX-001',
        TASKS_DIR,
      );
      expect(task.tags).toContain('tag1');
      expect(task.dependencies).toContain('DEP-001');
      expect(task.files).toContain('src/foo.ts');
    });

    it('uses templateBody as body if provided', () => {
      const task = factory.create(makeInput(), 'PREFIX-001', TASKS_DIR, '## Template\n\nDefault body.');
      expect(task.body).toContain('Template');
    });

    it('sets empty body if no template provided', () => {
      const task = factory.create(makeInput(), 'PREFIX-001', TASKS_DIR);
      expect(task.body).toBe('');
    });

    it('sets parent from input', () => {
      const task = factory.create(makeInput({ parent: 'PREFIX-000' }), 'PREFIX-001', TASKS_DIR);
      expect(task.parent).toBe('PREFIX-000');
    });

    it('complexity_manual is false on creation', () => {
      const task = factory.create(makeInput(), 'PREFIX-001', TASKS_DIR);
      expect(task.complexity_manual).toBe(false);
    });
  });

  describe('humanizeSlug()', () => {
    it('humanizes plain slug: "auth-plan" → "Auth plan"', () => {
      expect(humanizeSlug('scratchpads/auth-plan.md')).toBe('Auth plan');
    });

    it('strips task-ID prefix: "HBOOK-007-auth-plan.md" → "Auth plan"', () => {
      expect(humanizeSlug('HBOOK-007-auth-plan.md')).toBe('Auth plan');
    });

    it('handles underscores: "auth_plan" → "Auth plan"', () => {
      expect(humanizeSlug('auth_plan.md')).toBe('Auth plan');
    });
  });

  describe('fromCaptureEvent()', () => {
    const makeEvent = (overrides: Partial<CaptureEvent> = {}): CaptureEvent => ({
      tool: 'Write',
      file_path: 'scratchpads/auth-plan.md',
      project: 'TEST',
      inferred_type: 'plan',
      branch: 'feat/TEST-001-auth',
      at: new Date().toISOString(),
      ...overrides,
    });

    it('creates a plan task with auto_captured=true and draft status', () => {
      const event = makeEvent({ inferred_type: 'plan', file_path: 'scratchpads/auth-plan.md' });
      const task = factory.fromCaptureEvent(event, 'TEST-001', TASKS_DIR);
      expect(task.auto_captured).toBe(true);
      expect(task.status).toBe('draft');
      expect(task.type).toBe('plan');
      expect(task.title).toBe('Auth plan');
      expect(task.plan_file).toBe('scratchpads/auth-plan.md');
    });

    it('creates a spec task with auto_captured=true', () => {
      const event = makeEvent({ inferred_type: 'spec', file_path: 'scratchpads/auth-spec.md' });
      const task = factory.fromCaptureEvent(event, 'TEST-002', TASKS_DIR);
      expect(task.type).toBe('spec');
      expect(task.spec_file).toBe('scratchpads/auth-spec.md');
    });

    it('throws for skip type', () => {
      const event = makeEvent({ inferred_type: 'skip' });
      expect(() => factory.fromCaptureEvent(event, 'TEST-003', TASKS_DIR)).toThrow(
        'fromCaptureEvent requires plan/spec/spike type',
      );
    });

    it('throws for code_change type', () => {
      const event = makeEvent({ inferred_type: 'code_change' });
      expect(() => factory.fromCaptureEvent(event, 'TEST-004', TASKS_DIR)).toThrow(
        'fromCaptureEvent requires plan/spec/spike type',
      );
    });
  });
});
