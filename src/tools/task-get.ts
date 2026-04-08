import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok, err } from './context.js';

export const name = 'task_get';

export const description = 'Retrieve a single task by ID.';

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
    return err('TASK_NOT_FOUND', `Task ${input.id} not found`);
  }
  return ok(task);
}
