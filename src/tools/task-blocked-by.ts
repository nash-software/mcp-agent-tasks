import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_blocked_by';

export const description =
  'List tasks that are blocking the given task (its dependencies that are not yet done).';

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

  // Fetch each dependency and filter to those not yet done
  const blocking = task.dependencies
    .map(depId => ctx.index.getTask(depId))
    .filter((t): t is NonNullable<typeof t> => t !== null && t.status !== 'done');

  return ok({ blocking });
}
