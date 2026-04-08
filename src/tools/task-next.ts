import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_next';

export const description =
  'Get the next available task to work on — highest priority, unblocked, unclaimed todo task.';

export const schema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Project prefix to query' },
  },
  required: ['project'],
} as const;

interface ValidatedInput {
  project: string;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['project'] !== 'string' || !raw['project']) {
    throw new McpTasksError('INVALID_FIELD', 'project is required and must be a string');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const task = ctx.index.getNextTask(input.project);
  if (!task) {
    return ok({ available: false, reason: 'no_ready_tasks' });
  }
  return ok(task);
}
