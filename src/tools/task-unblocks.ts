import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_unblocks';

export const description = 'List tasks that will be unblocked once the given task is done.';

export const schema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Task ID' },
  },
  required: ['id'],
} as const;

interface ValidatedInput {
  id: string;
}

export function validate(input: unknown): asserts input is ValidatedInput {
  if (!input || typeof input !== 'object') {
    throw new McpTasksError('INVALID_FIELD', 'Input must be an object');
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw['id'] !== 'string' || !raw['id']) {
    throw new McpTasksError('INVALID_FIELD', 'id is required and must be a string');
  }
}

export async function execute(input: ValidatedInput, ctx: ToolContext): Promise<ToolOutput> {
  const task = ctx.index.getTask(input.id);
  if (!task) {
    throw new McpTasksError('TASK_NOT_FOUND', `Task ${input.id} not found`);
  }

  // Find all tasks that depend on this task (i.e. task is in their dependencies list)
  // Use listTasks with a large limit and filter in memory
  const allTasks = ctx.index.listTasks({ limit: 10000 });
  const unblocks = allTasks.filter(t => t.dependencies.includes(input.id));

  return ok({ unblocks });
}
