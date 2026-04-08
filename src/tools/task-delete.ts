import { McpTasksError } from '../types/errors.js';
import type { ToolContext, ToolOutput } from './context.js';
import { ok } from './context.js';

export const name = 'task_delete';

export const description = 'Archive (soft-delete) a task. The markdown file is moved to archive/.';

export const schema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Task ID to archive' },
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
  ctx.store.archiveTask(input.id);
  return ok({ archived: true, id: input.id });
}
