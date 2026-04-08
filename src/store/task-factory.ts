import path from 'node:path';
import type { Task } from '../types/task.js';
import type { TaskCreateInput } from '../types/tools.js';

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

export class TaskFactory {
  create(input: TaskCreateInput, id: string, tasksDir: string, templateBody?: string): Task {
    const now = new Date().toISOString();

    return {
      schema_version: SCHEMA_VERSION,
      id,
      title: input.title,
      type: input.type,
      status: 'todo',
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
  }

  formatId(prefix: string, num: number): string {
    return formatId(prefix, num);
  }
}
