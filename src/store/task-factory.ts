import path from 'node:path';
import type { Task, CaptureEvent } from '../types/task.js';
import type { TaskCreateInput } from '../types/tools.js';
import { McpTasksError } from '../types/errors.js';

const SCHEMA_VERSION = 1;

function formatId(prefix: string, num: number): string {
  if (num >= 1000) {
    return `${prefix}-${num}`;
  }
  return `${prefix}-${String(num).padStart(3, '0')}`;
}

function computeComplexity(input: TaskCreateInput): number {
  const depCount = input.dependencies?.length ?? 0;
  // Base: 1, add dep count; cap at 10. Minimum is 1 per schema constraint.
  return Math.min(10, Math.max(1, depCount));
}

/**
 * Humanize a file slug: strip extension, strip any leading task-ID prefix,
 * split on hyphen/underscore, capitalize first word only.
 * Examples:
 *   "auth-plan" → "Auth plan"
 *   "HBOOK-007-auth-plan" → "Auth plan"
 */
export function humanizeSlug(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  // Strip leading task-ID prefix like "HBOOK-007-" or "TEST-001-"
  const withoutPrefix = base.replace(/^[A-Z]+-\d+-/, '');
  // Replace hyphens and underscores with spaces
  const words = withoutPrefix.replace(/[-_]/g, ' ').trim();
  if (!words) return base;
  // Capitalize first letter only
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export class TaskFactory {
  create(input: TaskCreateInput, id: string, tasksDir: string, templateBody?: string): Task {
    const now = new Date().toISOString();

    const task: Task = {
      schema_version: SCHEMA_VERSION,
      id,
      title: input.title,
      type: input.type,
      // spec tasks start at draft; all others start at todo
      status: input.type === 'spec' ? 'draft' : 'todo',
      priority: input.priority,
      project: input.project,
      tags: input.tags ?? [],
      complexity: computeComplexity(input),
      complexity_manual: false,
      why: input.why,
      created: now,
      updated: now,
      last_activity: now,
      claimed_by: null,
      claimed_at: null,
      claim_ttl_hours: 4,
      parent: input.parent ?? null,
      children: [],
      dependencies: input.dependencies ?? [],
      subtasks: [],
      git: { commits: [] },
      transitions: [],
      files: input.files ?? [],
      body: templateBody ?? '',
      file_path: path.join(tasksDir, id + '.md'),
    };

    if (input.spec_file !== undefined) {
      task.spec_file = input.spec_file;
    }
    if (input.plan_file !== undefined) {
      task.plan_file = input.plan_file;
    }
    if (input.milestone !== undefined) {
      task.milestone = input.milestone;
    }
    if (input.estimate_hours !== undefined) {
      task.estimate_hours = input.estimate_hours;
    }
    if (input.auto_captured) {
      task.auto_captured = true;
    }
    if (input.references !== undefined) {
      task.references = input.references;
    }

    return task;
  }

  /**
   * Create a Task from a CaptureEvent (passive-capture hook).
   * Only accepts plan/spec/spike types — code_change and skip throw.
   */
  fromCaptureEvent(event: CaptureEvent, id: string, tasksDir: string): Task {
    if (event.inferred_type === 'skip' || event.inferred_type === 'code_change') {
      throw new McpTasksError(
        'INVALID_FIELD',
        'fromCaptureEvent requires plan/spec/spike type',
      );
    }

    const title = humanizeSlug(event.file_path);

    return this.create(
      {
        project: event.project,
        title,
        type: event.inferred_type,
        priority: 'medium',
        why: `Auto-captured from file write: ${event.file_path}`,
        auto_captured: true,
        plan_file: event.inferred_type === 'plan' ? event.file_path : undefined,
        spec_file: event.inferred_type === 'spec' ? event.file_path : undefined,
      },
      id,
      tasksDir,
    );
  }

  formatId(prefix: string, num: number): string {
    return formatId(prefix, num);
  }
}
